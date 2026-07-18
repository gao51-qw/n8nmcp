import { randomBytes } from "node:crypto";
import { CronExpressionParser } from "cron-parser";
import type { ToolContext } from "./mcp.server";
import {
  WorkflowDiffService,
  WorkflowValidationService,
  type WorkflowLike,
} from "./workflow-agent";
import {
  WorkflowCreationPipeline,
  type CreationPipelineInput,
  type CreationPipelineResult,
} from "./workflow-agent/creation-pipeline.server";
import {
  createKnowledgeClient,
  type KnowledgeClient,
} from "./workflow-agent/knowledge-client.server";
import {
  WorkflowDeploymentPipeline,
  type DeploymentConfirmationService,
} from "./workflow-agent/deployment-pipeline.server";
import {
  ConfirmationRequiredError,
  createConfirmationService,
} from "./workflow-agent/confirmation.server";
import { classifyRepairEvidence } from "./workflow-agent/repair-pipeline.server";

/**
 * 澶嶅悎宸ュ叿瀹炵幇鏈嶅姟
 *
 * 灏嗗涓師瀛愭搷浣滅粍鍚堟垚楂樼骇鍔熻兘
 */

type Inst = {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
};

async function n8n(inst: Inst, path: string, init?: RequestInit) {
  const url = `${inst.base_url}${path}`;
  const { safeFetchPublicUrl } = await import("./ssrf-guard.server");
  const res = await safeFetchPublicUrl(url, {
    ...init,
    headers: {
      "X-N8N-API-KEY": inst.api_key,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`n8n request failed with status ${res.status}`);
  }
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Successful non-JSON responses are returned as text.
  }
  return body;
}

/**
 * n8n 鑺傜偣淇℃伅锛堝父鐢ㄨ妭鐐癸級
 */
const COMMON_NODES = {
  scheduleTrigger: {
    type: "n8n-nodes-base.scheduleTrigger",
    typeVersion: 1,
  },
  webhook: {
    type: "n8n-nodes-base.webhook",
    typeVersion: 1,
  },
  respondToWebhook: {
    type: "n8n-nodes-base.respondToWebhook",
    typeVersion: 1,
  },
  emailSend: {
    type: "n8n-nodes-base.emailSend",
    typeVersion: 2,
  },
  httpRequest: {
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4,
  },
  set: {
    type: "n8n-nodes-base.set",
    typeVersion: 3,
  },
  if: {
    type: "n8n-nodes-base.if",
    typeVersion: 2,
  },
};

/**
 * 澶嶅悎宸ュ叿鏈嶅姟
 */
type N8nWorkflowNode = {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position?: number[];
  parameters: Record<string, unknown>;
  [key: string]: unknown;
};

/** Shape returned by the n8n workflow create/get endpoints (loosely typed 鈥? *  we only depend on a handful of fields and mutate `active` locally). */
type N8nWorkflowResult = {
  id: string;
  active?: boolean;
  webhookUrl?: string;
  nodes?: N8nWorkflowNode[];
  [key: string]: unknown;
};

/** n8n connection graph: source node 鈫?output port 鈫?list of downstream links. */
type N8nConnections = Record<
  string,
  { main: Array<Array<{ node: string; type: string; index: number }>> }
>;

/** One row from the n8n executions list endpoint (only the fields we read). */
type N8nExecutionRow = {
  id?: string;
  startedAt?: string;
  data?: { resultData?: { error?: { message?: string }; lastNodeExecuted?: string } };
};

/** Output of analyzeErrors: error category 鈫?aggregated detail. */
type ErrorPatterns = Record<string, { count: number; nodes: string[]; sample: string }>;

/** A single suggested fix's action payload. */
type WorkflowFixDetail = {
  action: string;
  message?: string;
  newTimeout?: number;
  retryConfig?: { maxRetries: number; waitBetween: number };
};

const CONFIRMATION_TOKEN_TTL_MS = 5 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function createLazyKnowledgeClient(): KnowledgeClient {
  let client: KnowledgeClient | undefined;
  const getClient = () => (client ??= createKnowledgeClient());
  return {
    searchTemplates: (...args) => getClient().searchTemplates(...args),
    getTemplate: (...args) => getClient().getTemplate(...args),
    searchNodes: (...args) => getClient().searchNodes(...args),
    getNode: (...args) => getClient().getNode(...args),
    validateNode: (...args) => getClient().validateNode(...args),
    validateWorkflow: (...args) => getClient().validateWorkflow(...args),
  };
}

export class OrchestratedToolsService {
  private confirmationChallenges = new Map<string, { token: string; expiresAt: number }>();
  private readonly workflowValidationService = new WorkflowValidationService();
  private readonly creationPipeline: WorkflowCreationPipeline;
  private readonly deploymentPipeline: WorkflowDeploymentPipeline;

  constructor(
    private inst: Inst,
    dependencies: {
      creationPipeline?: WorkflowCreationPipeline;
      deploymentPipeline?: WorkflowDeploymentPipeline;
      knowledgeClient?: KnowledgeClient;
      confirmationService?: DeploymentConfirmationService;
    } = {},
  ) {
    this.creationPipeline =
      dependencies.creationPipeline ??
      new WorkflowCreationPipeline({
        knowledge: dependencies.knowledgeClient ?? createLazyKnowledgeClient(),
        localValidation: this.workflowValidationService,
        createDraft: async (workflow) =>
          (await n8n(this.inst, "/api/v1/workflows", {
            method: "POST",
            body: JSON.stringify(workflow),
          })) as WorkflowLike,
      });
    const knowledge = dependencies.knowledgeClient ?? createLazyKnowledgeClient();
    this.deploymentPipeline =
      dependencies.deploymentPipeline ??
      new WorkflowDeploymentPipeline({
        loadWorkflow: async (workflowId) =>
          (await n8n(
            this.inst,
            `/api/v1/workflows/${encodeURIComponent(workflowId)}`,
          )) as WorkflowLike & Record<string, unknown>,
        validateWorkflow: async (workflow) => {
          const authoritative = await knowledge.validateWorkflow(workflow);
          if (!authoritative.ok) return authoritative;
          const local = await this.workflowValidationService.validateWorkflow(workflow);
          const errors = local.errors.map((issue) => issue);
          if (
            (!workflow.nodes || workflow.nodes.length === 0) &&
            !errors.some((issue) => issue.message === "Workflow has no nodes")
          ) {
            errors.push({
              code: "workflow_nodes_required",
              message: "Workflow has no nodes",
              severity: "error",
            });
          }
          return {
            ok: local.ok && errors.length === 0,
            errors,
            warnings: local.warnings,
            knowledgeMode: "authoritative" as const,
          };
        },
        confirmation: dependencies.confirmationService ?? createConfirmationService(),
        runWorkflow: async (workflowId, workflow, testData) => {
          const execution = (await n8n(
            this.inst,
            `/api/v1/workflows/${encodeURIComponent(workflowId)}/run`,
            {
              method: "POST",
              body: JSON.stringify({ workflowData: workflow, runData: testData }),
            },
          )) as {
            finished?: boolean;
            data?: {
              resultData?: {
                error?: unknown;
                lastNodeExecuted?: { data: { main: Array<Record<string, unknown>> } };
              };
            };
          };
          return {
            finished: execution.finished,
            error: execution.data?.resultData?.error,
            output: execution.data?.resultData?.lastNodeExecuted?.data.main[0] ?? null,
          };
        },
        activateWorkflow: async (workflowId) => {
          await n8n(this.inst, `/api/v1/workflows/${encodeURIComponent(workflowId)}/activate`, {
            method: "POST",
          });
        },
        deactivateWorkflow: async (workflowId) => {
          await n8n(this.inst, `/api/v1/workflows/${encodeURIComponent(workflowId)}/deactivate`, {
            method: "POST",
          });
        },
      });
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
    context?: ToolContext,
  ): Promise<unknown> {
    switch (name) {
      case "create_scheduled_workflow":
        return this.createScheduledWorkflow(args as Parameters<this["createScheduledWorkflow"]>[0]);
      case "create_webhook_workflow":
        return this.createWebhookWorkflow(args as Parameters<this["createWebhookWorkflow"]>[0]);
      case "create_ai_chatbot_workflow":
        return this.createAIChatbotWorkflow(this.normalizeAIChatbotArgs(args));
      case "create_email_workflow":
        return this.createEmailWorkflow(this.normalizeEmailWorkflowArgs(args));
      case "deploy_and_test_workflow":
        return this.deployAndTestWorkflow(
          args as Parameters<this["deployAndTestWorkflow"]>[0],
          context,
        );
      case "fix_workflow_errors":
        return this.fixWorkflowErrors(args as Parameters<this["fixWorkflowErrors"]>[0], context);
      default:
        throw new Error(`Unknown orchestrated tool: ${name}`);
    }
  }

