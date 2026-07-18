import { NODE_REGISTRY, type NodeTemplate } from "./node-registry";

export type WorkflowAgentRiskLevel = "low" | "medium" | "high";

export type WorkflowValidationIssue = {
  code: string;
  message: string;
  nodeId?: string;
  nodeName?: string;
  path?: string;
  severity: "error" | "warning";
};

export type WorkflowValidationResult = {
  ok: boolean;
  errors: WorkflowValidationIssue[];
  warnings: WorkflowValidationIssue[];
  riskLevel: WorkflowAgentRiskLevel;
  canActivate: boolean;
};

export type WorkflowOperation =
  | { type: "updateNode"; nodeId: string; changes: Record<string, unknown> }
  | { type: "addNode"; node: Record<string, unknown> }
  | { type: "removeNode"; nodeId: string }
  | {
      type: "addConnection";
      source: string;
      target: string;
      sourcePort?: string;
      targetPort?: string;
      sourceIndex?: number;
      targetIndex?: number;
    }
  | {
      type: "removeConnection";
      source: string;
      target: string;
      sourcePort?: string;
      targetPort?: string;
      sourceIndex?: number;
      targetIndex?: number;
    }
  | { type: "cleanStaleConnections" };

export type WorkflowDiffSummary = {
  changedNodes: string[];
  addedNodes: string[];
  removedNodes: string[];
  changedConnections: Array<{ source: string; target?: string; change: string }>;
  operations: WorkflowOperation[];
  riskLevel: WorkflowAgentRiskLevel;
};

export type WorkflowPolicyContext = {
  readOnly?: boolean;
  disabledTools?: string[];
  disabledOperations?: string[];
  environment?: "development" | "staging" | "production";
  confirmed?: boolean;
};

type WorkflowNode = Record<string, unknown> & {
  id?: string;
  name?: string;
  type?: string;
  parameters?: Record<string, unknown>;
  credentials?: unknown;
};

export type WorkflowLike = {
  id?: string | number;
  name?: string;
  active?: boolean;
  nodes?: WorkflowNode[];
  connections?: WorkflowConnections;
  settings?: Record<string, unknown>;
  [key: string]: unknown;
};

type ConnectionItem = {
  node?: string;
  type?: string;
  index?: number;
  [key: string]: unknown;
};

type WorkflowConnections = Record<string, { main?: ConnectionItem[][]; [key: string]: unknown }>;

type IssueInput = Omit<WorkflowValidationIssue, "severity">;

export type NodeKnowledgeSearchResult = {
  nodeType: string;
  packageName?: string;
  displayName: string;
  description?: string;
  category?: string;
  isTrigger?: boolean;
  isWebhook?: boolean;
  isAiTool?: boolean;
};

export type NodeKnowledgeDetail = NodeKnowledgeSearchResult & {
  essentials: unknown[];
  credentials: unknown[];
  operations: unknown[];
};

export type TemplateSearchResult = {
  id: string | number;
  name: string;
  description?: string;
  nodeTypes?: string[];
  confidence?: number;
};

export type WorkflowTemplateDetail = TemplateSearchResult & {
  workflow: unknown | null;
};

