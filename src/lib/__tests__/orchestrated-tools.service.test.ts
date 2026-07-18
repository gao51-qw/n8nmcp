import { describe, it, expect, vi, beforeEach } from "vitest";
import { OrchestratedToolsService } from "../orchestrated-tools.service";
import type { KnowledgeClient } from "../workflow-agent/knowledge-client.server";
import { ConfirmationRequiredError } from "../workflow-agent/confirmation.server";

// The service reaches n8n exclusively through the SSRF-guarded fetch helper.
// Mock it so we can assert on the exact (url, init) pairs and feed canned
// responses without any network access.
const safeFetchPublicUrl = vi.fn();
vi.mock("../ssrf-guard.server", () => ({
  safeFetchPublicUrl: (...args: unknown[]) => safeFetchPublicUrl(...args),
}));

const INST = {
  id: "instance-123",
  name: "Test Instance",
  base_url: "https://n8n.example.com",
  api_key: "test-key",
};

/** Build a minimal Response-like object the `n8n()` helper understands. */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

/** The last segment of the path the helper was called with, for assertions. */
function calledPaths(): string[] {
  return safeFetchPublicUrl.mock.calls.map((c) => String(c[0]).replace(INST.base_url, ""));
}

function extractConfirmationToken(error: unknown): string {
  const match = String((error as Error).message).match(/confirmationToken": "([^"]+)"/);
  return match?.[1] ?? "";
}

function createAuthoritativeKnowledgeClient(): KnowledgeClient {
  return {
    searchTemplates: vi.fn().mockResolvedValue([]),
    getTemplate: vi.fn(),
    searchNodes: vi.fn(),
    getNode: vi.fn().mockResolvedValue({}),
    validateNode: vi.fn().mockResolvedValue({ ok: true }),
    validateWorkflow: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe("OrchestratedToolsService", () => {
  let service: OrchestratedToolsService;

  beforeEach(() => {
    safeFetchPublicUrl.mockReset();
    const tokens = new Map<string, string>();
    const confirmationService = {
      requireOrConsume: vi.fn(
        async (input: { action: string; scope: unknown; confirmationToken?: string }) => {
          const key = `${input.action}:${JSON.stringify(input.scope)}`;
          if (input.confirmationToken && tokens.get(key) === input.confirmationToken) {
            tokens.delete(key);
            return;
          }
          const token = `mcp_confirm_${tokens.size + 1}`;
          tokens.set(key, token);
          throw new ConfirmationRequiredError(token, "2026-07-10T00:05:00.000Z", input.action);
        },
      ),
    };
    service = new OrchestratedToolsService(INST, {
      knowledgeClient: createAuthoritativeKnowledgeClient(),
      confirmationService,
    });
    const deploy = service.deployAndTestWorkflow.bind(service);
    service.deployAndTestWorkflow = ((params, context) =>
      deploy(params, context ?? { user_id: "test-user" })) as typeof service.deployAndTestWorkflow;
  });

  describe("createScheduledWorkflow", () => {
    it("rejects missing actionConfig before building action nodes", async () => {
      await expect(
        service.callTool("create_scheduled_workflow", {
          name: "Daily Report",
          schedule: "every day at 9am",
          action: "send_email",
        }),
      ).rejects.toThrow("actionConfig (object) is required");
      expect(safeFetchPublicUrl).not.toHaveBeenCalled();
    });

    it("records activation intent while creating an inactive scheduled email draft", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "workflow-123", active: false }));

      const result = (await service.createScheduledWorkflow({
        name: "Daily Report",
        schedule: "every day at 9am",
        action: "send_email",
        actionConfig: {
          to: "test@example.com",
          subject: "Daily Report",
          body: "Here is your report",
          credentials: { smtp: { id: "smtp-1", name: "Transactional SMTP" } },
        },
        activate: true,
      })) as { success: boolean; workflow: { active: boolean }; message: string };

      expect(result.success).toBe(true);
      expect(result.workflow.active).toBe(false);
      expect(result.message).toContain("inactive");

      // First call is the workflow create with both nodes.
      const createBody = JSON.parse(String(safeFetchPublicUrl.mock.calls[0][1].body));
      expect(createBody.name).toBe("Daily Report");
      expect(createBody.nodes.map((n: { type: string }) => n.type)).toEqual(
        expect.arrayContaining(["n8n-nodes-base.scheduleTrigger", "n8n-nodes-base.emailSend"]),
      );
      expect(createBody.connections).toMatchObject({
        "Schedule Trigger": {
          main: [[{ node: "Send Email", type: "main", index: 0 }]],
        },
      });

      expect(calledPaths()).not.toContain("/api/v1/workflows/workflow-123/activate");
    });

    it("does not expose an n8n draft error response body", async () => {
      const canary = "task-3-service-upstream-secret";
      safeFetchPublicUrl.mockResolvedValueOnce(
        jsonResponse({ message: `database failed: ${canary}`, apiKey: canary }, false, 502),
      );

      const error = await service
        .createScheduledWorkflow({
          name: "Daily Report",
          schedule: "every day at 9am",
          action: "send_email",
          actionConfig: {
            to: "test@example.com",
            subject: "Daily Report",
            body: "Here is your report",
            credentials: { smtp: { id: "smtp-1", name: "Transactional SMTP" } },
          },
          activate: false,
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toBe("Error: n8n request failed with status 502");
      expect(String(error)).not.toContain(canary);
      expect(safeFetchPublicUrl).toHaveBeenCalledOnce();
    });

    it("parses a human-readable schedule to cron", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "wf-1", active: false }));

      await service.createScheduledWorkflow({
        name: "Test",
        schedule: "every hour",
        action: "http_request",
        actionConfig: { url: "https://api.example.com" },
        activate: false,
      });

      const createBody = JSON.parse(String(safeFetchPublicUrl.mock.calls[0][1].body));
      const trigger = createBody.nodes.find((n: { type: string }) =>
        n.type.includes("scheduleTrigger"),
      );
      expect(trigger.parameters.rule.interval[0].cronExpression).toBe("0 * * * *");
    });

    it("builds an HTTP request action node", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "wf-2", active: false }));

      await service.createScheduledWorkflow({
        name: "API Sync",
        schedule: "0 9 * * *",
        action: "http_request",
        actionConfig: { method: "POST", url: "https://api.example.com/sync" },
        activate: false,
      });

      const createBody = JSON.parse(String(safeFetchPublicUrl.mock.calls[0][1].body));
      const httpNode = createBody.nodes.find((n: { type: string }) =>
        n.type.includes("httpRequest"),
      );
      expect(httpNode.parameters.method).toBe("POST");
      expect(httpNode.parameters.url).toBe("https://api.example.com/sync");
    });

    it("rejects an HTTP request action without an explicit URL before creating a workflow", async () => {
      await expect(
        service.createScheduledWorkflow({
          name: "Broken API Sync",
          schedule: "0 9 * * *",
          action: "http_request",
          actionConfig: { method: "POST" },
          activate: false,
        }),
      ).rejects.toThrow("HTTP Request node requires an explicit URL");

      expect(safeFetchPublicUrl).not.toHaveBeenCalled();
    });

    it("does not activate when activate is false", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "wf-3", active: false }));

      const result = (await service.createScheduledWorkflow({
        name: "Test",
        schedule: "every day",
        action: "send_email",
        actionConfig: {
          to: "test@example.com",
          subject: "Scheduled Email",
          body: "Body",
          credentials: { smtp: { id: "smtp-1", name: "Transactional SMTP" } },
        },
        activate: false,
      })) as { workflow: { active?: boolean } };

      // Only the create call happened — no activate.
      expect(safeFetchPublicUrl).toHaveBeenCalledTimes(1);
      expect(result.workflow.active).toBeFalsy();
    });
  });

  describe("createWebhookWorkflow", () => {
    it("creates a basic webhook workflow with respond node", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "webhook-wf-1", active: false }));

      const result = (await service.createWebhookWorkflow({
        name: "API Endpoint",
        method: "POST",
        activate: true,
      })) as { success: boolean; webhookUrl: string; testCommand: string };

      expect(result.success).toBe(true);
      expect(result.webhookUrl).toContain("/webhook/");
      expect(result.testCommand).toContain("curl");
      expect(calledPaths()).not.toContain("/api/v1/workflows/webhook-wf-1/activate");

      const createBody = JSON.parse(String(safeFetchPublicUrl.mock.calls[0][1].body));
      expect(createBody.nodes.map((n: { type: string }) => n.type)).toEqual(
        expect.arrayContaining(["n8n-nodes-base.webhook", "n8n-nodes-base.respondToWebhook"]),
      );
      expect(createBody.connections).toMatchObject({
        Webhook: {
          main: [[{ node: "Respond to Webhook", type: "main", index: 0 }]],
        },
      });
    });

    it("inserts processing steps between trigger and respond", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "wf-4", active: false }));

      await service.createWebhookWorkflow({
        name: "With Processing",
        activate: false,
        processing: [
          {
            action: "transform",
            config: { mappings: [{ from: "{{$json.email}}", to: "userEmail" }] },
          },
          { action: "validate", config: { conditions: [{ field: "email", operator: "exists" }] } },
        ],
      });

      const createBody = JSON.parse(String(safeFetchPublicUrl.mock.calls[0][1].body));
      expect(createBody.nodes.length).toBeGreaterThan(2); // webhook + processing + respond
    });

    it("uses a custom response template", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "wf-5", active: false }));

      await service.createWebhookWorkflow({
        name: "Custom Response",
        activate: false,
        responseTemplate: { status: "ok", data: { received: true } },
      });

      const createBody = JSON.parse(String(safeFetchPublicUrl.mock.calls[0][1].body));
      const respondNode = createBody.nodes.find((n: { type: string }) =>
        n.type.includes("respondToWebhook"),
      );
      const responseBody = JSON.parse(respondNode.parameters.responseBody);
      expect(responseBody.status).toBe("ok");
      expect(responseBody.data.received).toBe(true);
    });

    it("supports a custom webhook path", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "wf-6", active: false }));

      const result = (await service.createWebhookWorkflow({
        name: "Custom Path",
        path: "/api/v1/users",
        activate: false,
      })) as { webhookUrl: string };

      expect(result.webhookUrl).toContain("/webhook/api/v1/users");
    });
  });

  describe("createEmailWorkflow", () => {
    it("accepts the advertised emailTemplate argument shape", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "email-wf-1", active: false }));

      const result = (await service.callTool("create_email_workflow", {
        name: "Welcome Email",
        trigger: "manual",
        emailTemplate: {
          from: "hello@example.com",
          to: "{{email}}",
          subject: "Welcome",
          body: "Glad you are here",
          credentials: { smtp: { id: "smtp-1", name: "Transactional SMTP" } },
        },
        activate: true,
      })) as {
        success: boolean;
        message: string;
        activationIntent: boolean;
        nextAction: string;
      };

      expect(result.success).toBe(true);
      expect(result.message).toContain("{{email}}");
      expect(result.activationIntent).toBe(true);
      expect(result.nextAction).toBe("deploy_and_test_workflow");
      expect(calledPaths()).not.toContain("/api/v1/workflows/email-wf-1/activate");

      const createBody = JSON.parse(String(safeFetchPublicUrl.mock.calls[0][1].body));
      const emailNode = createBody.nodes.find((n: { type: string }) =>
        n.type.includes("emailSend"),
      );
      expect(emailNode.parameters).toMatchObject({
        fromEmail: "hello@example.com",
        toEmail: "{{email}}",
        subject: "Welcome",
        message: "Glad you are here",
      });
      expect(emailNode.credentials).toEqual({
        smtp: { id: "smtp-1", name: "Transactional SMTP" },
      });
    });
  });

  describe("createAIChatbotWorkflow", () => {
    it("maps supported legacy chatbot aliases into the executable shape", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "chatbot-wf-1", active: false }));

      const result = (await service.callTool("create_ai_chatbot_workflow", {
        name: "Support Bot",
        platform: "webhook",
        aiProvider: "openai",
        aiConfig: {
          model: "gpt-4.1",
          credentialId: "openai-cred-1",
          credentialName: "OpenAI Production",
        },
        systemPrompt: "Answer product questions clearly.",
        escalationRules: {
          keywords: ["refund"],
          sentimentThreshold: 0.25,
          maxTurns: 3,
        },
        humanNotification: {
          method: "email",
          recipient: "support@example.com",
          credentials: { smtp: { id: "smtp-1", name: "Support SMTP" } },
        },
        activate: true,
      })) as { success: boolean; webhookUrl: string; activationIntent: boolean };

      expect(result.success).toBe(true);
      expect(result.webhookUrl).toBe("https://n8n.example.com/webhook/chatbot-wf-1");
      expect(result.activationIntent).toBe(true);
      expect(calledPaths()).not.toContain("/api/v1/workflows/chatbot-wf-1/activate");

      const createBody = JSON.parse(String(safeFetchPublicUrl.mock.calls[0][1].body));
      const aiNode = createBody.nodes.find((n: { id: string }) => n.id === "ai_response");
      expect(aiNode.credentials).toEqual({
        openAiApi: { id: "openai-cred-1", name: "OpenAI Production" },
      });
      const messagesParam = aiNode.parameters.bodyParameters.parameters.find(
        (p: { name: string }) => p.name === "messages",
      );
      expect(messagesParam.value).toContain("Answer product questions clearly.");

      const sentimentNode = createBody.nodes.find(
        (n: { id: string }) => n.id === "sentiment_analysis",
      );
      const sentimentModel = sentimentNode.parameters.bodyParameters.parameters.find(
        (p: { name: string }) => p.name === "model",
      );
      expect(sentimentModel.value).toBe("gpt-4.1");
      expect(sentimentNode.credentials).toEqual({
        openAiApi: { id: "openai-cred-1", name: "OpenAI Production" },
      });
    });

    it("rejects OpenAI chatbot creation without an explicit model before creating a workflow", async () => {
      await expect(
        service.callTool("create_ai_chatbot_workflow", {
          name: "Support Bot",
          platform: "webhook",
          aiProvider: "openai",
          systemPrompt: "Answer product questions clearly.",
          activate: false,
        }),
      ).rejects.toThrow("AI model must be explicitly configured");

      expect(safeFetchPublicUrl).not.toHaveBeenCalled();
    });

    it("rejects human handoff without an explicit recipient", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(
        jsonResponse({ id: "chatbot-missing-recipient", active: false }),
      );

      await expect(
        service.callTool("create_ai_chatbot_workflow", {
          name: "Support Bot",
          platform: "webhook",
          aiProvider: "openai",
          aiConfig: {
            model: "gpt-4.1",
            credentialId: "openai-cred-1",
            credentialName: "OpenAI Production",
          },
          features: { humanHandoff: true },
          interfaceConfig: {
            humanEmailCredentials: { smtp: { id: "smtp-1", name: "Support SMTP" } },
          },
          activate: false,
        }),
      ).rejects.toThrow(/explicit notification email/);

      expect(safeFetchPublicUrl).not.toHaveBeenCalled();
    });

    it("rejects human handoff without explicit email credentials", async () => {
      await expect(
        service.callTool("create_ai_chatbot_workflow", {
          name: "Support Bot",
          platform: "webhook",
          aiProvider: "openai",
          aiConfig: {
            model: "gpt-4.1",
            credentialId: "openai-cred-1",
            credentialName: "OpenAI Production",
          },
          features: { humanHandoff: true },
          interfaceConfig: { humanEmail: "support@example.org" },
          activate: false,
        }),
      ).rejects.toThrow(/credential references/);

      expect(safeFetchPublicUrl).not.toHaveBeenCalled();
    });

    it("rejects OpenAI chatbot creation without a structured credential reference", async () => {
      await expect(
        service.callTool("create_ai_chatbot_workflow", {
          name: "Support Bot",
          platform: "webhook",
          aiProvider: "openai",
          aiConfig: { model: "gpt-4.1" },
          systemPrompt: "Answer product questions clearly.",
          activate: false,
        }),
      ).rejects.toThrow("OpenAI credential reference is required");

      expect(safeFetchPublicUrl).not.toHaveBeenCalled();
    });
  });

  describe("deployAndTestWorkflow", () => {
    const workflow = {
      id: "test-wf-1",
      name: "Test Workflow",
      active: false,
      nodes: [
        { id: "node1", type: "trigger" },
        { id: "node2", type: "action" },
      ],
      connections: {},
    };

    async function issueDeployConfirmationToken(params: Record<string, unknown>) {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse(workflow));
      try {
        await service.deployAndTestWorkflow(params as never);
      } catch (error) {
        safeFetchPublicUrl.mockClear();
        return extractConfirmationToken(error);
      }
      return "";
    }

    it("requires a confirmation token before deploying a workflow", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse(workflow));
      await expect(
        service.deployAndTestWorkflow({ workflowId: "test-wf-1", testData: {} }),
      ).rejects.toThrow(/requires confirmation/);
      expect(calledPaths()).toEqual(["/api/v1/workflows/test-wf-1"]);
    });

    it("rejects deployment when confirm true is supplied without the issued token", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse(workflow));
      await expect(
        service.deployAndTestWorkflow({
          workflowId: "test-wf-1",
          testData: {},
          confirm: true,
        } as never),
      ).rejects.toThrow(/confirmation token/);
      expect(calledPaths()).toEqual(["/api/v1/workflows/test-wf-1"]);
    });

    it("deploys, runs and validates successfully", async () => {
      const deployArgs = {
        workflowId: "test-wf-1",
        testData: { test: true },
        validationRules: [
          { field: "status", condition: "equals", expectedValue: "success" },
          { field: "email", condition: "exists" },
        ],
      };
      const confirmationToken = await issueDeployConfirmationToken(deployArgs);
      expect(confirmationToken).toMatch(/^mcp_confirm_/);
      expect(safeFetchPublicUrl).not.toHaveBeenCalled();

      safeFetchPublicUrl
        .mockResolvedValueOnce(jsonResponse(workflow)) // GET workflow
        .mockResolvedValueOnce(
          jsonResponse({
            finished: true,
            data: {
              resultData: {
                lastNodeExecuted: {
                  data: { main: [{ status: "success", email: "test@example.com" }] },
                },
              },
            },
          }),
        ) // POST run
        .mockResolvedValueOnce(jsonResponse({ success: true })); // POST activate

      const result = (await service.deployAndTestWorkflow({
        ...deployArgs,
        confirm: true,
        confirmationToken,
      } as never)) as {
        success: boolean;
        results: {
          validation: { passed: boolean };
          activation: { success: boolean };
          test: { success: boolean };
        };
      };

      expect(result.success).toBe(true);
      expect(result.results.validation.passed).toBe(true);
      expect(result.results.activation.success).toBe(true);
      expect(result.results.test.success).toBe(true);
    });

    it("runs smoke test before activating when test data is supplied", async () => {
      const deployArgs = {
        workflowId: "test-wf-1",
        testData: { test: true },
      };
      const confirmationToken = await issueDeployConfirmationToken(deployArgs);
      expect(confirmationToken).toMatch(/^mcp_confirm_/);

      safeFetchPublicUrl
        .mockResolvedValueOnce(jsonResponse(workflow)) // GET workflow
        .mockResolvedValueOnce(
          jsonResponse({
            finished: true,
            data: {
              resultData: {
                lastNodeExecuted: {
                  data: { main: [{ status: "success" }] },
                },
              },
            },
          }),
        ) // POST run
        .mockResolvedValueOnce(jsonResponse({ success: true })); // POST activate

      const result = (await service.deployAndTestWorkflow({
        ...deployArgs,
        confirm: true,
        confirmationToken,
      } as never)) as { success: boolean };

      expect(result.success).toBe(true);
      expect(calledPaths().slice(0, 3)).toEqual([
        "/api/v1/workflows/test-wf-1",
        "/api/v1/workflows/test-wf-1/run",
        "/api/v1/workflows/test-wf-1/activate",
      ]);
    });

    it("fails validation when the workflow has no nodes", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "empty-wf", nodes: [] }));

      const result = (await service.deployAndTestWorkflow({
        workflowId: "empty-wf",
        testData: {},
      } as never)) as {
        success: boolean;
        results: { validation: { passed: boolean; errors: string[] } };
      };

      expect(result.success).toBe(false);
      expect(result.results.validation.passed).toBe(false);
      expect(result.results.validation.errors).toContain("Workflow has no nodes");
    });

    it("rejects omitted testData before reading or mutating n8n", async () => {
      await expect(service.deployAndTestWorkflow({ workflowId: "test-wf-1" })).rejects.toThrow(
        "Smoke test data is required",
      );
      expect(safeFetchPublicUrl).not.toHaveBeenCalled();
    });

    it("blocks activation when workflow validation has warnings", async () => {
      const deployArgs = {
        workflowId: "warn-wf",
        testData: { test: true },
      };
      const confirmationToken = await issueDeployConfirmationToken(deployArgs);
      expect(confirmationToken).toMatch(/^mcp_confirm_/);

      safeFetchPublicUrl.mockResolvedValueOnce(
        jsonResponse({
          id: "warn-wf",
          name: "Warn Workflow",
          active: false,
          nodes: [
            {
              id: "webhook",
              name: "Webhook",
              type: "n8n-nodes-base.webhook",
              parameters: { httpMethod: "POST" },
            },
          ],
          connections: {},
        }),
      );

      const result = (await service.deployAndTestWorkflow({
        ...deployArgs,
        confirm: true,
        confirmationToken,
      } as never)) as {
        success: boolean;
        message: string;
        results: { validation: { passed: boolean; warnings: string[] } };
      };

      expect(result.success).toBe(false);
      expect(result.message).toContain("Validation warnings block automatic activation");
      expect(result.results.validation.passed).toBe(true);
      expect(result.results.validation.warnings.length).toBeGreaterThan(0);
      expect(calledPaths()).not.toContain("/api/v1/workflows/warn-wf/run");
      expect(calledPaths()).not.toContain("/api/v1/workflows/warn-wf/activate");
    });

    it("does not activate when the smoke test fails", async () => {
      const deployArgs = {
        workflowId: "test-wf-1",
        testData: { test: true },
        rollbackOnFailure: true,
      };
      const confirmationToken = await issueDeployConfirmationToken(deployArgs);
      expect(confirmationToken).toMatch(/^mcp_confirm_/);
      expect(safeFetchPublicUrl).not.toHaveBeenCalled();

      safeFetchPublicUrl
        .mockResolvedValueOnce(jsonResponse(workflow)) // GET
        .mockResolvedValueOnce(
          jsonResponse({ finished: false, data: { resultData: { error: "Test failed" } } }),
        ); // run

      const result = (await service.deployAndTestWorkflow({
        ...deployArgs,
        confirm: true,
        confirmationToken,
      } as never)) as { success: boolean; message: string };

      expect(result.success).toBe(false);
      expect(result.message).toContain("not activated");
      expect(calledPaths()).not.toContain("/api/v1/workflows/test-wf-1/activate");
      expect(calledPaths()).not.toContain("/api/v1/workflows/test-wf-1/deactivate");
    });

    it("validates output against rules and fails on mismatch", async () => {
      const deployArgs = {
        workflowId: "test-wf-1",
        testData: { test: true },
        validationRules: [{ field: "status", condition: "equals", expectedValue: "success" }],
        rollbackOnFailure: true,
      };
      const confirmationToken = await issueDeployConfirmationToken(deployArgs);
      expect(confirmationToken).toMatch(/^mcp_confirm_/);
      expect(safeFetchPublicUrl).not.toHaveBeenCalled();

      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse(workflow)).mockResolvedValueOnce(
        jsonResponse({
          finished: true,
          data: {
            resultData: {
              lastNodeExecuted: {
                data: { main: [{ status: "fail", email: "test@example.com" }] },
              },
            },
          },
        }),
      );

      const result = (await service.deployAndTestWorkflow({
        ...deployArgs,
        confirm: true,
        confirmationToken,
      } as never)) as { success: boolean; results: { test: { error: string | null } } };

      expect(result.success).toBe(false);
      expect(result.results.test.error).toContain("Validation failed");
      expect(calledPaths()).not.toContain("/api/v1/workflows/test-wf-1/activate");
    });

    it("does not roll back when rollbackOnFailure is false", async () => {
      const deployArgs = {
        workflowId: "test-wf-1",
        testData: { test: true },
        rollbackOnFailure: false,
      };
      const confirmationToken = await issueDeployConfirmationToken(deployArgs);
      expect(confirmationToken).toMatch(/^mcp_confirm_/);
      expect(safeFetchPublicUrl).not.toHaveBeenCalled();

      safeFetchPublicUrl
        .mockResolvedValueOnce(jsonResponse(workflow))
        .mockResolvedValueOnce(
          jsonResponse({ finished: false, data: { resultData: { error: "Test failed" } } }),
        );

      await service.deployAndTestWorkflow({
        ...deployArgs,
        confirm: true,
        confirmationToken,
      } as never);

      expect(calledPaths()).not.toContain("/api/v1/workflows/test-wf-1/deactivate");
      expect(calledPaths()).not.toContain("/api/v1/workflows/test-wf-1/activate");
    });
  });

  describe("fixWorkflowErrors", () => {
    async function issueFixConfirmationToken(params: Record<string, unknown>) {
      try {
        await service.callTool("fix_workflow_errors", params);
      } catch (error) {
        return extractConfirmationToken(error);
      }
      return "";
    }

    it("does not require a confirmation token when only suggesting fixes", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "wf-fix-1" }));
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse([]));

      const result = (await service.callTool("fix_workflow_errors", {
        workflowId: "wf-fix-1",
      })) as { success: boolean; message: string };

      expect(result.success).toBe(false);
      expect(result.message).toContain("No errors found");
      expect(
        safeFetchPublicUrl.mock.calls.some(
          ([url, init]) =>
            String(url).endsWith("/api/v1/workflows/wf-fix-1") &&
            (init as RequestInit | undefined)?.method === "PUT",
        ),
      ).toBe(false);
    });

    it("rejects the retired direct auto-fix mode before reading or mutating n8n", async () => {
      await expect(
        service.callTool("fix_workflow_errors", {
          workflowId: "wf-fix-1",
          autoFix: true,
        }),
      ).rejects.toThrow(/preview_workflow_diff/);
      expect(safeFetchPublicUrl).not.toHaveBeenCalled();
    });

    it("rejects auto-apply when confirm true is supplied without the issued token", async () => {
      await expect(
        service.callTool("fix_workflow_errors", {
          workflowId: "wf-fix-1",
          autoFix: true,
          confirm: true,
        }),
      ).rejects.toThrow(/preview_workflow_diff/);
      expect(safeFetchPublicUrl).not.toHaveBeenCalled();
    });

    it("does not treat the removed autoApply alias as mutation intent", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "wf-fix-legacy" }));
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse([]));

      const result = (await service.callTool("fix_workflow_errors", {
        workflowId: "wf-fix-legacy",
        autoApply: true,
      })) as { success: boolean; applied?: boolean };

      expect(result.success).toBe(false);
      expect(result.applied).not.toBe(true);
      expect(safeFetchPublicUrl).toHaveBeenCalledTimes(2);
      expect(
        safeFetchPublicUrl.mock.calls.some(
          (call) => (call[1] as RequestInit | undefined)?.method === "PUT",
        ),
      ).toBe(false);
    });

    it("returns supported operations without PUT or private marker mutation", async () => {
      safeFetchPublicUrl
        .mockResolvedValueOnce(
          jsonResponse({
            id: "wf-fix-1",
            active: false,
            nodes: [
              {
                id: "http",
                name: "HTTP Request",
                parameters: { options: {} },
              },
            ],
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse([
            {
              id: "exec-1",
              startedAt: "2026-01-01T00:00:00.000Z",
              data: {
                resultData: {
                  error: { message: "Request timed out" },
                  lastNodeExecuted: "HTTP Request",
                },
              },
            },
          ]),
        );

      const result = (await service.callTool("fix_workflow_errors", {
        workflowId: "wf-fix-1",
      })) as { success: boolean; operations: unknown[]; nextAction: string };

      expect(result.success).toBe(true);
      expect(result.operations).toEqual([
        {
          type: "updateNode",
          nodeId: "HTTP Request",
          changes: { parameters: { options: { timeout: 30000 } } },
        },
      ]);
      expect(result.nextAction).toBe("preview_workflow_diff");
      expect(JSON.stringify(result)).not.toContain("_fixApplied");
      expect(
        safeFetchPublicUrl.mock.calls.some((call) =>
          ["PUT", "PATCH"].includes(String((call[1] as RequestInit | undefined)?.method)),
        ),
      ).toBe(false);
    });
  });

  describe("helper methods", () => {
    it("returns a real future ISO next-run timestamp", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-07-13T00:00:00.000Z"));
      try {
        safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "wf-next", active: false }));

        const result = (await service.createScheduledWorkflow({
          name: "Hourly health check",
          schedule: "0 * * * *",
          action: "http_request",
          actionConfig: { method: "GET", url: "https://example.org/health" },
          activate: false,
        })) as { nextRun: string };

        expect(result.nextRun).toBe("2026-07-13T01:00:00.000Z");
      } finally {
        vi.useRealTimers();
      }
    });

    it("rejects invalid cron before creating a workflow", async () => {
      safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "wf-invalid", active: false }));

      await expect(
        service.createScheduledWorkflow({
          name: "Invalid schedule",
          schedule: "not a cron expression",
          action: "http_request",
          actionConfig: { method: "GET", url: "https://example.org/health" },
          activate: false,
        }),
      ).rejects.toThrow(/Invalid cron expression/);

      expect(safeFetchPublicUrl).not.toHaveBeenCalled();
    });

    it("parses various schedule formats to cron", async () => {
      const cases = [
        { input: "every minute", expected: "* * * * *" },
        { input: "every hour", expected: "0 * * * *" },
        { input: "every day", expected: "0 0 * * *" },
        { input: "every day at 9am", expected: "0 9 * * *" },
        { input: "every monday", expected: "0 0 * * 1" },
        { input: "0 9 * * *", expected: "0 9 * * *" }, // already cron
      ];

      for (const { input, expected } of cases) {
        safeFetchPublicUrl.mockResolvedValueOnce(jsonResponse({ id: "test", active: false }));

        await service.createScheduledWorkflow({
          name: "Test",
          schedule: input,
          action: "send_email",
          actionConfig: {
            to: "test@example.com",
            subject: "Scheduled Email",
            body: "Body",
            credentials: { smtp: { id: "smtp-1", name: "Transactional SMTP" } },
          },
          activate: false,
        });

        const lastCall = safeFetchPublicUrl.mock.calls[safeFetchPublicUrl.mock.calls.length - 1];
        const body = JSON.parse(String(lastCall[1].body));
        const trigger = body.nodes.find((n: { type: string }) =>
          n.type.includes("scheduleTrigger"),
        );
        expect(trigger.parameters.rule.interval[0].cronExpression).toBe(expected);
      }
    });

    it("validates output correctly across conditions", () => {
      const output = {
        status: "success",
        email: "test@example.com",
        count: 5,
        url: "https://example.com/page",
      };
      const v = (rule: { field: string; condition: string; expectedValue?: string }) =>
        (
          service as unknown as { validateOutput: (o: unknown, r: unknown) => boolean }
        ).validateOutput(output, rule);

      expect(v({ field: "email", condition: "exists" })).toBe(true);
      expect(v({ field: "missing", condition: "exists" })).toBe(false);
      expect(v({ field: "status", condition: "equals", expectedValue: "success" })).toBe(true);
      expect(v({ field: "status", condition: "equals", expectedValue: "fail" })).toBe(false);
      expect(v({ field: "email", condition: "contains", expectedValue: "@example.com" })).toBe(
        true,
      );
      expect(v({ field: "email", condition: "contains", expectedValue: "@other.com" })).toBe(false);
      expect(v({ field: "url", condition: "matches", expectedValue: "^https://" })).toBe(true);
      expect(v({ field: "url", condition: "matches", expectedValue: "^http://[^s]" })).toBe(false);
    });
  });
});