  private normalizeEmailWorkflowArgs(
    args: Record<string, unknown>,
  ): Parameters<this["createEmailWorkflow"]>[0] {
    const email = args.email ?? args.emailTemplate;
    return {
      ...(args as Parameters<this["createEmailWorkflow"]>[0]),
      email,
    } as Parameters<this["createEmailWorkflow"]>[0];
  }

  private normalizeAIChatbotArgs(
    args: Record<string, unknown>,
  ): Parameters<this["createAIChatbotWorkflow"]>[0] {
    const escalationRules = isRecord(args.escalationRules) ? args.escalationRules : {};
    const humanNotification = isRecord(args.humanNotification) ? args.humanNotification : {};
    const aiConfig = isRecord(args.aiConfig) ? args.aiConfig : {};
    const interfaceConfig = isRecord(args.interfaceConfig) ? args.interfaceConfig : {};
    const features = isRecord(args.features) ? args.features : {};
    const inferredHumanHandoff =
      Object.keys(escalationRules).length > 0 || Object.keys(humanNotification).length > 0;
    const inferredSentimentAnalysis = escalationRules.sentimentThreshold !== undefined;

    return {
      ...(args as Parameters<this["createAIChatbotWorkflow"]>[0]),
      aiProvider: (args.aiProvider ?? "openai") as Parameters<
        this["createAIChatbotWorkflow"]
      >[0]["aiProvider"],
      aiConfig: {
        ...aiConfig,
        systemPrompt: aiConfig.systemPrompt ?? args.systemPrompt,
      },
      interface: (args.interface ?? args.platform) as Parameters<
        this["createAIChatbotWorkflow"]
      >[0]["interface"],
      interfaceConfig: {
        ...interfaceConfig,
        humanEmail:
          interfaceConfig.humanEmail ??
          (humanNotification.method === "email" ? humanNotification.recipient : undefined),
        humanEmailCredentials:
          interfaceConfig.humanEmailCredentials ??
          (isRecord(humanNotification.credentials) ? humanNotification.credentials : undefined),
      },
      features: {
        ...features,
        humanHandoff: features.humanHandoff ?? inferredHumanHandoff,
        sentimentAnalysis: features.sentimentAnalysis ?? inferredSentimentAnalysis,
      },
    } as Parameters<this["createAIChatbotWorkflow"]>[0];
  }

  private createInactiveDraft(
    input: Omit<CreationPipelineInput, "templateCompatibility"> & {
      expectedNodeTypes: ReadonlySet<string>;
    },
  ) {
    const { expectedNodeTypes, ...pipelineInput } = input;
    return this.creationPipeline.create({
      ...pipelineInput,
      templateCompatibility: (workflow) => {
        const nodeTypes = (workflow.nodes ?? [])
          .map((node) => node.type)
          .filter((nodeType): nodeType is string => typeof nodeType === "string");
        return (
          nodeTypes.length > 0 &&
          nodeTypes.every((nodeType) => expectedNodeTypes.has(nodeType)) &&
          [...expectedNodeTypes].every((nodeType) => nodeTypes.includes(nodeType))
        );
      },
    });
  }

  private creationFailure(creation: CreationPipelineResult) {
    return {
      ...creation,
      message: "Workflow validation failed; workflow was not created.",
    };
  }

  /**
   * 1. 鍒涘缓瀹氭椂宸ヤ綔娴?   */
  async createScheduledWorkflow(params: {
    name: string;
    schedule: string;
    action: "send_email" | "http_request" | "database_query" | "slack_message" | "custom";
    actionConfig: Record<string, unknown>;
    activate?: boolean;
  }) {
    if (!isRecord(params.actionConfig)) {
      throw new Error("actionConfig (object) is required");
    }

    // 1. 瑙ｆ瀽璁″垝琛ㄨ揪寮?
    const cronExpression = this.parseToCron(params.schedule);
    const nextRun = this.getNextRunTime(cronExpression);

    // 2. 鍒涘缓鑺傜偣閰嶇疆
    const nodes = [];
    const connections: N8nConnections = {};

    // 瑙﹀彂鍣ㄨ妭鐐?
    nodes.push({
      id: "schedule_trigger",
      name: "Schedule Trigger",
      type: COMMON_NODES.scheduleTrigger.type,
      typeVersion: COMMON_NODES.scheduleTrigger.typeVersion,
      position: [250, 300],
      parameters: {
        rule: {
          interval: [
            {
              cronExpression,
            },
          ],
        },
      },
    });

    // 鍔ㄤ綔鑺傜偣锛堟牴鎹?action 绫诲瀷锛?
    let actionNode;
    switch (params.action) {
      case "send_email":
        actionNode = this.createEmailNode("send_email", params.actionConfig);
        break;
      case "http_request":
        actionNode = this.createHttpNode("http_request", params.actionConfig);
        break;
      case "slack_message":
        actionNode = this.createSlackNode("slack_message", params.actionConfig);
        break;
      default:
        throw new Error(`Unsupported action type: ${params.action}`);
    }

    actionNode.position = [450, 300];
    nodes.push(actionNode);

    // 杩炴帴鑺傜偣
    connections["Schedule Trigger"] = {
      main: [[{ node: actionNode.name, type: "main", index: 0 }]],
    };

    // 3. 鍒涘缓宸ヤ綔娴?
    const workflow = {
      name: params.name,
      nodes,
      connections,
      active: false,
      settings: {
        executionOrder: "v1",
      },
    };

    const creation = await this.createInactiveDraft({
      intent: params.name,
      activateIntent: params.activate === true,
      buildFallback: () => workflow,
      expectedNodeTypes: new Set(nodes.map((node) => node.type)),
    });
    if (!creation.success || !creation.workflow) return this.creationFailure(creation);
    const created = creation.workflow as N8nWorkflowResult;

    return {
      ...creation,
      webhookUrl: created.webhookUrl,
      message: `Scheduled workflow draft created and saved as inactive. Will run after deployment: ${params.schedule}`,
      nextRun,
    };
  }