export class WorkflowValidationService {
  async validateWorkflow(workflow: WorkflowLike): Promise<WorkflowValidationResult> {
    const errors: WorkflowValidationIssue[] = [];
    const warnings: WorkflowValidationIssue[] = [];
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    const connections = isRecord(workflow.connections) ? workflow.connections : {};

    if (nodes.length === 0) {
      errors.push(
        this.error({
          code: "workflow.empty",
          message: "Workflow must contain at least one node.",
          path: "nodes",
        }),
      );
    }

    this.validateUniqueNodes(nodes, errors);

    for (const node of nodes) {
      this.validateNodeDefaults(node, errors, warnings);
      this.validateExpressions(node, warnings);
    }

    this.validateConnections(connections, nodes, errors);

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      riskLevel: errors.length > 0 ? "high" : warnings.length > 0 ? "medium" : "low",
      canActivate: errors.length === 0 && warnings.length === 0,
    };
  }

  private validateNodeDefaults(
    node: WorkflowNode,
    errors: WorkflowValidationIssue[],
    warnings: WorkflowValidationIssue[],
  ): void {
    const parameters = isRecord(node.parameters) ? node.parameters : {};
    const normalizedType = String(node.type ?? "").toLowerCase();

    if (node.type === "n8n-nodes-base.webhook") {
      if (!hasExplicitValue(parameters.httpMethod)) {
        warnings.push(
          this.warning({
            code: "defaults.webhook.httpMethod",
            message: "Webhook node should set an explicit HTTP method.",
            nodeId: node.id,
            nodeName: node.name,
            path: this.nodePath(node, "parameters.httpMethod"),
          }),
        );
      }

      if (!hasExplicitValue(parameters.path)) {
        warnings.push(
          this.warning({
            code: "defaults.webhook.path",
            message: "Webhook node should set an explicit path.",
            nodeId: node.id,
            nodeName: node.name,
            path: this.nodePath(node, "parameters.path"),
          }),
        );
      }

      if (!hasExplicitValue(parameters.responseMode)) {
        warnings.push(
          this.warning({
            code: "defaults.webhook.responseMode",
            message: "Webhook node should set an explicit response mode.",
            nodeId: node.id,
            nodeName: node.name,
            path: this.nodePath(node, "parameters.responseMode"),
          }),
        );
      }
    }

    if (node.type === "n8n-nodes-base.respondToWebhook") {
      if (!hasExplicitValue(parameters.respondWith)) {
        warnings.push(
          this.warning({
            code: "defaults.respondToWebhook.respondWith",
            message: "Respond to Webhook node should set an explicit response type.",
            nodeId: node.id,
            nodeName: node.name,
            path: this.nodePath(node, "parameters.respondWith"),
          }),
        );
      }

      if (!hasExplicitValue(parameters.responseBody)) {
        warnings.push(
          this.warning({
            code: "defaults.respondToWebhook.responseBody",
            message: "Respond to Webhook node should set an explicit response body.",
            nodeId: node.id,
            nodeName: node.name,
            path: this.nodePath(node, "parameters.responseBody"),
          }),
        );
      }
    }

    if (node.type === "n8n-nodes-base.httpRequest") {
      this.validateHttpRequestNode(node, parameters, errors, warnings);
    }

    if (node.type === "n8n-nodes-base.emailSend") {
      if (!hasExplicitValue(parameters.toEmail)) {
        errors.push(
          this.error({
            code: "defaults.email.toEmail",
            message: "Email node requires an explicit recipient.",
            nodeId: node.id,
            nodeName: node.name,
            path: this.nodePath(node, "parameters.toEmail"),
          }),
        );
      }
      if (!hasExplicitValue(parameters.subject)) {
        errors.push(
          this.error({
            code: "defaults.email.subject",
            message: "Email node requires an explicit subject.",
            nodeId: node.id,
            nodeName: node.name,
            path: this.nodePath(node, "parameters.subject"),
          }),
        );
      }
      if (!hasExplicitValue(parameters.message) && !hasExplicitValue(parameters.text)) {
        errors.push(
          this.error({
            code: "defaults.email.message",
            message: "Email node requires an explicit body or message.",
            nodeId: node.id,
            nodeName: node.name,
            path: this.nodePath(node, "parameters.message"),
          }),
        );
      }
      if (!node.credentials) {
        errors.push(
          this.error({
            code: "defaults.email.credentials",
            message: "Email node must use explicit n8n credential references.",
            nodeId: node.id,
            nodeName: node.name,
            path: this.nodePath(node, "credentials"),
          }),
        );
      }
    }

    if (normalizedType.endsWith(".if") || normalizedType.includes("switch")) {
      if (!hasExplicitValue(parameters.conditions)) {
        errors.push(
          this.error({
            code: "defaults.branch.conditions",
            message: "IF/Switch nodes must explicitly define branch conditions.",
            nodeId: node.id,
            nodeName: node.name,
            path: this.nodePath(node, "parameters.conditions"),
          }),
        );
      }
    }

    if (normalizedType.includes("merge")) {
      if (!hasExplicitValue(parameters.mode) && !hasExplicitValue(parameters.mergeMode)) {
        errors.push(
          this.error({
            code: "defaults.merge.mode",
            message: "Merge nodes must explicitly define merge mode.",
            nodeId: node.id,
            nodeName: node.name,
            path: this.nodePath(node, "parameters.mode"),
          }),
        );
      }
    }

    if (
      normalizedType.includes("openai") ||
      normalizedType.includes("langchain") ||
      normalizedType.includes("lmchat")
    ) {
      if (!hasExplicitValue(parameters.model) && !hasExplicitValue(parameters.modelId)) {
        errors.push(
          this.error({
            code: "defaults.ai.model",
            message: "AI nodes must explicitly define the provider/model.",
            nodeId: node.id,
            nodeName: node.name,
            path: this.nodePath(node, "parameters.model"),
          }),
        );
      }
      if (!node.credentials) {
        errors.push(
          this.error({
            code: "defaults.ai.credentials",
            message: "AI nodes must use explicit n8n credential references.",
            nodeId: node.id,
            nodeName: node.name,
            path: this.nodePath(node, "credentials"),
          }),
        );
      }
    }
  }

  private validateHttpRequestNode(
    node: WorkflowNode,
    parameters: Record<string, unknown>,
    errors: WorkflowValidationIssue[],
    warnings: WorkflowValidationIssue[],
  ): void {
    if (!hasExplicitValue(parameters.url)) {
      errors.push(
        this.error({
          code: "defaults.httpRequest.url",
          message: "HTTP Request node requires an explicit URL.",
          nodeId: node.id,
          nodeName: node.name,
          path: this.nodePath(node, "parameters.url"),
        }),
      );
    }

    if (!hasExplicitValue(parameters.method)) {
      warnings.push(
        this.warning({
          code: "defaults.httpRequest.method",
          message: "HTTP Request node should set an explicit method.",
          nodeId: node.id,
          nodeName: node.name,
          path: this.nodePath(node, "parameters.method"),
        }),
      );
    }

    if (!hasExplicitValue(parameters.authentication)) {
      warnings.push(
        this.warning({
          code: "defaults.httpRequest.authentication",
          message: "HTTP Request node should explicitly declare its auth mode.",
          nodeId: node.id,
          nodeName: node.name,
          path: this.nodePath(node, "parameters.authentication"),
        }),
      );
    }

    const method = String(parameters.method ?? "GET").toUpperCase();
    if (
      ["POST", "PUT", "PATCH", "DELETE"].includes(method) &&
      !this.hasExplicitBodyBehavior(parameters)
    ) {
      warnings.push(
        this.warning({
          code: "defaults.httpRequest.bodyMode",
          message:
            "HTTP Request write methods should explicitly define body/query/header behavior.",
          nodeId: node.id,
          nodeName: node.name,
          path: this.nodePath(node, "parameters"),
        }),
      );
    }

    const url = typeof parameters.url === "string" ? parameters.url : "";
    if (url.includes("api.openai.com") && !hasCredential(node.credentials, "openAiApi")) {
      errors.push(
        this.error({
          code: "defaults.ai.credentials",
          message: "OpenAI HTTP Request node must use a structured openAiApi credential reference.",
          nodeId: node.id,
          nodeName: node.name,
          path: this.nodePath(node, "credentials.openAiApi"),
        }),
      );
    }

    if (usesCredentialExpression(parameters) && !node.credentials) {
      errors.push(
        this.error({
          code: "defaults.httpRequest.credentials",
          message:
            "HTTP Request credential expressions require structured n8n credentials on the node.",
          nodeId: node.id,
          nodeName: node.name,
          path: this.nodePath(node, "credentials"),
        }),
      );
    }
  }

  private validateUniqueNodes(nodes: WorkflowNode[], errors: WorkflowValidationIssue[]): void {
    const seenIds = new Set<string>();
    const seenNames = new Set<string>();

    for (const node of nodes) {
      if (node.id) {
        if (seenIds.has(node.id)) {
          errors.push(
            this.error({
              code: "workflow.duplicateNodeId",
              message: `Workflow contains duplicate node id "${node.id}".`,
              nodeId: node.id,
              nodeName: node.name,
              path: "nodes",
            }),
          );
        }
        seenIds.add(node.id);
      }

      if (node.name) {
        if (seenNames.has(node.name)) {
          errors.push(
            this.error({
              code: "workflow.duplicateNodeName",
              message: `Workflow contains duplicate node name "${node.name}".`,
              nodeId: node.id,
              nodeName: node.name,
              path: "nodes",
            }),
          );
        }
        seenNames.add(node.name);
      }
    }
  }

  private validateConnections(
    connections: Record<string, unknown>,
    nodes: WorkflowNode[],
    errors: WorkflowValidationIssue[],
  ): void {
    const knownNodeNames = new Set<string>();

    for (const node of nodes) {
      if (node.name) knownNodeNames.add(node.name);
    }

    for (const [sourceName, sourceConnections] of Object.entries(connections)) {
      if (!knownNodeNames.has(sourceName)) {
        errors.push(
          this.error({
            code: "connections.sourceMissing",
            message: `Connection source "${sourceName}" does not match a workflow node.`,
            nodeName: sourceName,
            path: `connections.${sourceName}`,
          }),
        );
      }

      for (const targetName of this.extractConnectionTargets(sourceConnections)) {
        if (!knownNodeNames.has(targetName)) {
          errors.push(
            this.error({
              code: "connections.targetMissing",
              message: `Connection target "${targetName}" does not match a workflow node.`,
              nodeName: targetName,
              path: `connections.${sourceName}`,
            }),
          );
        }
      }
    }
  }

  private extractConnectionTargets(value: unknown): string[] {
    if (!isRecord(value)) return [];
    const targets: string[] = [];

    for (const outputTypeGroups of Object.values(value)) {
      if (!Array.isArray(outputTypeGroups)) continue;
      for (const outputIndexGroup of outputTypeGroups) {
        if (!Array.isArray(outputIndexGroup)) continue;
        for (const connectionItem of outputIndexGroup) {
          if (isRecord(connectionItem) && typeof connectionItem.node === "string") {
            targets.push(connectionItem.node);
          }
        }
      }
    }

    return targets;
  }

  private validateExpressions(node: WorkflowNode, warnings: WorkflowValidationIssue[]): void {
    const parameters = isRecord(node.parameters) ? node.parameters : {};

    for (const path of findUnbalancedExpressionPaths(parameters, "parameters")) {
      warnings.push(
        this.warning({
          code: "expressions.unbalancedBraces",
          message: "Expression appears to contain unbalanced braces.",
          nodeId: node.id,
          nodeName: node.name,
          path: this.nodePath(node, path),
        }),
      );
    }
  }

  private hasExplicitBodyBehavior(parameters: Record<string, unknown>): boolean {
    return [
      "sendBody",
      "body",
      "jsonBody",
      "bodyParameters",
      "sendQuery",
      "queryParameters",
      "sendHeaders",
      "headerParameters",
    ].some((field) => hasExplicitValue(parameters[field]));
  }

  private nodePath(node: WorkflowNode, childPath: string): string {
    return node.name ? `nodes.${node.name}.${childPath}` : `nodes.${childPath}`;
  }

  private error(issue: IssueInput): WorkflowValidationIssue {
    return { ...issue, severity: "error" };
  }

  private warning(issue: IssueInput): WorkflowValidationIssue {
    return { ...issue, severity: "warning" };
  }
}

