# n8n Workflow Agent Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add backend n8n knowledge tools, validation-first workflow creation, and safe workflow diff/partial-update support.

**Architecture:** The API app keeps `MCPServiceExtended` as the public tool router. New focused services wrap local n8n knowledge, template lookup, workflow validation, diff application, and operation policy so orchestrated tools can adopt a template-first and validation-first pipeline without losing their current behavior.

**Tech Stack:** TypeScript, Node.js, Express service layer, Vitest, local `tools/n8n-knowledge-mcp` SQLite-backed knowledge model, shared `@n8nmcp/types`.

---

## File Structure

- Modify: `packages/types/src/index.ts`
  - Add shared response envelopes, validation types, workflow operation types, diff summary types, and operation policy types.
- Create: `apps/api/src/services/node-knowledge.service.ts`
  - Read-only node search, node detail, and node validation service with a small in-memory fallback dataset for tests and for missing local DB scenarios.
- Create: `apps/api/src/services/template.service.ts`
  - Read-only template search and retrieval service that returns structured misses when the template DB is empty or unavailable.
- Create: `apps/api/src/services/workflow-validation.service.ts`
  - Combines knowledge validation stubs with local "Never Trust Defaults" checks and connection/expression checks.
- Create: `apps/api/src/services/workflow-diff.service.ts`
  - Applies partial workflow operations to an in-memory copy and produces a structured diff summary.
- Create: `apps/api/src/services/workflow-operation-policy.service.ts`
  - Central policy checks for read-only mode, disabled tools, disabled operations, and active workflow confirmation.
- Modify: `apps/api/src/services/mcp-extended.service.ts`
  - Register and route knowledge tools, `preview_workflow_diff`, and `update_partial_workflow`.
- Modify: `apps/api/src/services/orchestrated-tools.service.ts`
  - Add optional validation/template dependencies and route created workflow drafts through the validation pipeline before creation or activation.
- Modify: `apps/api/src/services/orchestrated-tools.ts`
  - Add tool definitions for knowledge tools and partial update tools, or import those definitions from a new local constant.
- Test: `apps/api/src/services/__tests__/workflow-validation.service.test.ts`
- Test: `apps/api/src/services/__tests__/workflow-diff.service.test.ts`
- Test: `apps/api/src/services/__tests__/mcp-extended.service.test.ts`
- Test: `apps/api/src/services/__tests__/orchestrated-tools.service.test.ts`

Because `D:\n8nmcp` is not currently a Git repository, commit steps should be skipped in this workspace. If this plan is executed in a Git checkout, use the commit commands shown after each task.

---

### Task 1: Shared Workflow Agent Types

**Files:**
- Modify: `packages/types/src/index.ts`
- Test: type checking through `apps/api` tests in later tasks

- [ ] **Step 1: Add shared type definitions**

Append these exports to `packages/types/src/index.ts`:

```ts
export type WorkflowAgentRiskLevel = 'low' | 'medium' | 'high';

export interface WorkflowValidationIssue {
  code: string;
  message: string;
  nodeId?: string;
  nodeName?: string;
  path?: string;
  severity: 'error' | 'warning';
}

export interface WorkflowValidationResult {
  ok: boolean;
  errors: WorkflowValidationIssue[];
  warnings: WorkflowValidationIssue[];
  riskLevel: WorkflowAgentRiskLevel;
  canActivate: boolean;
}

export interface NodeKnowledgeSearchResult {
  nodeType: string;
  packageName?: string;
  displayName: string;
  description?: string;
  category?: string;
  isTrigger?: boolean;
  isWebhook?: boolean;
  isAiTool?: boolean;
}

export interface NodeKnowledgeDetail extends NodeKnowledgeSearchResult {
  essentials: unknown[];
  credentials: unknown[];
  operations: unknown[];
}

export interface TemplateSearchResult {
  id: string | number;
  name: string;
  description?: string;
  nodeTypes?: string[];
  confidence?: number;
}

export interface WorkflowTemplateDetail extends TemplateSearchResult {
  workflow: unknown | null;
}

export type WorkflowOperation =
  | { type: 'updateNode'; nodeId: string; changes: Record<string, unknown> }
  | { type: 'addNode'; node: Record<string, unknown> }
  | { type: 'removeNode'; nodeId: string }
  | {
      type: 'addConnection';
      source: string;
      target: string;
      sourcePort?: string;
      targetPort?: string;
      sourceIndex?: number;
      targetIndex?: number;
    }
  | { type: 'removeConnection'; source: string; target: string }
  | { type: 'cleanStaleConnections' };

export interface WorkflowDiffSummary {
  changedNodes: string[];
  addedNodes: string[];
  removedNodes: string[];
  changedConnections: Array<{ source: string; target?: string; change: string }>;
  operations: WorkflowOperation[];
  riskLevel: WorkflowAgentRiskLevel;
}

export interface WorkflowPolicyContext {
  readOnly?: boolean;
  disabledTools?: string[];
  disabledOperations?: string[];
  environment?: 'development' | 'staging' | 'production';
  confirmed?: boolean;
}
```

- [ ] **Step 2: Run type check for shared package**

Run:

```powershell
pnpm --filter @n8nmcp/types type-check
```

Expected: command succeeds. If the package has no `type-check` script, run:

```powershell
pnpm --filter @n8nmcp/types build
```

Expected: TypeScript compiles without errors.

- [ ] **Step 3: Commit if Git is available**

```powershell
git add packages/types/src/index.ts
git commit -m "feat(types): add workflow agent operation types"
```

Skip this step in the current non-Git workspace.

---

### Task 2: Workflow Validation Service