  /**
   * 2. 鍒涘缓 Webhook 宸ヤ綔娴?   *
   * 鏈€娴佽鐨勫伐浣滄祦绫诲瀷锛?   */
  async createWebhookWorkflow(params: {
    name: string;
    path?: string;
    method?: string;
    processing?: Array<{ action: string; config: Record<string, unknown> }>;
    responseTemplate?: unknown;
    activate?: boolean;
  }) {
    const nodes = [];
    const connections: N8nConnections = {};

    // 1. Webhook 瑙﹀彂鍣?
    nodes.push({
      id: "webhook",
      name: "Webhook",
      type: COMMON_NODES.webhook.type,
      typeVersion: COMMON_NODES.webhook.typeVersion,
      position: [250, 300],
      parameters: {
        path: params.path || "",
        httpMethod: params.method || "POST",
        responseMode: "onReceived",
        options: {},
      },
      webhookId: this.generateWebhookId(),
    });

    let lastNodeName = "Webhook";
    let xPosition = 450;

    // 2. 澶勭悊姝ラ锛堝鏋滄湁锛?
    if (params.processing && params.processing.length > 0) {
      for (let i = 0; i < params.processing.length; i++) {
        const step = params.processing[i];
        const nodeId = `process_${i}`;

        let processingNode;
        switch (step.action) {
          case "transform":
            processingNode = this.createSetNode(nodeId, step.config);
            break;
          case "validate":
            processingNode = this.createIfNode(nodeId, step.config);
            break;
          default:
            continue;
        }

        processingNode.position = [xPosition, 300];
        nodes.push(processingNode);

        // 杩炴帴鍒颁笂涓€涓妭鐐?
        connections[lastNodeName] = {
          main: [[{ node: processingNode.name, type: "main", index: 0 }]],
        };

        lastNodeName = processingNode.name;
        xPosition += 200;
      }
    }

    // 3. 鍝嶅簲鑺傜偣
    nodes.push({
      id: "respond",
      name: "Respond to Webhook",
      type: COMMON_NODES.respondToWebhook.type,
      typeVersion: COMMON_NODES.respondToWebhook.typeVersion,
      position: [xPosition, 300],
      parameters: {
        respondWith: "json",
        responseBody: JSON.stringify(
          params.responseTemplate || { success: true, message: "Request received" },
        ),
        options: {},
      },
    });

    // 杩炴帴鍒板搷搴旇妭鐐?
    connections[lastNodeName] = {
      main: [[{ node: "Respond to Webhook", type: "main", index: 0 }]],
    };

    // 4. 鍒涘缓宸ヤ綔娴?
    const workflow = {
      name: params.name,
      nodes,
      connections,
      active: false,
      settings: {
        executionOrder: "v1",
      },
    };

    const creation = await this.createInactiveDraft({
      intent: params.name,
      activateIntent: params.activate === true,
      buildFallback: () => workflow,
      expectedNodeTypes: new Set(nodes.map((node) => node.type)),
    });
    if (!creation.success || !creation.workflow) return this.creationFailure(creation);
    const created = creation.workflow as N8nWorkflowResult;

    // 6. 鏋勯€?webhook URL
    const webhookUrl = this.buildWebhookUrl(this.inst.base_url, created.id, params.path);

    return {
      ...creation,
      webhookUrl,
      message: `Inactive webhook workflow draft created. Deploy and test it before sending ${params.method || "POST"} requests to: ${webhookUrl}`,
      testCommand: `curl -X ${params.method || "POST"} ${webhookUrl} -H "Content-Type: application/json" -d '{"test": true}'`,
    };
  }

  /**
   * 3. 鍒涘缓閭欢鑷姩鍖栧伐浣滄祦
   *
   * 鏀寔澶氱瑙﹀彂鍣細webhook, schedule, database
   * 鏈€甯哥敤鐨勮嚜鍔ㄥ寲鍦烘櫙涔嬩竴
   */
  async createEmailWorkflow(params: {
    name: string;
    trigger: "webhook" | "schedule" | "manual";
    triggerConfig?: {
      schedule?: string; // for schedule trigger
      webhookPath?: string; // for webhook trigger
    };
    email: {
      from?: string;
      to: string;
      subject: string;
      body: string;
      attachments?: Array<{ name: string; url: string }>;
    };
    conditions?: Array<{ field: string; operator: string; value: string }>; // Optional filtering
    activate?: boolean;
  }) {
    if (!isRecord(params.email)) {
      throw new Error("emailTemplate (object) is required");
    }

    const nodes = [];
    const connections: N8nConnections = {};

    let triggerNodeId: string;
    let scheduledNextRun: string | undefined;
    let xPosition = 250;

    // 1. 鍒涘缓瑙﹀彂鍣ㄨ妭鐐?
    switch (params.trigger) {
      case "schedule": {
        const cronExpression = this.parseToCron(params.triggerConfig?.schedule || "every day");
        scheduledNextRun = this.getNextRunTime(cronExpression);
        triggerNodeId = "schedule_trigger";
        nodes.push({
          id: triggerNodeId,
          name: "Schedule Trigger",
          type: COMMON_NODES.scheduleTrigger.type,
          typeVersion: COMMON_NODES.scheduleTrigger.typeVersion,
          position: [xPosition, 300],
          parameters: {
            rule: {
              interval: [{ cronExpression }],
            },
          },
        });
        break;
      }

      case "webhook":
        triggerNodeId = "webhook_trigger";
        nodes.push({
          id: triggerNodeId,
          name: "Webhook",
          type: COMMON_NODES.webhook.type,
          typeVersion: COMMON_NODES.webhook.typeVersion,
          position: [xPosition, 300],
          parameters: {
            path: params.triggerConfig?.webhookPath || "",
            httpMethod: "POST",
            responseMode: "onReceived",
          },
          webhookId: this.generateWebhookId(),
        });
        break;

      case "manual":
        triggerNodeId = "manual_trigger";
        nodes.push({
          id: triggerNodeId,
          name: "Manual Trigger",
          type: "n8n-nodes-base.manualTrigger",
          typeVersion: 1,
          position: [xPosition, 300],
          parameters: {},
        });
        break;

      default:
        throw new Error(`Unsupported trigger type: ${params.trigger}`);
    }

    xPosition += 200;
    let lastNodeName =
      params.trigger === "schedule"
        ? "Schedule Trigger"
        : params.trigger === "webhook"
          ? "Webhook"
          : "Manual Trigger";

    // 2. 娣诲姞鏉′欢杩囨护鑺傜偣锛堝鏋滄湁鏉′欢锛?
    if (params.conditions && params.conditions.length > 0) {
      const filterNodeId = "filter";
      nodes.push({
        id: filterNodeId,
        name: "Filter",
        type: COMMON_NODES.if.type,
        typeVersion: COMMON_NODES.if.typeVersion,
        position: [xPosition, 300],
        parameters: {
          conditions: {
            conditions: params.conditions.map((cond) => ({
              leftValue: `={{ $json.${cond.field} }}`,
              operation: cond.operator,
              rightValue: cond.value,
            })),
          },
        },
      });

      connections[lastNodeName] = {
        main: [[{ node: "Filter", type: "main", index: 0 }]],
      };

      lastNodeName = "Filter";
      xPosition += 200;
    }

    // 3. 鍒涘缓閭欢鍙戦€佽妭鐐?
    const emailNodeId = "send_email";
    const emailNode = this.createEmailNode(emailNodeId, params.email);
    emailNode.position = [xPosition, 300];

    // 娣诲姞闄勪欢閰嶇疆锛堝鏋滄湁锛?
    if (params.email.attachments && params.email.attachments.length > 0) {
      emailNode.parameters.attachments = params.email.attachments.map((att) => ({
        property: att.name,
        type: "url",
        url: att.url,
      }));
    }

    nodes.push(emailNode);

    // 杩炴帴鑺傜偣
    connections[lastNodeName] = {
      main: [[{ node: emailNode.name, type: "main", index: 0 }]],
    };

    // 4. 鍒涘缓宸ヤ綔娴?
    const workflow = {
      name: params.name,
      nodes,
      connections,
      active: false,
      settings: {
        executionOrder: "v1",
      },
    };

    const creation = await this.createInactiveDraft({
      intent: params.name,
      activateIntent: params.activate === true,
      buildFallback: () => workflow,
      expectedNodeTypes: new Set(nodes.map((node) => node.type)),
    });
    if (!creation.success || !creation.workflow) return this.creationFailure(creation);
    const created = creation.workflow as N8nWorkflowResult;

    // 6. 鏋勫缓鍝嶅簲
    const response: Record<string, unknown> = {
      ...creation,
      message: `Inactive email workflow draft created. It will send to ${params.email.to} after deployment.`,
    };

    // 娣诲姞瑙﹀彂鍣ㄧ壒瀹氫俊鎭?
    if (params.trigger === "schedule") {
      response.schedule = params.triggerConfig?.schedule || "every day";
      response.nextRun = scheduledNextRun;
    } else if (params.trigger === "webhook") {
      response.webhookUrl = this.buildWebhookUrl(
        this.inst.base_url,
        created.id,
        params.triggerConfig?.webhookPath,
      );
      response.testCommand = `curl -X POST ${response.webhookUrl} -H "Content-Type: application/json" -d '{"test": "data"}'`;
    }

    return response;
  }