export class WorkflowDiffService {
  applyOperations(
    workflow: WorkflowLike,
    operations: WorkflowOperation[],
  ): { workflow: WorkflowLike; diff: WorkflowDiffSummary } {
    const next = clone(workflow);
    next.nodes = Array.isArray(next.nodes) ? next.nodes : [];
    next.connections = isRecord(next.connections) ? next.connections : {};

    const diff: WorkflowDiffSummary = {
      changedNodes: [],
      addedNodes: [],
      removedNodes: [],
      changedConnections: [],
      operations,
      riskLevel: "low",
    };

    for (const operation of operations) {
      switch (operation.type) {
        case "updateNode":
          this.updateNode(next, operation.nodeId, operation.changes, diff);
          break;
        case "addNode":
          this.addNode(next, operation.node, diff);
          break;
        case "removeNode":
          this.removeNode(next, operation.nodeId, diff);
          break;
        case "addConnection":
          this.addConnection(next, operation, diff);
          break;
        case "removeConnection":
          this.removeConnection(next, operation, diff);
          break;
        case "cleanStaleConnections":
          this.cleanStaleConnections(next, diff);
          break;
      }
    }

    diff.riskLevel = this.calculateRiskLevel(diff);

    return { workflow: next, diff };
  }

  private updateNode(
    workflow: WorkflowLike,
    nodeId: string,
    changes: Record<string, unknown>,
    diff: WorkflowDiffSummary,
  ): void {
    const node = workflow.nodes?.find(
      (candidate) => candidate.id === nodeId || candidate.name === nodeId,
    );

    if (!node) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    deepMergeInto(node, changes);
    addUnique(diff.changedNodes, nodeId);
  }