**Files:**
- Create: `apps/api/src/services/workflow-validation.service.ts`
- Create: `apps/api/src/services/__tests__/workflow-validation.service.test.ts`

- [ ] **Step 1: Write failing validation tests**

Create `apps/api/src/services/__tests__/workflow-validation.service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WorkflowValidationService } from "../workflow-validation.service";

describe("WorkflowValidationService", () => {
  const service = new WorkflowValidationService();

  it("blocks empty workflows", async () => {
    const result = await service.validateWorkflow({ name: "Empty", nodes: [], connections: {} });

    expect(result.ok).toBe(false);
    expect(result.canActivate).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "workflow.empty", severity: "error" }),
      ]),
    );
  });

  it("warns when a webhook relies on implicit runtime behavior", async () => {
    const result = await service.validateWorkflow({
      name: "Webhook",
      nodes: [
        {
          id: "webhook",
          name: "Webhook",
          type: "n8n-nodes-base.webhook",
          parameters: {},
        },
      ],
      connections: {},
    });

    expect(result.ok).toBe(true);
    expect(result.canActivate).toBe(false);
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "defaults.webhook.httpMethod" }),
        expect.objectContaining({ code: "defaults.webhook.responseMode" }),
      ]),
    );
  });

  it("blocks HTTP Request nodes without explicit URL", async () => {
    const result = await service.validateWorkflow({
      name: "HTTP",
      nodes: [
        {
          id: "http",
          name: "HTTP Request",
          type: "n8n-nodes-base.httpRequest",
          parameters: { method: "POST" },
        },
      ],
      connections: {},
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "defaults.httpRequest.url", severity: "error" }),
      ]),
    );
  });

  it("detects stale connection targets", async () => {
    const result = await service.validateWorkflow({
      name: "Broken",
      nodes: [{ id: "a", name: "A", type: "n8n-nodes-base.manualTrigger", parameters: {} }],
      connections: {
        A: { main: [[{ node: "Missing", type: "main", index: 0 }]] },
      },
    });

    expect(result.ok).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "connections.targetMissing" }),
      ]),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter @n8nmcp/api test -- --run src/services/__tests__/workflow-validation.service.test.ts
```

Expected: FAIL because `workflow-validation.service.ts` does not exist.

- [ ] **Step 3: Implement validation service**

Create `apps/api/src/services/workflow-validation.service.ts`:

```ts
import type {
  WorkflowAgentRiskLevel,
  WorkflowValidationIssue,
  WorkflowValidationResult,
} from "@n8nmcp/types";

type WorkflowLike = {
  name?: string;
  nodes?: Array<{
    id?: string;
    name?: string;
    type?: string;
    parameters?: Record<string, unknown>;
    credentials?: unknown;
  }>;
  connections?: Record<string, any>;
};

export class WorkflowValidationService {
  async validateWorkflow(workflow: WorkflowLike): Promise<WorkflowValidationResult> {
    const errors: WorkflowValidationIssue[] = [];
    const warnings: WorkflowValidationIssue[] = [];
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];

    if (nodes.length === 0) {
      errors.push({
        code: "workflow.empty",
        message: "Workflow must contain at least one node.",
        severity: "error",
      });
    }

    for (const node of nodes) {
      this.checkRuntimeDefaults(node, errors, warnings);
    }

    this.checkConnections(nodes, workflow.connections ?? {}, errors);
    this.checkExpressions(nodes, warnings);

    const riskLevel = this.calculateRisk(errors, warnings);

    return {
      ok: errors.length === 0,
      errors,
      warnings,
      riskLevel,
      canActivate: errors.length === 0 && warnings.length === 0,
    };
  }

  private checkRuntimeDefaults(
    node: NonNullable<WorkflowLike["nodes"]>[number],
    errors: WorkflowValidationIssue[],
    warnings: WorkflowValidationIssue[],
  ) {
    const type = String(node.type ?? "");
    const parameters = node.parameters ?? {};
    const nodeId = node.id;
    const nodeName = node.name;

    if (type.includes("webhook")) {
      this.warnMissing(parameters, "httpMethod", "defaults.webhook.httpMethod", nodeId, nodeName, warnings);
      this.warnMissing(parameters, "responseMode", "defaults.webhook.responseMode", nodeId, nodeName, warnings);
      if (!("path" in parameters)) {
        warnings.push({
          code: "defaults.webhook.path",
          message: "Webhook path behavior should be explicit.",
          nodeId,
          nodeName,
          path: "parameters.path",
          severity: "warning",
        });
      }
    }

    if (type.includes("httpRequest")) {
      this.errorMissing(parameters, "url", "defaults.httpRequest.url", nodeId, nodeName, errors);
      this.warnMissing(parameters, "method", "defaults.httpRequest.method", nodeId, nodeName, warnings);
      this.warnMissing(parameters, "authentication", "defaults.httpRequest.authentication", nodeId, nodeName, warnings);
    }

    if (type.includes("emailSend")) {
      this.errorMissing(parameters, "toEmail", "defaults.email.toEmail", nodeId, nodeName, errors);
      this.warnMissing(parameters, "subject", "defaults.email.subject", nodeId, nodeName, warnings);
      this.warnMissing(parameters, "message", "defaults.email.message", nodeId, nodeName, warnings);
    }

    if (type.endsWith(".if") || type.includes("switch")) {
      this.errorMissing(parameters, "conditions", "defaults.branch.conditions", nodeId, nodeName, errors);
    }

    if (type.toLowerCase().includes("openai") || type.toLowerCase().includes("langchain")) {
      this.warnMissing(parameters, "model", "defaults.ai.model", nodeId, nodeName, warnings);
      if (!node.credentials) {
        warnings.push({
          code: "defaults.ai.credentials",
          message: "AI nodes should use explicit n8n credential references.",
          nodeId,
          nodeName,
          severity: "warning",
        });
      }
    }
  }

  private checkConnections(
    nodes: NonNullable<WorkflowLike["nodes"]>,
    connections: Record<string, any>,
    errors: WorkflowValidationIssue[],
  ) {
    const names = new Set(nodes.map((node) => node.name).filter(Boolean));

    for (const [source, value] of Object.entries(connections)) {
      if (!names.has(source)) {
        errors.push({
          code: "connections.sourceMissing",
          message: `Connection source node does not exist: ${source}`,
          nodeName: source,
          severity: "error",
        });
      }

      for (const group of value?.main ?? []) {
        for (const connection of group ?? []) {
          if (connection?.node && !names.has(connection.node)) {
            errors.push({
              code: "connections.targetMissing",
              message: `Connection target node does not exist: ${connection.node}`,
              nodeName: connection.node,
              severity: "error",
            });
          }
        }
      }
    }
  }

  private checkExpressions(
    nodes: NonNullable<WorkflowLike["nodes"]>,
    warnings: WorkflowValidationIssue[],
  ) {
    for (const node of nodes) {
      const json = JSON.stringify(node.parameters ?? {});
      const opens = json.match(/\{\{/g)?.length ?? 0;
      const closes = json.match(/\}\}/g)?.length ?? 0;
      if (opens !== closes) {
        warnings.push({
          code: "expressions.unbalancedBraces",
          message: `Expression braces are unbalanced: ${opens} open vs ${closes} close.`,
          nodeId: node.id,
          nodeName: node.name,
          severity: "warning",
        });
      }
    }
  }

  private errorMissing(
    parameters: Record<string, unknown>,
    field: string,
    code: string,
    nodeId: string | undefined,
    nodeName: string | undefined,
    errors: WorkflowValidationIssue[],
  ) {
    if (parameters[field] === undefined || parameters[field] === null || parameters[field] === "") {
      errors.push({
        code,
        message: `${field} must be explicitly configured.`,
        nodeId,
        nodeName,
        path: `parameters.${field}`,
        severity: "error",
      });
    }
  }

  private warnMissing(
    parameters: Record<string, unknown>,
    field: string,
    code: string,
    nodeId: string | undefined,
    nodeName: string | undefined,
    warnings: WorkflowValidationIssue[],
  ) {
    if (parameters[field] === undefined || parameters[field] === null || parameters[field] === "") {
      warnings.push({
        code,
        message: `${field} should be explicitly configured.`,
        nodeId,
        nodeName,
        path: `parameters.${field}`,
        severity: "warning",
      });
    }
  }

  private calculateRisk(
    errors: WorkflowValidationIssue[],
    warnings: WorkflowValidationIssue[],
  ): WorkflowAgentRiskLevel {
    if (errors.length > 0) return "high";
    if (warnings.length > 0) return "medium";
    return "low";
  }
}
```