  /**
   * 4. AI 鑱婂ぉ鏈哄櫒浜哄伐浣滄祦
   *
   * 2026 骞寸ぞ鍖烘渶楂樿姹傦紒闆嗘垚 AI 妯″瀷瀹炵幇鏅鸿兘瀵硅瘽
   */
  async createAIChatbotWorkflow(params: {
    name: string;
    aiProvider: "openai" | "anthropic" | "custom";
    aiConfig: {
      model?: string; // e.g., 'gpt-4', 'claude-3-opus'
      apiKey?: string;
      credentialId?: string;
      credentialName?: string;
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
    };
    interface: "webhook" | "slack" | "discord" | "telegram";
    interfaceConfig: {
      path?: string;
      humanEmail?: string;
      humanEmailCredentials?: Record<string, unknown>;
    };
    features?: {
      humanHandoff?: boolean; // 浜哄伐鎺ョ
      sentimentAnalysis?: boolean; // 鎯呮劅鍒嗘瀽
      contextMemory?: boolean; // 涓婁笅鏂囪蹇?
    };
    activate?: boolean;
  }) {
    const explicitModel =
      typeof params.aiConfig?.model === "string" ? params.aiConfig.model.trim() : "";
    if (!explicitModel) {
      throw new Error("AI model must be explicitly configured");
    }
    if (params.features?.humanHandoff) {
      if (
        typeof params.interfaceConfig?.humanEmail !== "string" ||
        params.interfaceConfig.humanEmail.trim().length === 0
      ) {
        throw new Error("Human handoff requires an explicit notification email");
      }
      if (
        !isRecord(params.interfaceConfig.humanEmailCredentials) ||
        Object.keys(params.interfaceConfig.humanEmailCredentials).length === 0
      ) {
        throw new Error("Human handoff requires explicit email credential references");
      }
    }

    const nodes = [];
    const connections: N8nConnections = {};
    let xPosition = 250;

    // 1. 鍒涘缓鎺ュ彛瑙﹀彂鍣ㄨ妭鐐?
    let triggerNodeName: string;
    let webhookUrl: string | undefined;

    switch (params.interface) {
      case "webhook":
        triggerNodeName = "Webhook";
        nodes.push({
          id: "webhook_trigger",
          name: "Webhook",
          type: COMMON_NODES.webhook.type,
          typeVersion: COMMON_NODES.webhook.typeVersion,
          position: [xPosition, 300],
          parameters: {
            path: params.interfaceConfig.path || "chatbot",
            httpMethod: "POST",
            responseMode: "lastNode",
          },
          webhookId: this.generateWebhookId(),
        });
        break;

      case "slack":
        triggerNodeName = "Slack Trigger";
        nodes.push({
          id: "slack_trigger",
          name: "Slack Trigger",
          type: "n8n-nodes-base.slackTrigger",
          typeVersion: 1,
          position: [xPosition, 300],
          parameters: {
            events: ["message"],
          },
        });
        break;

      default:
        throw new Error(`Interface ${params.interface} not yet supported. Use 'webhook' for now.`);
    }

    xPosition += 200;
    let lastNodeName = triggerNodeName;
    const openAiCredential =
      params.aiProvider === "openai" || params.features?.sentimentAnalysis
        ? this.requireCredentialReference(
            params.aiConfig,
            "openAiApi",
            "OpenAI credential reference is required",
          )
        : undefined;

    // 2. 鎻愬彇鐢ㄦ埛娑堟伅鑺傜偣
    const extractNodeId = "extract_message";
    nodes.push({
      id: extractNodeId,
      name: "Extract Message",
      type: COMMON_NODES.set.type,
      typeVersion: COMMON_NODES.set.typeVersion,
      position: [xPosition, 300],
      parameters: {
        mode: "manual",
        duplicateItem: false,
        assignments: {
          assignments: [
            {
              id: "user_message",
              name: "userMessage",
              value: "={{ $json.message || $json.text || $json.body }}",
              type: "string",
            },
            {
              id: "user_id",
              name: "userId",
              value: '={{ $json.user_id || $json.userId || "anonymous" }}',
              type: "string",
            },
          ],
        },
      },
    });

    connections[lastNodeName] = {
      main: [[{ node: "Extract Message", type: "main", index: 0 }]],
    };

    lastNodeName = "Extract Message";
    xPosition += 200;

    // 3. 鎯呮劅鍒嗘瀽鑺傜偣锛堝彲閫夛級
    if (params.features?.sentimentAnalysis) {
      const sentimentNodeId = "sentiment_analysis";
      nodes.push({
        id: sentimentNodeId,
        name: "Sentiment Analysis",
        type: COMMON_NODES.httpRequest.type,
        typeVersion: COMMON_NODES.httpRequest.typeVersion,
        position: [xPosition, 250],
        parameters: {
          method: "POST",
          url: "https://api.openai.com/v1/chat/completions",
          authentication: "genericCredentialType",
          options: {},
          sendBody: true,
          bodyParameters: {
            parameters: [
              {
                name: "model",
                value: explicitModel,
              },
              {
                name: "messages",
                value: JSON.stringify([
                  {
                    role: "system",
                    content: "Analyze sentiment and return only: positive, negative, or neutral",
                  },
                  {
                    role: "user",
                    content: "={{ $json.userMessage }}",
                  },
                ]),
              },
            ],
          },
        },
        credentials: {
          openAiApi: openAiCredential,
        },
      });

      connections[lastNodeName] = {
        main: [[{ node: "Sentiment Analysis", type: "main", index: 0 }]],
      };

      lastNodeName = "Sentiment Analysis";
      xPosition += 200;
    }

    // 4. AI 鍝嶅簲鑺傜偣
    const aiNodeId = "ai_response";
    let aiNode: N8nWorkflowNode;

    switch (params.aiProvider) {
      case "openai":
        // Security: Reject raw API keys - require n8n credentials
        if (params.aiConfig?.apiKey) {
          throw new Error(
            "Security: Raw API keys not allowed. Configure credentials in n8n and use credential references.",
          );
        }

        aiNode = {
          id: aiNodeId,
          name: "AI Response",
          type: COMMON_NODES.httpRequest.type,
          typeVersion: COMMON_NODES.httpRequest.typeVersion,
          position: [xPosition, 300],
          parameters: {
            method: "POST",
            url: "https://api.openai.com/v1/chat/completions",
            authentication: "genericCredentialType",
            sendHeaders: true,
            headerParameters: {
              parameters: [
                {
                  name: "Authorization",
                  value: "{{ $credentials.openAiApi.apiKey }}",
                },
              ],
            },
            sendBody: true,
            bodyParameters: {
              parameters: [
                {
                  name: "model",
                  value: explicitModel,
                },
                {
                  name: "messages",
                  value: JSON.stringify([
                    {
                      role: "system",
                      content: params.aiConfig.systemPrompt || "You are a helpful assistant.",
                    },
                    {
                      role: "user",
                      content: "={{ $json.userMessage }}",
                    },
                  ]),
                },
                {
                  name: "temperature",
                  value: params.aiConfig.temperature || 0.7,
                },
                {
                  name: "max_tokens",
                  value: params.aiConfig.maxTokens || 500,
                },
              ],
            },
          },
          credentials: {
            openAiApi: openAiCredential,
          },
        };
        break;

      case "anthropic":
        // Security: Reject raw API keys - require n8n credentials
        if (params.aiConfig?.apiKey) {
          throw new Error(
            "Security: Raw API keys not allowed. Configure credentials in n8n and use credential references.",
          );
        }

        aiNode = {
          id: aiNodeId,
          name: "AI Response (Claude)",
          type: COMMON_NODES.httpRequest.type,
          typeVersion: COMMON_NODES.httpRequest.typeVersion,
          position: [xPosition, 300],
          parameters: {
            method: "POST",
            url: "https://api.anthropic.com/v1/messages",
            sendHeaders: true,
            headerParameters: {
              parameters: [
                {
                  name: "x-api-key",
                  value: "{{ $credentials.anthropicApi.apiKey }}",
                },
                {
                  name: "anthropic-version",
                  value: "2023-06-01",
                },
              ],
            },
            sendBody: true,
            bodyParameters: {
              parameters: [
                {
                  name: "model",
                  value: explicitModel,
                },
                {
                  name: "system",
                  value: params.aiConfig.systemPrompt || "You are a helpful assistant.",
                },
                {
                  name: "messages",
                  value: JSON.stringify([{ role: "user", content: "={{ $json.userMessage }}" }]),
                },
                {
                  name: "max_tokens",
                  value: params.aiConfig.maxTokens || 500,
                },
              ],
            },
          },
        };
        break;

      default:
        throw new Error(`AI provider ${params.aiProvider} not yet supported`);
    }

    nodes.push(aiNode);
    connections[lastNodeName] = {
      main: [[{ node: aiNode.name, type: "main", index: 0 }]],
    };

    lastNodeName = aiNode.name;
    xPosition += 200;

    // 5. 浜哄伐鎺ョ妫€娴嬭妭鐐癸紙鍙€夛級
    if (params.features?.humanHandoff) {
      const handoffCheckId = "handoff_check";
      nodes.push({
        id: handoffCheckId,
        name: "Check for Human Handoff",
        type: COMMON_NODES.if.type,
        typeVersion: COMMON_NODES.if.typeVersion,
        position: [xPosition, 300],
        parameters: {
          conditions: {
            conditions: [
              {
                leftValue: "={{ $json.sentiment }}",
                operation: "equals",
                rightValue: "negative",
              },
              {
                leftValue: "={{ $json.userMessage }}",
                operation: "contains",
                rightValue: "speak to human",
              },
            ],
            combineOperation: "any",
          },
        },
      });

      connections[lastNodeName] = {
        main: [[{ node: "Check for Human Handoff", type: "main", index: 0 }]],
      };

      // 浜哄伐鎺ョ閫氱煡鑺傜偣
      const notifyHumanId = "notify_human";
      nodes.push({
        id: notifyHumanId,
        name: "Notify Human Agent",
        type: COMMON_NODES.emailSend.type,
        typeVersion: COMMON_NODES.emailSend.typeVersion,
        position: [xPosition + 200, 250],
        parameters: {
          toEmail: params.interfaceConfig.humanEmail,
          subject: "Human Handoff Required",
          message: `User needs human assistance:\n\nMessage: {{ $json.userMessage }}\nUser ID: {{ $json.userId }}`,
        },
        ...(isRecord(params.interfaceConfig.humanEmailCredentials)
          ? { credentials: params.interfaceConfig.humanEmailCredentials }
          : {}),
      });

      connections["Check for Human Handoff"] = {
        main: [
          [{ node: "Notify Human Agent", type: "main", index: 0 }], // true branch
          [], // false branch continues to response
        ],
      };

      lastNodeName = "Check for Human Handoff";
      xPosition += 200;
    }

    // 6. 鏍煎紡鍖栧搷搴旇妭鐐?
    const formatNodeId = "format_response";
    nodes.push({
      id: formatNodeId,
      name: "Format Response",
      type: COMMON_NODES.set.type,
      typeVersion: COMMON_NODES.set.typeVersion,
      position: [xPosition, 300],
      parameters: {
        mode: "manual",
        assignments: {
          assignments: [
            {
              id: "response",
              name: "response",
              value:
                params.aiProvider === "openai"
                  ? "={{ $json.choices[0].message.content }}"
                  : "={{ $json.content[0].text }}",
              type: "string",
            },
          ],
        },
      },
    });

    connections[lastNodeName] = {
      main: [[{ node: "Format Response", type: "main", index: 0 }]],
    };

    lastNodeName = "Format Response";
    xPosition += 200;

    // 7. 鍝嶅簲鑺傜偣锛堟牴鎹帴鍙ｇ被鍨嬶級
    if (params.interface === "webhook") {
      const respondNodeId = "respond";
      nodes.push({
        id: respondNodeId,
        name: "Respond to Webhook",
        type: COMMON_NODES.respondToWebhook.type,
        typeVersion: COMMON_NODES.respondToWebhook.typeVersion,
        position: [xPosition, 300],
        parameters: {
          respondWith: "json",
          responseBody: JSON.stringify({
            response: "={{ $json.response }}",
            userId: "={{ $json.userId }}",
          }),
        },
      });

      connections[lastNodeName] = {
        main: [[{ node: "Respond to Webhook", type: "main", index: 0 }]],
      };
    }

    // 8. 鍒涘缓宸ヤ綔娴?
    const workflow = {
      name: params.name,
      nodes,
      connections,
      active: false,
      settings: {
        executionOrder: "v1",
      },
    };

    const creation = await this.createInactiveDraft({
      intent: params.name,
      activateIntent: params.activate === true,
      buildFallback: () => workflow,
      expectedNodeTypes: new Set(nodes.map((node) => node.type)),
    });
    if (!creation.success || !creation.workflow) return this.creationFailure(creation);
    const created = creation.workflow as N8nWorkflowResult;

    // 11. 鏋勫缓鍝嶅簲
    const response: Record<string, unknown> = {
      ...creation,
      message: `Inactive AI chatbot workflow draft created with ${params.aiProvider}. Deploy and test it before activation.`,
      features: {
        aiProvider: params.aiProvider,
        interface: params.interface,
        humanHandoff: params.features?.humanHandoff || false,
        sentimentAnalysis: params.features?.sentimentAnalysis || false,
      },
    };

    if (params.interface === "webhook") {
      webhookUrl = this.buildWebhookUrl(
        this.inst.base_url,
        created.id,
        params.interfaceConfig.path,
      );
      response.webhookUrl = webhookUrl;
      response.testCommand = `curl -X POST ${webhookUrl} -H "Content-Type: application/json" -d '{"message": "Hello!"}'`;
    }

    return response;
  }