  private addNode(
    workflow: WorkflowLike,
    node: Record<string, unknown>,
    diff: WorkflowDiffSummary,
  ): void {
    workflow.nodes?.push(clone(node) as WorkflowNode);
    diff.addedNodes.push(String(node.id ?? node.name ?? "new-node"));
  }

  private removeNode(workflow: WorkflowLike, nodeId: string, diff: WorkflowDiffSummary): void {
    const nodes = workflow.nodes ?? [];
    const before = nodes.length;
    workflow.nodes = nodes.filter((node) => node.id !== nodeId && node.name !== nodeId);

    if (workflow.nodes.length === before) {
      throw new Error(`Node not found: ${nodeId}`);
    }

    diff.removedNodes.push(nodeId);
    this.cleanStaleConnections(workflow, diff);
  }

  private addConnection(
    workflow: WorkflowLike,
    operation: Extract<WorkflowOperation, { type: "addConnection" }>,
    diff: WorkflowDiffSummary,
  ): void {
    const sourceIndex = operation.sourceIndex ?? 0;
    const sourcePort = operation.sourcePort ?? "main";
    const targetIndex = operation.targetIndex ?? 0;
    const targetPort = operation.targetPort ?? "main";
    const connections = workflow.connections ?? {};
    const sourceConnections = (connections[operation.source] ??= {});
    const sourceGroups = ensureConnectionGroups(sourceConnections, sourcePort);
    const group = (sourceGroups[sourceIndex] ??= []);

    group.push({
      node: operation.target,
      type: targetPort,
      index: targetIndex,
    });

    workflow.connections = connections;
    diff.changedConnections.push({
      source: operation.source,
      target: operation.target,
      change: "added",
    });
  }