- [ ] **Step 4: Run validation tests**

Run:

```powershell
pnpm --filter @n8nmcp/api test -- --run src/services/__tests__/workflow-validation.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit if Git is available**

```powershell
git add apps/api/src/services/workflow-validation.service.ts apps/api/src/services/__tests__/workflow-validation.service.test.ts
git commit -m "feat(api): add workflow validation service"
```

Skip this step in the current non-Git workspace.

---

### Task 3: Workflow Diff Service

**Files:**
- Create: `apps/api/src/services/workflow-diff.service.ts`
- Create: `apps/api/src/services/__tests__/workflow-diff.service.test.ts`

- [ ] **Step 1: Write failing diff tests**

Create `apps/api/src/services/__tests__/workflow-diff.service.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WorkflowDiffService } from "../workflow-diff.service";

describe("WorkflowDiffService", () => {
  const service = new WorkflowDiffService();

  it("updates a single node without mutating the original workflow", () => {
    const workflow = {
      id: "wf-1",
      nodes: [{ id: "http", name: "HTTP", type: "n8n-nodes-base.httpRequest", parameters: { method: "GET" } }],
      connections: {},
    };

    const result = service.applyOperations(workflow, [
      { type: "updateNode", nodeId: "http", changes: { parameters: { method: "POST", url: "https://api.example.com" } } },
    ]);

    expect(workflow.nodes[0].parameters.method).toBe("GET");
    expect(result.workflow.nodes[0].parameters).toMatchObject({
      method: "POST",
      url: "https://api.example.com",
    });
    expect(result.diff.changedNodes).toEqual(["http"]);
  });

  it("adds and removes connections", () => {
    const workflow = {
      nodes: [
        { id: "a", name: "A", type: "n8n-nodes-base.manualTrigger", parameters: {} },
        { id: "b", name: "B", type: "n8n-nodes-base.set", parameters: {} },
      ],
      connections: {},
    };

    const result = service.applyOperations(workflow, [
      { type: "addConnection", source: "A", target: "B" },
      { type: "removeConnection", source: "A", target: "B" },
    ]);

    expect(result.workflow.connections.A.main[0]).toEqual([]);
    expect(result.diff.changedConnections).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: "A", target: "B", change: "added" }),
        expect.objectContaining({ source: "A", target: "B", change: "removed" }),
      ]),
    );
  });

  it("throws for unknown update targets", () => {
    expect(() =>
      service.applyOperations({ nodes: [], connections: {} }, [
        { type: "updateNode", nodeId: "missing", changes: { name: "Missing" } },
      ]),
    ).toThrow("Node not found: missing");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter @n8nmcp/api test -- --run src/services/__tests__/workflow-diff.service.test.ts
```

Expected: FAIL because `workflow-diff.service.ts` does not exist.

- [ ] **Step 3: Implement diff service**

Create `apps/api/src/services/workflow-diff.service.ts`:

```ts
import type { WorkflowDiffSummary, WorkflowOperation } from "@n8nmcp/types";

type WorkflowLike = {
  nodes?: Array<Record<string, any>>;
  connections?: Record<string, any>;
  [key: string]: any;
};

export class WorkflowDiffService {
  applyOperations(workflow: WorkflowLike, operations: WorkflowOperation[]) {
    const next = structuredCloneSafe(workflow);
    next.nodes = Array.isArray(next.nodes) ? next.nodes : [];
    next.connections = next.connections && typeof next.connections === "object" ? next.connections : {};

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
          next.nodes.push(operation.node);
          diff.addedNodes.push(String(operation.node.id ?? operation.node.name ?? "new-node"));
          break;
        case "removeNode":
          this.removeNode(next, operation.nodeId, diff);
          break;
        case "addConnection":
          this.addConnection(next, operation, diff);
          break;
        case "removeConnection":
          this.removeConnection(next, operation.source, operation.target, diff);
          break;
        case "cleanStaleConnections":
          this.cleanStaleConnections(next, diff);
          break;
      }
    }

    if (diff.removedNodes.length > 0) diff.riskLevel = "high";
    else if (diff.changedNodes.length > 0 || diff.changedConnections.length > 0) diff.riskLevel = "medium";

    return { workflow: next, diff };
  }

  private updateNode(workflow: WorkflowLike, nodeId: string, changes: Record<string, unknown>, diff: WorkflowDiffSummary) {
    const node = workflow.nodes!.find((candidate) => candidate.id === nodeId || candidate.name === nodeId);
    if (!node) throw new Error(`Node not found: ${nodeId}`);
    Object.assign(node, mergeObjects(node, changes));
    addUnique(diff.changedNodes, nodeId);
  }

  private removeNode(workflow: WorkflowLike, nodeId: string, diff: WorkflowDiffSummary) {
    const before = workflow.nodes!.length;
    workflow.nodes = workflow.nodes!.filter((node) => node.id !== nodeId && node.name !== nodeId);
    if (workflow.nodes.length === before) throw new Error(`Node not found: ${nodeId}`);
    diff.removedNodes.push(nodeId);
    this.cleanStaleConnections(workflow, diff);
  }

  private addConnection(workflow: WorkflowLike, operation: Extract<WorkflowOperation, { type: "addConnection" }>, diff: WorkflowDiffSummary) {
    const sourceIndex = operation.sourceIndex ?? 0;
    const targetIndex = operation.targetIndex ?? 0;
    workflow.connections![operation.source] ??= { main: [] };
    workflow.connections![operation.source].main ??= [];
    workflow.connections![operation.source].main[sourceIndex] ??= [];
    workflow.connections![operation.source].main[sourceIndex].push({
      node: operation.target,
      type: operation.targetPort ?? "main",
      index: targetIndex,
    });
    diff.changedConnections.push({ source: operation.source, target: operation.target, change: "added" });
  }

  private removeConnection(workflow: WorkflowLike, source: string, target: string, diff: WorkflowDiffSummary) {
    const main = workflow.connections?.[source]?.main;
    if (!Array.isArray(main)) return;
    for (const group of main) {
      if (!Array.isArray(group)) continue;
      const kept = group.filter((connection) => connection?.node !== target);
      group.splice(0, group.length, ...kept);
    }
    diff.changedConnections.push({ source, target, change: "removed" });
  }

  private cleanStaleConnections(workflow: WorkflowLike, diff: WorkflowDiffSummary) {
    const names = new Set(workflow.nodes!.map((node) => node.name).filter(Boolean));
    for (const [source, value] of Object.entries(workflow.connections ?? {})) {
      if (!names.has(source)) {
        delete workflow.connections![source];
        diff.changedConnections.push({ source, change: "removed-stale-source" });
        continue;
      }
      for (const group of value?.main ?? []) {
        if (!Array.isArray(group)) continue;
        const kept = group.filter((connection) => !connection?.node || names.has(connection.node));
        if (kept.length !== group.length) {
          group.splice(0, group.length, ...kept);
          diff.changedConnections.push({ source, change: "removed-stale-target" });
        }
      }
    }
  }
}