  /**
   * 5. 鑷姩淇宸ヤ綔娴侀敊璇?   *
   * 浣跨敤 AI 鍒嗘瀽骞朵慨澶嶅父瑙侀敊璇?   */
  async fixWorkflowErrors(
    params: {
      workflowId: string;
      autoFix?: boolean;
      errorContext?: string;
    },
    context?: ToolContext,
  ) {
    if (params.autoFix === true) {
      throw new Error(
        "Direct auto-fix is retired. Call fix_workflow_errors without autoFix, then use " +
          "preview_workflow_diff and update_partial_workflow with the returned operations.",
      );
    }

    // Validate and encode workflowId
    const workflowId = encodeURIComponent(String(params.workflowId));

    // 1. 鑾峰彇宸ヤ綔娴?
    const workflow = (await n8n(this.inst, `/api/v1/workflows/${workflowId}`)) as N8nWorkflowResult;

    // 2. 鑾峰彇鏈€杩戠殑鎵ц閿欒
    const executions = (await n8n(
      this.inst,
      `/api/v1/executions?workflowId=${workflowId}&status=error&limit=5`,
    )) as N8nExecutionRow[];

    if (!executions || executions.length === 0) {
      return {
        success: false,
        message: "No errors found in recent executions. Workflow appears to be working.",
      };
    }

    // 3. 鏀堕泦閿欒淇℃伅
    const errors = executions.map((exec) => ({
      executionId: exec.id,
      error: exec.data?.resultData?.error?.message || "Unknown error",
      node: exec.data?.resultData?.lastNodeExecuted,
      timestamp: exec.startedAt,
    }));

    const repair = classifyRepairEvidence(
      errors.map((error) => ({ error: error.error, node: error.node })),
    );
    const proposed = new WorkflowDiffService().applyOperations(
      workflow,
      repair.operations,
    ).workflow;
    const validation = await this.workflowValidationService.validateWorkflow(proposed);
    if (!validation.ok) {
      return {
        success: false,
        operations: [],
        recommendations: repair.recommendations,
        validation,
        message: "Proposed repair failed validation; workflow was not updated.",
      };
    }
    return {
      success: true,
      workflowId: params.workflowId,
      operations: repair.operations,
      recommendations: repair.recommendations,
      validation,
      nextAction: "preview_workflow_diff" as const,
      applied: false,
      message: "Repair proposal created. Preview these operations before applying them.",
    };

    /* Retired full-workflow repair implementation:

    // 4. 鍒嗘瀽閿欒妯″紡
    const errorAnalysis = this.analyzeErrors(errors);

    // 5. 鐢熸垚淇寤鸿
    const fixes = this.generateFixes(workflow, errorAnalysis);

    // 6. 濡傛灉 autoFix=true锛屽簲鐢ㄤ慨澶?
    let applied = false;
    let fixedWorkflow = null;

    if (params.autoFix === true && fixes.length > 0) {
      // 瀹夊叏妫€鏌ワ細涓嶈嚜鍔ㄤ慨鏀圭敓浜у伐浣滄祦
      if (workflow.active) {
        return {
          success: false,
          message: "Cannot auto-fix active workflow. Please deactivate first for safety.",
          errors: errorAnalysis,
          suggestedFixes: fixes,
        };
      }

      // 搴旂敤淇
      fixedWorkflow = this.applyFixes(workflow, fixes);

      // 鏇存柊宸ヤ綔娴?
      await n8n(this.inst, `/api/v1/workflows/${workflowId}`, {
        method: "PUT",
        body: JSON.stringify(fixedWorkflow),
      });

      applied = true;
    }

    return {
      success: true,
      applied,
      errors: errorAnalysis,
      fixes: fixes.map((f) => ({
        type: f.type,
        description: f.description,
        node: f.node,
        applied,
      })),
      message: applied
        ? `Applied ${fixes.length} fix(es) automatically. Test the workflow before activating.`
        : `Found ${fixes.length} suggested fix(es). Set autoFix=true to apply them.`,
    };
    */
  }