  private removeConnection(
    workflow: WorkflowLike,
    operation: Extract<WorkflowOperation, { type: "removeConnection" }>,
    diff: WorkflowDiffSummary,
  ): void {
    const sourcePort = operation.sourcePort ?? "main";
    const sourceGroups = workflow.connections?.[operation.source]?.[sourcePort];

    if (!Array.isArray(sourceGroups)) return;

    const groupIndexes =
      operation.sourceIndex === undefined
        ? sourceGroups.map((_, index) => index)
        : [operation.sourceIndex];
    let removed = false;

    for (const groupIndex of groupIndexes) {
      const group = sourceGroups[groupIndex];
      if (!Array.isArray(group)) continue;
      const kept = group.filter((connection) => {
        const matchesTarget = connection?.node === operation.target;
        const matchesTargetIndex =
          operation.targetIndex === undefined || connection?.index === operation.targetIndex;
        const matchesTargetPort =
          operation.targetPort === undefined || connection?.type === operation.targetPort;
        const shouldRemove = matchesTarget && matchesTargetIndex && matchesTargetPort;
        removed ||= shouldRemove;
        return !shouldRemove;
      });

      group.splice(0, group.length, ...kept);
    }

    if (removed) {
      diff.changedConnections.push({
        source: operation.source,
        target: operation.target,
        change: "removed",
      });
    }
  }

  private cleanStaleConnections(workflow: WorkflowLike, diff: WorkflowDiffSummary): void {
    const connections = workflow.connections ?? {};
    const nodeNames = new Set(
      (workflow.nodes ?? [])
        .map((node) => node.name)
        .filter((name): name is string => typeof name === "string" && name.length > 0),
    );

    for (const [source, sourceConnections] of Object.entries(connections)) {
      if (!nodeNames.has(source)) {
        delete connections[source];
        diff.changedConnections.push({ source, change: "removed-stale-source" });
        continue;
      }

      for (const sourceGroups of Object.values(sourceConnections)) {
        if (!Array.isArray(sourceGroups)) continue;
        for (const group of sourceGroups) {
          if (!Array.isArray(group)) continue;
          const kept = group.filter((connection) => {
            return typeof connection?.node !== "string" || nodeNames.has(connection.node);
          });

          if (kept.length !== group.length) {
            group.splice(0, group.length, ...kept);
            diff.changedConnections.push({ source, change: "removed-stale-target" });
          }
        }
      }
    }

    workflow.connections = connections;
  }