function mergeObjects(base: Record<string, any>, changes: Record<string, any>) {
  const output = { ...base };
  for (const [key, value] of Object.entries(changes)) {
    if (isPlainObject(value) && isPlainObject(output[key])) {
      output[key] = mergeObjects(output[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function isPlainObject(value: unknown): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function addUnique(values: string[], value: string) {
  if (!values.includes(value)) values.push(value);
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
```

- [ ] **Step 4: Run diff tests**

Run:

```powershell
pnpm --filter @n8nmcp/api test -- --run src/services/__tests__/workflow-diff.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit if Git is available**

```powershell
git add apps/api/src/services/workflow-diff.service.ts apps/api/src/services/__tests__/workflow-diff.service.test.ts
git commit -m "feat(api): add workflow diff operations"
```

Skip this step in the current non-Git workspace.

---

### Task 4: Node Knowledge And Template Services

**Files:**
- Create: `apps/api/src/services/node-knowledge.service.ts`
- Create: `apps/api/src/services/template.service.ts`
- Test: `apps/api/src/services/__tests__/mcp-extended.service.test.ts` in Task 6

- [ ] **Step 1: Implement node knowledge service**

Create `apps/api/src/services/node-knowledge.service.ts`:

```ts
import type { NodeKnowledgeDetail, NodeKnowledgeSearchResult, WorkflowValidationResult } from "@n8nmcp/types";
import { WorkflowValidationService } from "./workflow-validation.service.js";

const KNOWN_NODES: NodeKnowledgeDetail[] = [
  {
    nodeType: "n8n-nodes-base.webhook",
    packageName: "n8n-nodes-base",
    displayName: "Webhook",
    description: "Starts a workflow from an HTTP request.",
    category: "trigger",
    isTrigger: true,
    isWebhook: true,
    essentials: ["httpMethod", "path", "responseMode"],
    credentials: [],
    operations: [],
  },
  {
    nodeType: "n8n-nodes-base.httpRequest",
    packageName: "n8n-nodes-base",
    displayName: "HTTP Request",
    description: "Makes an HTTP request.",
    category: "action",
    essentials: ["method", "url", "authentication"],
    credentials: ["httpBasicAuth", "httpHeaderAuth", "genericCredentialType"],
    operations: [],
  },
  {
    nodeType: "n8n-nodes-base.emailSend",
    packageName: "n8n-nodes-base",
    displayName: "Send Email",
    description: "Sends an email.",
    category: "communication",
    essentials: ["toEmail", "subject", "message"],
    credentials: ["smtp"],
    operations: [],
  },
];

export class NodeKnowledgeService {
  constructor(private validationService = new WorkflowValidationService()) {}

  async searchNodes(query: string, limit = 20): Promise<{ query: string; count: number; results: NodeKnowledgeSearchResult[] }> {
    const normalized = query.toLowerCase();
    const results = KNOWN_NODES.filter((node) =>
      [node.nodeType, node.displayName, node.description, node.category]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalized)),
    ).slice(0, limit);

    return { query, count: results.length, results };
  }

  async getNode(nodeType: string): Promise<NodeKnowledgeDetail | { error: string }> {
    const node = KNOWN_NODES.find((candidate) => candidate.nodeType === nodeType || candidate.nodeType.endsWith(`.${nodeType}`));
    return node ?? { error: `node not found: ${nodeType}` };
  }

  async validateNode(nodeType: string, parameters: Record<string, unknown> = {}): Promise<WorkflowValidationResult> {
    return this.validationService.validateWorkflow({
      name: "Node validation",
      nodes: [{ id: "node", name: nodeType, type: nodeType, parameters }],
      connections: {},
    });
  }
}
```

- [ ] **Step 2: Implement template service**

Create `apps/api/src/services/template.service.ts`:

```ts
import type { TemplateSearchResult, WorkflowTemplateDetail } from "@n8nmcp/types";

export class TemplateService {
  async searchTemplates(query: string, limit = 10): Promise<{ query: string; count: number; templates: TemplateSearchResult[]; fallbackReason?: string }> {
    return {
      query,
      count: 0,
      templates: [],
      fallbackReason: "Local template database is empty or not configured for the API service.",
    };
  }

  async getTemplate(id: string | number): Promise<WorkflowTemplateDetail | { error: string }> {
    return {
      error: `template not found: ${id}`,
    };
  }
}
```

- [ ] **Step 3: Run API type check**

Run:

```powershell
pnpm --filter @n8nmcp/api type-check
```

Expected: PASS.

- [ ] **Step 4: Commit if Git is available**

```powershell
git add apps/api/src/services/node-knowledge.service.ts apps/api/src/services/template.service.ts
git commit -m "feat(api): add knowledge and template services"
```

Skip this step in the current non-Git workspace.

---

### Task 5: Operation Policy Service

**Files:**
- Create: `apps/api/src/services/workflow-operation-policy.service.ts`

- [ ] **Step 1: Implement operation policy service**

Create `apps/api/src/services/workflow-operation-policy.service.ts`:

```ts
import type { WorkflowOperation, WorkflowPolicyContext } from "@n8nmcp/types";

export class WorkflowOperationPolicyService {
  assertToolAllowed(toolName: string, context: WorkflowPolicyContext = {}) {
    if (context.readOnly && !toolName.startsWith("search_") && !toolName.startsWith("get_") && toolName !== "preview_workflow_diff" && toolName !== "validate_node") {
      throw new Error(`Tool is disabled in read-only mode: ${toolName}`);
    }

    if (context.disabledTools?.includes(toolName)) {
      throw new Error(`Tool is disabled by policy: ${toolName}`);
    }
  }

  assertOperationsAllowed(operations: WorkflowOperation[], context: WorkflowPolicyContext = {}, workflow?: { active?: boolean }) {
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
```

- [ ] **Step 2: Run API type check**

Run:

```powershell
pnpm --filter @n8nmcp/api type-check
```

Expected: PASS.

- [ ] **Step 3: Commit if Git is available**

```powershell
git add apps/api/src/services/workflow-operation-policy.service.ts
git commit -m "feat(api): add workflow operation policy checks"
```

Skip this step in the current non-Git workspace.

---

### Task 6: MCP Extended Tool Registration And Routing

**Files:**
- Modify: `apps/api/src/services/mcp-extended.service.ts`
- Create: `apps/api/src/services/__tests__/mcp-extended.service.test.ts`

- [ ] **Step 1: Write failing routing tests**

Create `apps/api/src/services/__tests__/mcp-extended.service.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { MCPServiceExtended } from "../mcp-extended.service";

describe("MCPServiceExtended knowledge and diff tools", () => {
  const instance = { id: "inst-1", base_url: "https://n8n.example.com", api_key: "key" };

  it("registers knowledge and partial update tools", () => {
    const service = new MCPServiceExtended({
      getDefaultInstance: vi.fn(),
      listTools: () => [],
    });

    const names = service.listTools().map((tool: any) => tool.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "search_nodes",
        "get_node",
        "validate_node",
        "search_templates",
        "get_template",
        "preview_workflow_diff",
        "update_partial_workflow",
      ]),
    );
  });

  it("routes search_nodes without requiring an n8n instance", async () => {
    const service = new MCPServiceExtended({
      getDefaultInstance: vi.fn(),
      listTools: () => [],
    });

    const result = await service.callTool("user-1", {
      name: "search_nodes",
      arguments: { query: "webhook" },
    });

    expect(result).toMatchObject({ query: "webhook" });
  });

  it("previews workflow diff without mutating n8n", async () => {
    const n8nGet = vi.fn().mockResolvedValue({
      id: "wf-1",
      active: false,
      nodes: [{ id: "http", name: "HTTP", type: "n8n-nodes-base.httpRequest", parameters: { method: "GET", url: "https://example.com" } }],
      connections: {},
    });
    const n8nPatch = vi.fn();

    const service = new MCPServiceExtended({
      getDefaultInstance: vi.fn().mockResolvedValue(instance),
      listTools: () => [],
    });

    (service as any).createN8nAPIClientForTest = () => ({ get: n8nGet, post: vi.fn(), patch: n8nPatch, delete: vi.fn() });

    const result = await service.callTool("user-1", {
      name: "preview_workflow_diff",
      arguments: {
        workflowId: "wf-1",
        operations: [{ type: "updateNode", nodeId: "http", changes: { parameters: { method: "POST" } } }],
      },
    });

    expect(result).toMatchObject({ success: true });
    expect(n8nGet).toHaveBeenCalledWith("/workflows/wf-1");
    expect(n8nPatch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter @n8nmcp/api test -- --run src/services/__tests__/mcp-extended.service.test.ts
```

Expected: FAIL because the new tools are not registered or routed.

- [ ] **Step 3: Modify `mcp-extended.service.ts`**

Add imports:

```ts
import type { WorkflowOperation } from "@n8nmcp/types";
import { NodeKnowledgeService } from "./node-knowledge.service.js";
import { TemplateService } from "./template.service.js";
import { WorkflowDiffService } from "./workflow-diff.service.js";
import { WorkflowOperationPolicyService } from "./workflow-operation-policy.service.js";
import { WorkflowValidationService } from "./workflow-validation.service.js";
```

Add tool definitions near the top of the file:

```ts
const workflowAgentTools = [
  {
    name: "search_nodes",
    description: "Search n8n nodes by name, type, description, or category.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
    annotations: { readOnly: true, category: "knowledge" },
  },
  {
    name: "get_node",
    description: "Get n8n node essentials and credential hints.",
    inputSchema: { type: "object", properties: { nodeType: { type: "string" } }, required: ["nodeType"] },
    annotations: { readOnly: true, category: "knowledge" },
  },
  {
    name: "validate_node",
    description: "Validate one n8n node parameter object.",
    inputSchema: { type: "object", properties: { nodeType: { type: "string" }, parameters: { type: "object" } }, required: ["nodeType"] },
    annotations: { readOnly: true, category: "validation" },
  },
  {
    name: "search_templates",
    description: "Search local n8n workflow templates.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, limit: { type: "number" } }, required: ["query"] },
    annotations: { readOnly: true, category: "templates" },
  },
  {
    name: "get_template",
    description: "Get one local n8n workflow template.",
    inputSchema: { type: "object", properties: { id: { type: ["string", "number"] } }, required: ["id"] },
    annotations: { readOnly: true, category: "templates" },
  },
  {
    name: "preview_workflow_diff",
    description: "Preview workflow partial update operations without mutating n8n.",
    inputSchema: { type: "object", properties: { workflowId: { type: "string" }, operations: { type: "array" } }, required: ["workflowId", "operations"] },
    annotations: { readOnly: true, category: "workflow-update" },
  },
  {
    name: "update_partial_workflow",
    description: "Apply validated partial update operations to an n8n workflow.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string" },
        operations: { type: "array" },
        confirm: { type: "boolean" },
      },
      required: ["workflowId", "operations"],
    },
    annotations: { readOnly: false, riskLevel: "medium", category: "workflow-update" },
  },
];
```

Update `listTools()`:

```ts
  listTools() {
    return [...(this.baseMCPService.listTools?.() ?? []), ...workflowAgentTools, ...orchestratedTools];
  }
```

Add private services and route the new tools in `callTool()` before requiring an n8n instance for diff/update tools:

```ts
  private nodeKnowledgeService = new NodeKnowledgeService();
  private templateService = new TemplateService();
  private workflowDiffService = new WorkflowDiffService();
  private workflowValidationService = new WorkflowValidationService();
  private policyService = new WorkflowOperationPolicyService();
```

```ts
    if (name === "search_nodes") {
      return this.nodeKnowledgeService.searchNodes(String(args?.query ?? ""), Number(args?.limit ?? 20));
    }
    if (name === "get_node") {
      return this.nodeKnowledgeService.getNode(String(args?.nodeType ?? ""));
    }
    if (name === "validate_node") {
      return this.nodeKnowledgeService.validateNode(String(args?.nodeType ?? ""), (args?.parameters ?? {}) as Record<string, unknown>);
    }
    if (name === "search_templates") {
      return this.templateService.searchTemplates(String(args?.query ?? ""), Number(args?.limit ?? 10));
    }
    if (name === "get_template") {
      return this.templateService.getTemplate(String(args?.id ?? ""));
    }
```

Add diff/update handling after the default instance is loaded:

```ts
    if (name === "preview_workflow_diff" || name === "update_partial_workflow") {
      const instance = await this.baseMCPService.getDefaultInstance(userId);
      if (!instance) throw new Error("No n8n instance configured. Please connect your n8n instance first.");
      const apiFactory = (this as any).createN8nAPIClientForTest as undefined | ((instance: N8nInstance) => N8nAPIClient);
      const n8nAPI = apiFactory ? apiFactory(instance) : createN8nAPIClient(instance);
      const workflowId = encodeURIComponent(String(args?.workflowId ?? ""));
      const operations = (args?.operations ?? []) as WorkflowOperation[];
      const current = await n8nAPI.get(`/workflows/${workflowId}`);
      this.policyService.assertOperationsAllowed(operations, { confirmed: args?.confirm === true }, current as { active?: boolean });
      const { workflow, diff } = this.workflowDiffService.applyOperations(current as Record<string, unknown>, operations);
      const validation = await this.workflowValidationService.validateWorkflow(workflow);

      if (name === "preview_workflow_diff") {
        return { success: true, workflowId: args?.workflowId, diff, validation };
      }

      if (!validation.ok) {
        return { success: false, workflowId: args?.workflowId, diff, validation, message: "Validation failed; workflow was not updated." };
      }

      const updated = await n8nAPI.patch(`/workflows/${workflowId}`, workflow);
      return { success: true, workflow: updated, diff, validation };
    }
```

- [ ] **Step 4: Run routing tests**

Run:

```powershell
pnpm --filter @n8nmcp/api test -- --run src/services/__tests__/mcp-extended.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit if Git is available**

```powershell
git add apps/api/src/services/mcp-extended.service.ts apps/api/src/services/__tests__/mcp-extended.service.test.ts
git commit -m "feat(api): expose workflow agent tools"
```

Skip this step in the current non-Git workspace.

---

### Task 7: Validation Gate For Orchestrated Tools

**Files:**
- Modify: `apps/api/src/services/orchestrated-tools.service.ts`
- Modify: `apps/api/src/services/__tests__/orchestrated-tools.service.test.ts`

- [ ] **Step 1: Add regression test for validation metadata and activation block**

Append this test inside `describe("createScheduledWorkflow", ...)` in `apps/api/src/services/__tests__/orchestrated-tools.service.test.ts`:

```ts
    it("returns validation metadata and does not activate when warnings block activation", async () => {
      mockN8nAPI.post.mockResolvedValueOnce({ id: "wf-validation", active: false });

      const result = await service.createScheduledWorkflow(
        "user-123",
        {
          name: "Validation Metadata",
          schedule: "every hour",
          action: "http_request",
          actionConfig: { method: "GET", url: "https://api.example.com" },
          activate: true,
        },
        mockInstance,
      );

      expect(result).toHaveProperty("validation");
      expect(mockN8nAPI.patch).not.toHaveBeenCalledWith("/workflows/wf-validation", { active: true });
    });
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm --filter @n8nmcp/api test -- --run src/services/__tests__/orchestrated-tools.service.test.ts
```

Expected: FAIL because orchestrated responses do not include `validation` and activation is not gated.

- [ ] **Step 3: Modify orchestrated service constructor**

In `apps/api/src/services/orchestrated-tools.service.ts`, add import:

```ts
import { TemplateService } from "./template.service.js";
import { WorkflowValidationService } from "./workflow-validation.service.js";
```

Change constructor to:

```ts
  constructor(
    private mcpService: any,
    private n8nAPI: any,
    private workflowValidationService = new WorkflowValidationService(),
    private templateService = new TemplateService(),
  ) {}
```

- [ ] **Step 4: Add helper for template-first validation**

Add this private method before the helper section:

```ts
  private async prepareWorkflowDraft(intent: string, workflow: any) {
    const templates = await this.templateService.searchTemplates(intent, 3);
    const validation = await this.workflowValidationService.validateWorkflow(workflow);

    return {
      workflow,
      validation,
      template: templates.templates[0] ?? null,
      fallbackReason: templates.templates.length === 0 ? templates.fallbackReason ?? "No matching template found." : undefined,
    };
  }
```

- [ ] **Step 5: Gate activation in each creation method**

For each creation method that builds a `workflow` object before `this.n8nAPI.post("/workflows", workflow)`, insert:

```ts
    const prepared = await this.prepareWorkflowDraft(params.name, workflow);
    if (!prepared.validation.ok) {
      return {
        success: false,
        validation: prepared.validation,
        fallbackReason: prepared.fallbackReason,
        message: "Workflow validation failed; workflow was not created.",
      };
    }
```

Then change activation checks from:

```ts
    if (params.activate !== false) {
```

to:

```ts
    if (params.activate !== false && prepared.validation.canActivate) {
```

And add response fields:

```ts
      validation: prepared.validation,
      template: prepared.template,
      fallbackReason: prepared.fallbackReason,
```

- [ ] **Step 6: Run orchestrated tests**

Run:

```powershell
pnpm --filter @n8nmcp/api test -- --run src/services/__tests__/orchestrated-tools.service.test.ts
```

Expected: PASS after updating older tests that assumed activation always happens. Tests should now assert creation succeeds and activation happens only when `validation.canActivate` is true.

- [ ] **Step 7: Commit if Git is available**

```powershell
git add apps/api/src/services/orchestrated-tools.service.ts apps/api/src/services/__tests__/orchestrated-tools.service.test.ts
git commit -m "feat(api): validate orchestrated workflow drafts"
```

Skip this step in the current non-Git workspace.

---

### Task 8: Audit Metadata For Partial Updates

**Files:**
- Modify: `apps/api/src/services/mcp-extended.service.ts`
- Test: `apps/api/src/services/__tests__/mcp-extended.service.test.ts`

- [ ] **Step 1: Add audit mock and update test**

At the top of `apps/api/src/services/__tests__/mcp-extended.service.test.ts`, add:

```ts
vi.mock("../audit.service", () => ({
  auditService: {
    logWorkflowChange: vi.fn(),
  },
}));
```

Add a test:

```ts
  it("applies partial updates after validation", async () => {
    const n8nGet = vi.fn().mockResolvedValue({
      id: "wf-1",
      active: false,
      nodes: [{ id: "http", name: "HTTP", type: "n8n-nodes-base.httpRequest", parameters: { method: "GET", url: "https://example.com" } }],
      connections: {},
    });
    const n8nPatch = vi.fn().mockResolvedValue({ id: "wf-1", active: false });

    const service = new MCPServiceExtended({
      getDefaultInstance: vi.fn().mockResolvedValue(instance),
      listTools: () => [],
    });
    (service as any).createN8nAPIClientForTest = () => ({ get: n8nGet, post: vi.fn(), patch: n8nPatch, delete: vi.fn() });

    const result = await service.callTool("user-1", {
      name: "update_partial_workflow",
      arguments: {
        workflowId: "wf-1",
        operations: [{ type: "updateNode", nodeId: "http", changes: { parameters: { method: "POST", url: "https://api.example.com", authentication: "none" } } }],
      },
    });

    expect(result).toMatchObject({ success: true });
    expect(n8nPatch).toHaveBeenCalledWith("/workflows/wf-1", expect.objectContaining({ id: "wf-1" }));
  });
```

- [ ] **Step 2: Run test to verify behavior**

Run:

```powershell
pnpm --filter @n8nmcp/api test -- --run src/services/__tests__/mcp-extended.service.test.ts
```

Expected: PASS for update path. If validation warnings block mutation, include explicit parameters in the test update so validation returns `canActivate` false but `ok` true; mutation only blocks on `ok === false`.

- [ ] **Step 3: Add audit logging in update path**

In `mcp-extended.service.ts`, import:

```ts
import { auditService } from "./audit.service.js";
```

After successful `n8nAPI.patch`, call:

```ts
      await auditService.logWorkflowChange({
        userId,
        workflowId: String(args?.workflowId),
        n8nInstanceId: instance.id,
        operation: "update",
        snapshotBefore: current,
        snapshotAfter: workflow,
        aiReasoning: context?.reasoning,
        toolName: "update_partial_workflow",
        toolParams: { operations, diff, validation },
        ipAddress: context?.ipAddress,
        userAgent: context?.userAgent,
      });
```

- [ ] **Step 4: Run routing tests again**

Run:

```powershell
pnpm --filter @n8nmcp/api test -- --run src/services/__tests__/mcp-extended.service.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit if Git is available**

```powershell
git add apps/api/src/services/mcp-extended.service.ts apps/api/src/services/__tests__/mcp-extended.service.test.ts
git commit -m "feat(api): audit partial workflow updates"
```

Skip this step in the current non-Git workspace.

---

### Task 9: Final Verification

**Files:**
- All files changed in Tasks 1-8

- [ ] **Step 1: Run focused API tests**

Run:

```powershell
pnpm --filter @n8nmcp/api test -- --run src/services/__tests__/workflow-validation.service.test.ts src/services/__tests__/workflow-diff.service.test.ts src/services/__tests__/mcp-extended.service.test.ts src/services/__tests__/orchestrated-tools.service.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run API type check**

Run:

```powershell
pnpm --filter @n8nmcp/api type-check
```

Expected: PASS.

- [ ] **Step 3: Run root test subset if API package scripts are not wired**

Run this only if filtered scripts fail because workspace metadata is inconsistent:

```powershell
pnpm test -- --run apps/api/src/services/__tests__/workflow-validation.service.test.ts apps/api/src/services/__tests__/workflow-diff.service.test.ts apps/api/src/services/__tests__/mcp-extended.service.test.ts apps/api/src/services/__tests__/orchestrated-tools.service.test.ts
```

Expected: PASS.

- [ ] **Step 4: Record known limitations**

Update the final response with these implementation notes:

```text
The first pass uses a small API-local knowledge fallback and a structured empty-template service. It creates the service boundary needed to later connect directly to tools/n8n-knowledge-mcp's SQLite database or HTTP MCP server without changing public MCP tool contracts.
```

- [ ] **Step 5: Commit if Git is available**

```powershell
git add packages/types/src/index.ts apps/api/src/services docs/superpowers/plans/2026-07-06-n8n-workflow-agent-phase-1.md docs/superpowers/specs/2026-07-06-n8n-workflow-agent-phase-1-design.md
git commit -m "feat(api): add workflow agent phase 1"
```

Skip this step in the current non-Git workspace.

---

## Self-Review

- Spec coverage: The plan covers knowledge tool registration, service wrappers, validation rules, diff preview, partial update mutation, policy checks, audit metadata, orchestrated tool validation, and targeted tests.
- Scope control: Dashboard work is excluded, matching the Phase 1 non-goal.
- Type consistency: `WorkflowOperation`, `WorkflowValidationResult`, `WorkflowDiffSummary`, and service method names are defined before use.
- Runtime limitation: Template lookup is intentionally implemented as a structured empty service first, preserving fallback behavior and leaving direct database integration as a later enhancement.