  /**
   * 6. 閮ㄧ讲骞舵祴璇曞伐浣滄祦
   */
  async deployAndTestWorkflow(
    params: {
      workflowId: string;
      testData?: unknown;
      validationRules?: Array<{ field: string; condition: string; expectedValue?: string }>;
      rollbackOnFailure?: boolean;
      confirm?: boolean;
      confirmationToken?: string;
    },
    context?: ToolContext,
  ) {
    if (!context?.user_id) throw new Error("Authentication required to deploy a workflow.");
    if (!isRecord(params.testData)) {
      throw new Error("Smoke test data is required before deployment.");
    }
    try {
      return await this.deploymentPipeline.deploy({
        userId: context.user_id,
        workflowId: params.workflowId,
        testData: params.testData,
        validationRules: params.validationRules,
        confirmationToken:
          params.confirm === true && typeof params.confirmationToken === "string"
            ? params.confirmationToken
            : undefined,
      });
    } catch (error) {
      if (!(error instanceof ConfirmationRequiredError)) throw error;
      if (params.confirm === true) {
        throw new Error(
          `Deploy and test workflow requires a valid confirmation token. Re-send with ` +
            `{"confirm": true, "confirmationToken": "${error.token}"} to proceed.`,
        );
      }
      throw new Error(
        `Deploy and test workflow requires confirmation. Re-send with ` +
          `{"confirm": true, "confirmationToken": "${error.token}"} to proceed.`,
      );
    }

    /* Retired deployment implementation:
    await this.requireConfirmation(
      params as Record<string, unknown>,
      "Deploy and test workflow",
      {
        requireToken: true,
        scope: {
          workflowId: params.workflowId,
          testData: params.testData,
          validationRules: params.validationRules,
          rollbackOnFailure: params.rollbackOnFailure,
        },
      },
      context,
    );

    const results = {
      validation: { passed: true, errors: [] as string[], warnings: [] as string[] },
      activation: { success: false, error: null as string | null },
      test: {
        success: false,
        skipped: false,
        output: null as Record<string, unknown> | null,
        error: null as string | null,
      },
    };

    try {
      // Validate and encode workflowId
      const workflowId = encodeURIComponent(String(params.workflowId));

      // 1. 楠岃瘉宸ヤ綔娴侀厤缃?
      const workflow = (await n8n(
        this.inst,
        `/api/v1/workflows/${workflowId}`,
      )) as N8nWorkflowResult;

      if (!workflow.nodes || workflow.nodes.length === 0) {
        results.validation.passed = false;
        results.validation.errors.push("Workflow has no nodes");
      }
      const validation = await this.workflowValidationService.validateWorkflow(workflow);
      results.validation.passed = validation.ok;
      results.validation.errors = validation.errors.map((issue) => issue.message);
      results.validation.warnings = validation.warnings.map((issue) => issue.message);
      if (
        (!workflow.nodes || workflow.nodes.length === 0) &&
        !results.validation.errors.includes("Workflow has no nodes")
      ) {
        results.validation.errors.push("Workflow has no nodes");
      }

      if (!results.validation.passed) {
        return { success: false, results, message: "Validation failed" };
      }

      if (!validation.canActivate) {
        return {
          success: false,
          results,
          validation,
          message: "Validation warnings block automatic activation",
        };
      }

      // 2. 鎵ц娴嬭瘯锛堝鏋滄彁渚涗簡娴嬭瘯鏁版嵁锛?
      if (params.testData) {
        try {
          const execution = (await n8n(this.inst, `/api/v1/workflows/${workflowId}/run`, {
            method: "POST",
            body: JSON.stringify({ workflowData: workflow, runData: params.testData }),
          })) as {
            finished?: boolean;
            data?: {
              resultData?: {
                error?: unknown;
                lastNodeExecuted?: { data: { main: Array<Record<string, unknown>> } };
              };
            };
          };

          results.test.success = execution.finished === true && !execution.data?.resultData?.error;
          results.test.output = execution.data?.resultData?.lastNodeExecuted
            ? execution.data.resultData.lastNodeExecuted.data.main[0]
            : null;

          // 4. 楠岃瘉杈撳嚭锛堝鏋滄彁渚涗簡楠岃瘉瑙勫垯锛?
          if (params.validationRules && results.test.output) {
            for (const rule of params.validationRules) {
              const isValid = this.validateOutput(results.test.output, rule);
              if (!isValid) {
                results.test.success = false;
                results.test.error = `Validation failed for field '${rule.field}': expected ${rule.condition} ${rule.expectedValue || ""}`;
                break;
              }
            }
          }
        } catch (testError) {
          results.test.success = false;
          results.test.error = testError instanceof Error ? testError.message : String(testError);
        }
      } else {
        results.test.success = false;
        results.test.skipped = true;
        results.test.error = "Smoke test data is required before activation.";
      }

      if (!results.test.success) {
        return {
          success: false,
          results,
          message: results.test.skipped
            ? "Smoke test data is required; workflow was not activated"
            : "Test failed, workflow was not activated",
        };
      }

      // 3. 婵€娲诲伐浣滄祦
      await n8n(this.inst, `/api/v1/workflows/${workflowId}/activate`, { method: "POST" });
      results.activation.success = true;

      return {
        success: true,
        results,
        message: results.test.skipped
          ? "Workflow deployed without test data; no smoke test was run."
          : results.test.success
            ? "Workflow deployed and tested successfully!"
            : "Workflow deployed but test had issues",
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.activation.error = message;
      return {
        success: false,
        results,
        message: `Deployment failed: ${message}`,
      };
    }
    */
  }