  private calculateRiskLevel(diff: WorkflowDiffSummary): WorkflowAgentRiskLevel {
    if (diff.removedNodes.length > 0) return "high";
    if (
      diff.changedNodes.length > 0 ||
      diff.addedNodes.length > 0 ||
      diff.changedConnections.length > 0
    ) {
      return "medium";
    }
    return "low";
  }
}

export class WorkflowOperationPolicyService {
  assertToolAllowed(toolName: string, context: WorkflowPolicyContext = {}) {
    if (context.readOnly && !isReadOnlyTool(toolName)) {
      throw new Error(`Tool is disabled in read-only mode: ${toolName}`);
    }

    if (context.disabledTools?.includes(toolName)) {
      throw new Error(`Tool is disabled by policy: ${toolName}`);
    }
  }

  assertOperationsAllowed(
    operations: WorkflowOperation[],
    context: WorkflowPolicyContext = {},
    workflow?: { active?: boolean },
  ) {
    for (const operation of operations) {
      if (context.disabledOperations?.includes(operation.type)) {
        throw new Error(`Workflow operation is disabled by policy: ${operation.type}`);
      }
    }

    if (workflow?.active && context.environment === "production" && !context.confirmed) {
      throw new Error("Updating an active production workflow requires confirmation.");
    }
  }
}

export class NodeKnowledgeService {
  async searchNodes(
    query: string,
    limit = 20,
  ): Promise<{ query: string; count: number; results: NodeKnowledgeSearchResult[] }> {
    const normalizedQuery = query.trim().toLowerCase();
    const maxResults = normalizeLimit(limit);
    const results = Object.values(NODE_REGISTRY)
      .filter((node) => this.matchesSearch(node, normalizedQuery))
      .slice(0, maxResults)
      .map((node) => this.toSearchResult(node));

    return { query, count: results.length, results };
  }

  async getNode(nodeType: string): Promise<NodeKnowledgeDetail | { error: string }> {
    const node = this.findNode(nodeType);
    if (!node) {
      return { error: `node not found: ${nodeType}` };
    }

    return {
      ...this.toSearchResult(node),
      essentials: (node.requiredParams ?? []).map((name) => ({ name })),
      credentials: node.credentialType ? [{ name: node.credentialType }] : [],
      operations: Object.entries(node.actions ?? {}).map(([name, action]) => ({
        name,
        description: action.label,
        resource: action.resource,
        operation: action.operation,
        requiredParams: action.requiredParams,
      })),
    };
  }

  async validateNode(
    nodeType: string,
    parameters: Record<string, unknown> = {},
    credentials?: Record<string, unknown>,
  ): Promise<WorkflowValidationResult> {
    const requestedNodeType = nodeType.trim();
    if (!requestedNodeType) {
      return {
        ok: false,
        errors: [
          {
            code: "node.type.required",
            message: "nodeType is required.",
            severity: "error",
            path: "nodeType",
          },
        ],
        warnings: [],
        riskLevel: "high",
        canActivate: false,
      };
    }

    const node = this.findNode(requestedNodeType);
    const resolvedNodeType = node?.n8nType ?? requestedNodeType;
    const nodeName = node?.label ?? requestedNodeType;

    return new WorkflowValidationService().validateWorkflow({
      name: `Validate ${resolvedNodeType}`,
      nodes: [
        {
          id: "node-1",
          name: nodeName,
          type: resolvedNodeType,
          parameters,
          ...(credentials ? { credentials } : {}),
        },
      ],
      connections: {},
    });
  }

  private matchesSearch(node: NodeTemplate, normalizedQuery: string): boolean {
    if (!normalizedQuery) return true;
    return [
      node.kind,
      node.label,
      node.n8nType,
      node.officialName,
      node.packageName,
      node.credentialType,
      ...(node.requiredParams ?? []),
    ].some((value) => value?.toLowerCase().includes(normalizedQuery));
  }