  // ============================================
  // 杈呭姪鏂规硶
  // ============================================

  /**
   * 瑙ｆ瀽涓?Cron 琛ㄨ揪寮?   */
  private parseToCron(schedule: string): string {
    // 绠€鍗曠殑浜虹被鍙鏍煎紡杞崲
    const patterns: Record<string, string> = {
      "every minute": "* * * * *",
      "every hour": "0 * * * *",
      "every day": "0 0 * * *",
      "every day at 9am": "0 9 * * *",
      "every day at 9:00": "0 9 * * *",
      "every week": "0 0 * * 0",
      "every monday": "0 0 * * 1",
      "every month": "0 0 1 * *",
    };

    const normalized = schedule.toLowerCase().trim();
    if (patterns[normalized]) {
      return patterns[normalized];
    }

    // 鍋囪宸茬粡鏄?cron 琛ㄨ揪寮?
    return schedule;
  }

  private requireCredentialReference(
    config: Record<string, unknown> | undefined,
    credentialType: string,
    message: string,
  ): { id: string; name: string } {
    const credentialId = typeof config?.credentialId === "string" ? config.credentialId.trim() : "";
    const credentialName =
      typeof config?.credentialName === "string" ? config.credentialName.trim() : "";

    if (!credentialId || !credentialName) {
      throw new Error(message);
    }

    return { id: credentialId, name: credentialName || credentialType };
  }

  /**
   * 鍒涘缓閭欢鑺傜偣
   */
  private createEmailNode(id: string, config: Record<string, unknown>): N8nWorkflowNode {
    const node: N8nWorkflowNode = {
      id,
      name: "Send Email",
      type: COMMON_NODES.emailSend.type,
      typeVersion: COMMON_NODES.emailSend.typeVersion,
      parameters: {
        fromEmail: config.from || "",
        toEmail: config.to || "",
        subject: config.subject || "Scheduled Email",
        message: config.body || "",
        options: {},
      },
    };

    if (isRecord(config.credentials)) {
      node.credentials = config.credentials;
    }

    return node;
  }

  /**
   * 鍒涘缓 HTTP 鑺傜偣
   */
  private createHttpNode(id: string, config: Record<string, unknown>): N8nWorkflowNode {
    const url = typeof config.url === "string" ? config.url.trim() : "";
    if (!url) {
      throw new Error("HTTP Request node requires an explicit URL");
    }

    return {
      id,
      name: "HTTP Request",
      type: COMMON_NODES.httpRequest.type,
      typeVersion: COMMON_NODES.httpRequest.typeVersion,
      parameters: {
        method: config.method || "GET",
        url,
        options: {},
      },
    };
  }

  /**
   * 鍒涘缓 Slack 鑺傜偣
   */
  private createSlackNode(id: string, config: Record<string, unknown>): N8nWorkflowNode {
    return {
      id,
      name: "Slack",
      type: "n8n-nodes-base.slack",
      typeVersion: 2,
      parameters: {
        resource: "message",
        operation: "post",
        channel: config.channel || "",
        text: config.message || "",
      },
    };
  }

  /**
   * 鍒涘缓 Set 鑺傜偣锛堟暟鎹浆鎹級
   */
  private createSetNode(id: string, config: Record<string, unknown>): N8nWorkflowNode {
    return {
      id,
      name: "Transform Data",
      type: COMMON_NODES.set.type,
      typeVersion: COMMON_NODES.set.typeVersion,
      parameters: {
        mode: "manual",
        duplicateItem: false,
        assignments: {
          assignments: config.mappings || [],
        },
        options: {},
      },
    };
  }

  /**
   * 鍒涘缓 IF 鑺傜偣锛堟潯浠跺垽鏂級
   */
  private createIfNode(id: string, config: Record<string, unknown>): N8nWorkflowNode {
    return {
      id,
      name: "Validate",
      type: COMMON_NODES.if.type,
      typeVersion: COMMON_NODES.if.typeVersion,
      parameters: {
        conditions: {
          conditions: config.conditions || [],
        },
      },
    };
  }

  /**
   * 鐢熸垚 Webhook ID
   */
  private generateWebhookId(): string {
    return Math.random().toString(36).substring(2, 15);
  }

  /**
   * 鏋勯€?Webhook URL
   */
  private buildWebhookUrl(baseUrl: string, workflowId: string, path?: string): string {
    const cleanBase = baseUrl.replace(/\/$/, "");
    const webhookPath = (path || workflowId).replace(/^\/+/, "");
    return `${cleanBase}/webhook/${webhookPath}`;
  }

  /**
   * 鑾峰彇涓嬫杩愯鏃堕棿锛堢畝鍖栫増锛?   */
  private getNextRunTime(cronExpression: string, currentDate = new Date()): string {
    try {
      return CronExpressionParser.parse(cronExpression, { currentDate })
        .next()
        .toDate()
        .toISOString();
    } catch {
      throw new Error(`Invalid cron expression: ${cronExpression}`);
    }
  }

  /**
   * 楠岃瘉杈撳嚭
   */
  private validateOutput(
    output: Record<string, unknown>,
    rule: { field: string; condition: string; expectedValue?: string },
  ): boolean {
    const value = output[rule.field];

    switch (rule.condition) {
      case "exists":
        return value !== undefined && value !== null;
      case "equals":
        return value === rule.expectedValue;
      case "contains":
        return typeof value === "string" && value.includes(rule.expectedValue || "");
      case "matches":
        return new RegExp(rule.expectedValue || "").test(String(value));
      default:
        return false;
    }
  }