  private findNode(nodeType: string): NodeTemplate | undefined {
    const normalizedNodeType = nodeType.trim().toLowerCase();
    return Object.values(NODE_REGISTRY).find((node) => {
      const normalizedKnownType = node.n8nType.toLowerCase();
      const suffix = normalizedKnownType.split(".").at(-1);
      return (
        node.kind.toLowerCase() === normalizedNodeType ||
        normalizedKnownType === normalizedNodeType ||
        suffix === normalizedNodeType
      );
    });
  }

  private toSearchResult(node: NodeTemplate): NodeKnowledgeSearchResult {
    return {
      nodeType: node.n8nType,
      packageName: node.packageName,
      displayName: node.label,
      category:
        node.kind === "schedule" || node.kind === "webhook" || node.kind === "manual"
          ? "Trigger"
          : "Action",
      isTrigger: node.kind === "schedule" || node.kind === "webhook" || node.kind === "manual",
      isWebhook: node.kind === "webhook",
      isAiTool: node.packageName === "@n8n/n8n-nodes-langchain",
    };
  }
}

export class TemplateService {
  async searchTemplates(
    query: string,
    limit = 10,
  ): Promise<{
    query: string;
    count: number;
    templates: TemplateSearchResult[];
    fallbackReason?: string;
  }> {
    void limit;
    return {
      query,
      count: 0,
      templates: [],
      fallbackReason: "Local template database is not configured for the active MCP gateway.",
    };
  }

  async getTemplate(id: string | number): Promise<WorkflowTemplateDetail | { error: string }> {
    return { error: `template not found: ${id}` };
  }
}

export function optionalPolicy(
  value: unknown,
  confirm: unknown,
  serverPolicy: WorkflowPolicyContext | undefined,
): WorkflowPolicyContext {
  const policy = isRecord(value) ? (value as WorkflowPolicyContext) : {};
  const merged: WorkflowPolicyContext = {
    ...policy,
    ...serverPolicy,
    readOnly: Boolean(policy.readOnly || serverPolicy?.readOnly),
    disabledTools: mergeStringLists(policy.disabledTools, serverPolicy?.disabledTools),
    disabledOperations: mergeStringLists(
      policy.disabledOperations,
      serverPolicy?.disabledOperations,
    ),
  };

  if (confirm === true) return { ...merged, confirmed: true };
  return merged;
}

export function requireOperations(value: unknown): WorkflowOperation[] {
  if (!Array.isArray(value)) {
    throw new Error("operations (array) is required");
  }

  return value.map((operation, index) => validateWorkflowOperation(operation, index));
}

export function requireWorkflow(value: unknown): WorkflowLike {
  if (!isRecord(value)) {
    throw new Error("n8n workflow response must be an object");
  }

  return value as WorkflowLike;
}

function validateWorkflowOperation(operation: unknown, index: number): WorkflowOperation {
  if (!isRecord(operation)) {
    throwInvalidOperation(index, "operation must be an object");
  }

  const type = operation.type;
  if (typeof type !== "string" || type.trim().length === 0) {
    throwInvalidOperation(index, "type is required");
  }

  switch (type) {
    case "updateNode":
      requireOperationString(operation.nodeId, index, "updateNode.nodeId");
      requireOperationRecord(operation.changes, index, "updateNode.changes");
      return operation as WorkflowOperation;
    case "addNode":
      requireOperationRecord(operation.node, index, "addNode.node");
      return operation as WorkflowOperation;
    case "removeNode":
      requireOperationString(operation.nodeId, index, "removeNode.nodeId");
      return operation as WorkflowOperation;
    case "addConnection":
    case "removeConnection":
      validateConnectionOperation(operation, index, type);
      return operation as WorkflowOperation;
    case "cleanStaleConnections":
      return operation as WorkflowOperation;
    default:
      throwInvalidOperation(index, `unsupported type ${type}`);
  }
}

function validateConnectionOperation(
  operation: Record<string, unknown>,
  index: number,
  operationType: "addConnection" | "removeConnection",
): void {
  requireOperationString(operation.source, index, `${operationType}.source`);
  requireOperationString(operation.target, index, `${operationType}.target`);
  requireOptionalOperationString(operation.sourcePort, index, `${operationType}.sourcePort`);
  requireOptionalOperationString(operation.targetPort, index, `${operationType}.targetPort`);
  requireOptionalOperationNumber(operation.sourceIndex, index, `${operationType}.sourceIndex`);
  requireOptionalOperationNumber(operation.targetIndex, index, `${operationType}.targetIndex`);
}