  /**
   * 鍒嗘瀽閿欒妯″紡
   */
  private analyzeErrors(errors: Array<{ error: string; node?: string }>) {
    const errorPatterns: Record<string, { count: number; nodes: string[]; sample: string }> = {};

    for (const err of errors) {
      // 褰掔被閿欒绫诲瀷
      let category = "unknown";
      const errorMsg = err.error.toLowerCase();

      if (
        errorMsg.includes("authentication") ||
        errorMsg.includes("unauthorized") ||
        errorMsg.includes("api key")
      ) {
        category = "authentication";
      } else if (errorMsg.includes("timeout") || errorMsg.includes("timed out")) {
        category = "timeout";
      } else if (errorMsg.includes("not found") || errorMsg.includes("404")) {
        category = "not_found";
      } else if (errorMsg.includes("invalid") || errorMsg.includes("validation")) {
        category = "validation";
      } else if (errorMsg.includes("rate limit") || errorMsg.includes("too many requests")) {
        category = "rate_limit";
      } else if (errorMsg.includes("network") || errorMsg.includes("econnrefused")) {
        category = "network";
      }

      if (!errorPatterns[category]) {
        errorPatterns[category] = { count: 0, nodes: [], sample: err.error };
      }

      errorPatterns[category].count++;
      if (err.node && !errorPatterns[category].nodes.includes(err.node)) {
        errorPatterns[category].nodes.push(err.node);
      }
    }

    return errorPatterns;
  }

  /**
   * 鐢熸垚淇寤鸿
   */
  private generateFixes(workflow: N8nWorkflowResult, errorAnalysis: ErrorPatterns) {
    const fixes: Array<{
      type: string;
      description: string;
      node: string;
      fix: WorkflowFixDetail;
    }> = [];

    for (const [errorType, details] of Object.entries(errorAnalysis)) {
      switch (errorType) {
        case "authentication":
          fixes.push({
            type: "authentication",
            description: "Add or update authentication credentials",
            node: details.nodes[0],
            fix: {
              action: "add_credential",
              message: "Configure API credentials in node settings",
            },
          });
          break;

        case "timeout":
          fixes.push({
            type: "timeout",
            description: "Increase timeout duration",
            node: details.nodes[0],
            fix: {
              action: "update_timeout",
              newTimeout: 30000, // 30 seconds
            },
          });
          break;

        case "validation":
          fixes.push({
            type: "validation",
            description: "Fix data validation or format",
            node: details.nodes[0],
            fix: {
              action: "add_validation",
              message: "Add data transformation or validation node before this step",
            },
          });
          break;

        case "rate_limit":
          fixes.push({
            type: "rate_limit",
            description: "Add rate limiting or retry logic",
            node: details.nodes[0],
            fix: {
              action: "add_retry",
              retryConfig: {
                maxRetries: 3,
                waitBetween: 5000,
              },
            },
          });
          break;

        case "network":
          fixes.push({
            type: "network",
            description: "Check network connectivity and endpoints",
            node: details.nodes[0],
            fix: {
              action: "verify_endpoint",
              message: "Verify the URL is correct and the service is reachable",
            },
          });
          break;

        default:
          fixes.push({
            type: "unknown",
            description: `Manual review needed: ${details.sample}`,
            node: details.nodes[0],
            fix: {
              action: "manual_review",
              message: "This error requires manual investigation",
            },
          });
      }
    }

    return fixes;
  }

  /**
   * 搴旂敤淇鍒板伐浣滄祦
   */
  private applyFixes(
    workflow: N8nWorkflowResult,
    fixes: Array<{ type: string; node: string; fix: WorkflowFixDetail }>,
  ) {
    const updatedWorkflow = JSON.parse(JSON.stringify(workflow)) as N8nWorkflowResult;

    for (const fix of fixes) {
      const node = updatedWorkflow.nodes?.find((n) => n.id === fix.node || n.name === fix.node);

      if (!node) continue;

      switch (fix.fix.action) {
        case "update_timeout": {
          const options = (node.parameters.options as Record<string, unknown>) || {};
          node.parameters.timeout = fix.fix.newTimeout;
          options.timeout = fix.fix.newTimeout;
          node.parameters.options = options;
          break;
        }

        case "add_retry": {
          const options = (node.parameters.options as Record<string, unknown>) || {};
          options.retry = {
            enabled: true,
            maxRetries: fix.fix.retryConfig?.maxRetries,
            waitBetween: fix.fix.retryConfig?.waitBetween,
          };
          node.parameters.options = options;
          break;
        }

        // 鍏朵粬淇绫诲瀷闇€瑕佹墜鍔ㄥ鐞嗭紝鍙湪鍏冩暟鎹腑鏍囪
        default:
          node._fixApplied = fix.type;
      }
    }

    return updatedWorkflow;
  }

  private async capableOfElicitation(context?: ToolContext): Promise<boolean> {
    return !!(
      context?.clientCapabilities?.elicitation && typeof context.requestElicitation === "function"
    );
  }

  private async requestUserConfirmation(
    context: ToolContext | undefined,
    operation: string,
    args: Record<string, unknown>,
  ): Promise<boolean> {
    if (!context?.requestElicitation || !context.clientCapabilities?.elicitation) {
      return false;
    }

    try {
      const response = await context.requestElicitation({
        title: operation,
        description: `Please confirm operation on workflow ${String(args.workflowId ?? args.id ?? "target")}.`,
        schema: {
          type: "object",
          properties: {
            confirm: {
              type: "boolean",
              title: "Confirm this action",
              description: "Set true to proceed.",
            },
          },
          required: ["confirm"],
        },
      });
      return response.confirm === true;
    } catch {
      return false;
    }
  }

  private async requireConfirmation(
    args: Record<string, unknown>,
    operation: string,
    opts: { requireToken?: boolean; scope?: unknown } = {},
    context?: ToolContext,
  ): Promise<void> {
    if (opts.requireToken && (await this.capableOfElicitation(context))) {
      const confirmed = await this.requestUserConfirmation(context, operation, args);
      if (!confirmed) {
        throw new Error(`${operation} requires user confirmation via elicitation flow.`);
      }
      return;
    }

    if (!opts.requireToken) {
      if (args.confirm !== true) {
        throw new Error(
          `${operation} requires confirmation. Re-send with "confirm": true to proceed.`,
        );
      }
      return;
    }

    const challengeKey = `${operation}:${stableStringify(opts.scope ?? {})}`;
    const now = Date.now();
    const existing = this.confirmationChallenges.get(challengeKey);

    if (
      args.confirm === true &&
      typeof args.confirmationToken === "string" &&
      existing?.token === args.confirmationToken &&
      existing.expiresAt > now
    ) {
      this.confirmationChallenges.delete(challengeKey);
      return;
    }

    const token = `mcp_confirm_${randomBytes(16).toString("base64url")}`;
    this.confirmationChallenges.set(challengeKey, {
      token,
      expiresAt: now + CONFIRMATION_TOKEN_TTL_MS,
    });

    if (args.confirm === true) {
      throw new Error(
        `${operation} requires a valid confirmation token. Re-send with ` +
          `{"confirm": true, "confirmationToken": "${token}"} to proceed.`,
      );
    }

    throw new Error(
      `${operation} requires confirmation. Re-send with ` +
        `{"confirm": true, "confirmationToken": "${token}"} to proceed.`,
    );
  }
}
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