function requireOperationString(value: unknown, index: number, field: string): void {
  if (typeof value !== "string" || value.trim().length === 0) {
    throwInvalidOperation(index, `${field} is required`);
  }
}

function requireOperationRecord(value: unknown, index: number, field: string): void {
  if (!isRecord(value)) {
    throwInvalidOperation(index, `${field} is required`);
  }
}

function requireOptionalOperationString(value: unknown, index: number, field: string): void {
  if (value !== undefined && typeof value !== "string") {
    throwInvalidOperation(index, `${field} must be a string`);
  }
}

function requireOptionalOperationNumber(value: unknown, index: number, field: string): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
    throwInvalidOperation(index, `${field} must be a number`);
  }
}

function throwInvalidOperation(index: number, reason: string): never {
  throw new Error(`Invalid workflow operation at index ${index}: ${reason}`);
}

function ensureConnectionGroups(
  sourceConnections: WorkflowConnections[string],
  sourcePort: string,
): ConnectionItem[][] {
  const existing = sourceConnections[sourcePort];
  if (Array.isArray(existing)) return existing as ConnectionItem[][];
  const groups: ConnectionItem[][] = [];
  sourceConnections[sourcePort] = groups;
  return groups;
}

function deepMergeInto(target: Record<string, unknown>, changes: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(changes)) {
    if (isDangerousKey(key)) continue;
    const current = target[key];

    if (isRecord(current) && isRecord(value)) {
      deepMergeInto(current, value);
      continue;
    }

    target[key] = cloneWithoutDangerousKeys(value);
  }
}

function clone<T>(value: T): T {
  if (typeof structuredClone === "function") return structuredClone(value);
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneWithoutDangerousKeys<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map((item) => cloneWithoutDangerousKeys(item)) as T;
  }

  if (!isRecord(value)) return clone(value);

  const safe: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (isDangerousKey(key)) continue;
    safe[key] = cloneWithoutDangerousKeys(nestedValue);
  }

  return safe as T;
}

function isDangerousKey(key: string): boolean {
  return key === "__proto__" || key === "prototype" || key === "constructor";
}

function addUnique(items: string[], item: string): void {
  if (!items.includes(item)) items.push(item);
}

function normalizeLimit(limit: number): number {
  return Math.max(0, Math.floor(Number.isFinite(limit) ? limit : 0));
}

function isReadOnlyTool(toolName: string): boolean {
  return ["search_", "get_", "list_", "validate_", "preview_"].some((prefix) =>
    toolName.startsWith(prefix),
  );
}

function mergeStringLists(a: string[] | undefined, b: string[] | undefined): string[] | undefined {
  const merged = [...(a ?? []), ...(b ?? [])];
  return merged.length > 0 ? [...new Set(merged)] : undefined;
}

function hasExplicitValue(value: unknown): boolean {
  return typeof value === "string"
    ? value.trim().length > 0
    : value !== undefined && value !== null;
}

function hasCredential(credentials: unknown, credentialType: string): boolean {
  return isRecord(credentials) && isRecord(credentials[credentialType]);
}

function usesCredentialExpression(value: unknown): boolean {
  if (typeof value === "string") return value.includes("$credentials.");
  if (Array.isArray(value)) return value.some((item) => usesCredentialExpression(item));
  if (isRecord(value))
    return Object.values(value).some((nested) => usesCredentialExpression(nested));
  return false;
}

function findUnbalancedExpressionPaths(value: unknown, path: string): string[] {
  if (typeof value === "string") {
    return hasUnbalancedExpressionBraces(value) ? [path] : [];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findUnbalancedExpressionPaths(item, `${path}.${index}`));
  }

  if (isRecord(value)) {
    return Object.entries(value).flatMap(([key, nestedValue]) =>
      findUnbalancedExpressionPaths(nestedValue, `${path}.${key}`),
    );
  }

  return [];
}

function hasUnbalancedExpressionBraces(value: string): boolean {
  const openings = value.match(/\{\{/g)?.length ?? 0;
  const closings = value.match(/\}\}/g)?.length ?? 0;
  return openings !== closings;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
