import { describe, it, expect, beforeEach, vi } from "vitest";
import { runTool } from "../mcp.server";

// Mock SSRF guard
vi.mock("../ssrf-guard.server", () => ({
  assertPublicUrl: vi.fn().mockResolvedValue(undefined),
  safeFetchPublicUrl: (url: string, init?: RequestInit) => fetch(url, init),
}));

// Mock n8n API responses
const mockN8nInstance = {
  id: "test-instance-id",
  name: "Test Instance",
  base_url: "https://test.n8n.io",
  api_key: "test-api-key",
};

const validNodes = [
  {
    name: "Manual Trigger",
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    position: [0, 0],
    parameters: {},
  },
];

const mockFetch = vi.fn<typeof fetch>();
global.fetch = mockFetch;

function mockN8nResponse(body: unknown) {
  mockFetch.mockResolvedValueOnce({
    ok: true,
    text: async () => JSON.stringify(body),
  } as Response);
}

function getFetchInit(callIndex = 0) {
  return mockFetch.mock.calls[callIndex][1] as RequestInit & { body: string };
}

async function issueConfirmationToken(
  toolName: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    await runTool(mockN8nInstance, toolName, args);
  } catch (error) {
    const match = String((error as Error).message).match(/confirmationToken": "([^"]+)"/);
    return match?.[1] ?? "";
  }
  return "";
}

describe("Workflow CRUD Tools", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.clearAllMocks();
  });

  describe("create_workflow", () => {
    it("should create workflow with required fields", async () => {
      const mockResponse = {
        id: "workflow-123",
        name: "Test Workflow",
        nodes: validNodes,
        connections: {},
      };

      mockN8nResponse(mockResponse);

      const result = await runTool(mockN8nInstance, "create_workflow", {
        name: "Test Workflow",
        nodes: validNodes,
        connections: {},
      });

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it("does not expose an n8n create response body", async () => {
      const canary = "task-3-mcp-upstream-secret";
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => JSON.stringify({ message: `upstream failed: ${canary}`, token: canary }),
      } as Response);

      const error = await runTool(mockN8nInstance, "create_workflow", {
        name: "Canary-safe draft",
        nodes: validNodes,
        connections: {},
      }).catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(Error);
      expect(String(error)).toBe("Error: n8n request failed with status 503");
      expect(String(error)).not.toContain(canary);
      expect(mockFetch).toHaveBeenCalledOnce();
    });

    it("should throw error if name is missing", async () => {
      await expect(
        runTool(mockN8nInstance, "create_workflow", {
          nodes: [],
          connections: {},
        }),
      ).rejects.toThrow("name (string) is required");
    });

    it("should throw error if nodes is missing", async () => {
      await expect(
        runTool(mockN8nInstance, "create_workflow", {
          name: "Test",
          connections: {},
        }),
      ).rejects.toThrow("nodes (array) is required");
    });

    it("should include optional fields when provided", async () => {
      const mockResponse = { id: "workflow-123" };
      mockN8nResponse(mockResponse);

      await runTool(mockN8nInstance, "create_workflow", {
        name: "Test",
        nodes: validNodes,
        connections: {},
        settings: { timezone: "UTC" },
        tags: ["test"],
      });

      const body = JSON.parse(getFetchInit().body);
      expect(body.settings).toEqual({ timezone: "UTC" });
      expect(body.tags).toEqual(["test"]);
    });
  });

  describe("update_workflow", () => {
    it("should require explicit confirmation before updating workflow", async () => {
      await expect(
        runTool(mockN8nInstance, "update_workflow", {
          id: "workflow-123",
          name: "Updated Workflow",
        }),
      ).rejects.toThrow(/requires confirmation/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should update workflow with partial fields", async () => {
      const mockResponse = {
        id: "workflow-123",
        name: "Updated Workflow",
      };

      mockN8nResponse(mockResponse);

      const result = await runTool(mockN8nInstance, "update_workflow", {
        id: "workflow-123",
        name: "Updated Workflow",
        confirm: true,
      });

      expect(result).toEqual(mockResponse);
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain("/workflows/workflow-123");
      expect(getFetchInit().method).toBe("PATCH");
    });

    it("should throw error if id is undefined", async () => {
      await expect(
        runTool(mockN8nInstance, "update_workflow", {
          name: "Updated",
        }),
      ).rejects.toThrow("id (workflow id) is required");
    });

    it("rejects structural fields and directs callers to partial updates", async () => {
      await expect(
        runTool(mockN8nInstance, "update_workflow", {
          id: "workflow-123",
          active: true,
          confirm: true,
        }),
      ).rejects.toThrow(/preview_workflow_diff.*update_partial_workflow/);
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  describe("delete_workflow", () => {
    it("should require explicit confirmation before deleting workflow", async () => {
      await expect(
        runTool(mockN8nInstance, "delete_workflow", {
          id: "workflow-123",
        }),
      ).rejects.toThrow(/requires confirmation/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should reject confirm true without the issued confirmation token", async () => {
      await expect(
        runTool(mockN8nInstance, "delete_workflow", {
          id: "workflow-123",
          confirm: true,
        }),
      ).rejects.toThrow(/confirmation token/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should delete workflow after caller repeats the issued confirmation token", async () => {
      let token = "";
      try {
        await runTool(mockN8nInstance, "delete_workflow", {
          id: "workflow-123",
        });
      } catch (error) {
        const match = String((error as Error).message).match(/confirmationToken": "([^"]+)"/);
        token = match?.[1] ?? "";
      }
      expect(token).toMatch(/^mcp_confirm_/);

      mockN8nResponse({});

      const result = await runTool(mockN8nInstance, "delete_workflow", {
        id: "workflow-123",
        confirm: true,
        confirmationToken: token,
      });

      expect(result).toEqual({
        ok: true,
        workflow_id: "workflow-123",
        deleted: true,
      });

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain("/workflows/workflow-123");
      expect(getFetchInit().method).toBe("DELETE");
    });

    it("should throw error if id is undefined", async () => {
      await expect(runTool(mockN8nInstance, "delete_workflow", {})).rejects.toThrow(
        "id (workflow id) is required",
      );
    });
  });

  describe("activate_workflow", () => {
    it("should require explicit confirmation before changing activation state", async () => {
      await expect(
        runTool(mockN8nInstance, "activate_workflow", {
          id: "workflow-123",
          active: true,
        }),
      ).rejects.toThrow(/requires confirmation/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("should activate workflow when active=true", async () => {
      const mockResponse = { id: "workflow-123", active: true };
      mockN8nResponse(mockResponse);

      const result = await runTool(mockN8nInstance, "activate_workflow", {
        id: "workflow-123",
        active: true,
        confirm: true,
      });

      expect(result).toEqual(mockResponse);
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain("/workflows/workflow-123/activate");
      expect(getFetchInit().method).toBe("POST");
    });

    it("should deactivate workflow when active=false", async () => {
      const mockResponse = { id: "workflow-123", active: false };
      mockN8nResponse(mockResponse);

      await runTool(mockN8nInstance, "activate_workflow", {
        id: "workflow-123",
        active: false,
        confirm: true,
      });

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain("/workflows/workflow-123/deactivate");
    });

    it("should throw error if active is not boolean", async () => {
      await expect(
        runTool(mockN8nInstance, "activate_workflow", {
          id: "workflow-123",
          active: "true",
        }),
      ).rejects.toThrow("active (boolean) is required");
    });
  });

  describe("validate_workflow", () => {
    it("should delegate to upstream knowledge base", async () => {
      // This test would need more setup to mock the upstream
      // For now, we test that it requires the workflow parameter
      await expect(runTool(mockN8nInstance, "validate_workflow", {})).rejects.toThrow(
        "workflow (object) is required",
      );
    });
  });

  describe("create_workflow_from_blueprint", () => {
    it("repairs safe defaults and validates the compiled workflow before creating", async () => {
      mockN8nResponse({ id: "workflow-123", name: "Daily Slack Report" });

      const result = await runTool(mockN8nInstance, "create_workflow_from_blueprint", {
        name: "  Daily Slack Report  ",
        trigger: {
          kind: "schedule",
          config: { rule: { interval: [{ cronExpression: "0 9 * * *" }] } },
        },
        steps: [
          {
            kind: "http",
            config: { url: "https://api.example.com/sales" },
          },
          {
            kind: "slack",
            action: "sendMessage",
            config: { channel: "#sales", text: "Sales report: {{ $json.total }}" },
          },
        ],
      });

      expect(result).toMatchObject({
        success: true,
        workflow: { id: "workflow-123" },
        repairs: expect.arrayContaining([expect.objectContaining({ path: "name" })]),
        credentialRequirements: [{ path: "steps[1]", kind: "slack", credentialType: "slackApi" }],
        agentRuleAudit: {
          warningCount: 0,
          patternInference: {
            patterns: expect.arrayContaining(["scheduled_task", "http_api_integration"]),
          },
        },
      });

      const body = JSON.parse(getFetchInit().body);
      expect(body).toMatchObject({
        name: "Daily Slack Report",
        settings: { executionOrder: "v1" },
      });
      expect(body.nodes.map((node: { name: string }) => node.name)).toEqual([
        "Schedule Trigger",
        "HTTP Request",
        "Slack Send Message",
      ]);
      expect(body.connections).toEqual({
        "Schedule Trigger": {
          main: [[{ node: "HTTP Request", type: "main", index: 0 }]],
        },
        "HTTP Request": {
          main: [[{ node: "Slack Send Message", type: "main", index: 0 }]],
        },
      });
    });

    it("can require credentials before creating credentialed workflows", async () => {
      const result = await runTool(mockN8nInstance, "create_workflow_from_blueprint", {
        name: "Slack Alert",
        requireCredentials: true,
        trigger: { kind: "manual", config: {} },
        steps: [
          {
            kind: "slack",
            action: "sendMessage",
            config: { channel: "#sales", text: "Alert" },
          },
        ],
      });

      expect(result).toMatchObject({
        success: false,
        message: "Blueprint requires credentials before creation.",
        missingCredentials: [{ path: "steps[0]", kind: "slack", credentialType: "slackApi" }],
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns validation errors without calling n8n when the blueprint is invalid", async () => {
      const result = await runTool(mockN8nInstance, "create_workflow_from_blueprint", {
        name: "Broken",
        trigger: { kind: "webhook", config: {} },
        steps: [{ kind: "slack", action: "sendMessage", config: { channel: "#sales" } }],
      });

      expect(result).toMatchObject({
        success: false,
        message: "Blueprint validation failed. Fix the errors and try again.",
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("returns n8n agent rule warnings for risky compiled blueprint patterns", async () => {
      mockN8nResponse({ id: "workflow-webhook", name: "Webhook Slack Alert" });

      const result = await runTool(mockN8nInstance, "create_workflow_from_blueprint", {
        name: "Webhook Slack Alert",
        trigger: { kind: "webhook", config: { path: "lead-created" } },
        steps: [
          {
            kind: "slack",
            action: "sendMessage",
            config: { channel: "#sales", text: "Lead: {{$json.email}}" },
          },
        ],
      });

      expect(result).toMatchObject({
        success: true,
        agentRuleAudit: {
          warnings: [
            expect.objectContaining({
              code: "WEBHOOK_ROOT_ACCESS",
              node: "Slack Send Message",
            }),
          ],
        },
      });
    });

    it("creates workflows with the official n8n MCP Client node", async () => {
      mockN8nResponse({ id: "workflow-mcp-client", name: "Call MCP Tool" });

      const result = await runTool(mockN8nInstance, "create_workflow_from_blueprint", {
        name: "Call MCP Tool",
        trigger: { kind: "manual", config: {} },
        steps: [
          {
            kind: "mcpClient",
            action: "callTool",
            config: {
              endpointUrl: "https://mcp.n8nworkflow.com/mcp",
              tool: { mode: "id", value: "list_workflows" },
              jsonInput: "{}",
            },
          },
        ],
      });

      expect(result).toMatchObject({
        success: true,
        agentRuleAudit: {
          patternInference: {
            patterns: ["ai_agent"],
          },
        },
      });

      const body = JSON.parse(getFetchInit().body);
      expect(body.nodes).toEqual([
        expect.objectContaining({
          name: "Manual Trigger",
          type: "n8n-nodes-base.manualTrigger",
          typeVersion: 1,
        }),
        expect.objectContaining({
          name: "MCP Client Call Tool",
          type: "@n8n/n8n-nodes-langchain.mcpClient",
          typeVersion: 1.1,
          parameters: expect.objectContaining({
            serverTransport: "httpStreamable",
            authentication: "none",
            inputMode: "json",
            endpointUrl: "https://mcp.n8nworkflow.com/mcp",
          }),
        }),
      ]);
    });
  });

  describe("large workflow graph tools", () => {
    const existingWorkflow = {
      id: "workflow-large",
      name: "Large workflow",
      nodes: [
        {
          name: "Manual Trigger",
          type: "n8n-nodes-base.manualTrigger",
          parameters: {},
        },
        {
          name: "HTTP Request",
          type: "n8n-nodes-base.httpRequest",
          parameters: { url: "https://api.example.com" },
        },
        {
          name: "Slack Alert",
          type: "n8n-nodes-base.slack",
          parameters: { channel: "#ops" },
        },
      ],
      connections: {
        "Manual Trigger": {
          main: [[{ node: "HTTP Request", type: "main", index: 0 }]],
        },
        "HTTP Request": {
          main: [[{ node: "Missing Node", type: "main", index: 0 }]],
        },
      },
      settings: { executionOrder: "v1" },
    };

    it("analyzes an existing workflow graph without mutating it", async () => {
      mockN8nResponse(existingWorkflow);

      const result = await runTool(mockN8nInstance, "analyze_workflow_graph", {
        id: "workflow-large",
      });

      expect(result).toMatchObject({
        workflow_id: "workflow-large",
        analysis: {
          summary: {
            nodeCount: 3,
            orphanCount: 1,
            brokenConnectionCount: 1,
          },
          orphanNodes: ["Slack Alert"],
        },
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(String(mockFetch.mock.calls[0][0])).toContain("/workflows/workflow-large");
      expect(getFetchInit().method).toBeUndefined();
    });

    it("requires explicit confirmation before executing a workflow", async () => {
      await expect(
        runTool(mockN8nInstance, "execute_workflow", {
          id: "workflow-large",
        }),
      ).rejects.toThrow(/requires confirmation/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("requires explicit confirmation before applying a workflow patch", async () => {
      await expect(
        runTool(mockN8nInstance, "apply_workflow_patch", {
          id: "workflow-large",
          patch: { operations: [] },
        }),
      ).rejects.toThrow(/requires confirmation/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects apply_workflow_patch when confirm true is supplied without a confirmation token", async () => {
      await expect(
        runTool(mockN8nInstance, "apply_workflow_patch", {
          id: "workflow-large",
          patch: { operations: [] },
          confirm: true,
        }),
      ).rejects.toThrow(/confirmation token/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("requires explicit confirmation before safely applying a workflow patch", async () => {
      await expect(
        runTool(mockN8nInstance, "safe_apply_workflow_patch", {
          id: "workflow-large",
          patch: { operations: [] },
        }),
      ).rejects.toThrow(/requires confirmation/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("rejects safe_apply_workflow_patch when confirm true is supplied without a confirmation token", async () => {
      await expect(
        runTool(mockN8nInstance, "safe_apply_workflow_patch", {
          id: "workflow-large",
          patch: { operations: [] },
          confirm: true,
        }),
      ).rejects.toThrow(/confirmation token/);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("applies a validated patch to the existing workflow instead of deleting and recreating it", async () => {
      const confirmationToken = await issueConfirmationToken("apply_workflow_patch", {
        id: "workflow-large",
        patch: {
          operations: [
            {
              op: "updateNodeParameters",
              node: "Slack Alert",
              parameters: { text: "Updated alert" },
            },
            { op: "addConnection", from: "HTTP Request", to: "Slack Alert" },
            { op: "removeConnection", from: "HTTP Request", to: "Missing Node" },
          ],
        },
      });
      expect(confirmationToken).toMatch(/^mcp_confirm_/);
      expect(mockFetch).not.toHaveBeenCalled();

      mockN8nResponse(existingWorkflow);
      mockN8nResponse({ id: "workflow-large", name: "Large workflow" });

      const result = await runTool(mockN8nInstance, "apply_workflow_patch", {
        id: "workflow-large",
        patch: {
          operations: [
            {
              op: "updateNodeParameters",
              node: "Slack Alert",
              parameters: { text: "Updated alert" },
            },
            { op: "addConnection", from: "HTTP Request", to: "Slack Alert" },
            { op: "removeConnection", from: "HTTP Request", to: "Missing Node" },
          ],
        },
        confirm: true,
        confirmationToken,
      });

      expect(result).toMatchObject({
        success: true,
        workflow: { id: "workflow-large" },
        analysis: {
          summary: {
            brokenConnectionCount: 0,
          },
        },
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(String(mockFetch.mock.calls[1][0])).toContain("/workflows/workflow-large");
      expect(getFetchInit(1).method).toBe("PATCH");

      const patchBody = JSON.parse(getFetchInit(1).body);
      expect(patchBody.nodes).toHaveLength(3);
      expect(
        patchBody.nodes.find((node: { name: string }) => node.name === "Slack Alert").parameters
          .text,
      ).toBe("Updated alert");
      expect(patchBody.connections["HTTP Request"]).toEqual({
        main: [[{ node: "Slack Alert", type: "main", index: 0 }]],
      });
      expect(mockFetch.mock.calls.some((call) => String(call[0]).includes("/workflows"))).toBe(
        true,
      );
      expect(
        mockFetch.mock.calls.every(
          (call) => getFetchInit(mockFetch.mock.calls.indexOf(call)).method !== "DELETE",
        ),
      ).toBe(true);
    });

    it("returns patch validation errors without updating n8n", async () => {
      const patch = {
        operations: [
          {
            op: "updateNodeParameters",
            node: "Missing Node",
            parameters: { text: "Nope" },
          },
        ],
      };
      const confirmationToken = await issueConfirmationToken("apply_workflow_patch", {
        id: "workflow-large",
        patch,
      });
      expect(confirmationToken).toMatch(/^mcp_confirm_/);
      expect(mockFetch).not.toHaveBeenCalled();

      mockN8nResponse(existingWorkflow);

      const result = await runTool(mockN8nInstance, "apply_workflow_patch", {
        id: "workflow-large",
        patch,
        confirm: true,
        confirmationToken,
      });

      expect(result).toMatchObject({
        success: false,
        message: "Workflow patch validation failed. Fix the patch and try again.",
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("proposes safe workflow patches without mutating n8n", async () => {
      mockN8nResponse(existingWorkflow);

      const result = await runTool(mockN8nInstance, "propose_workflow_patch", {
        id: "workflow-large",
      });

      expect(result).toMatchObject({
        workflow_id: "workflow-large",
        proposal: {
          confidence: "high",
          patch: {
            operations: [{ op: "removeConnection", from: "HTTP Request", to: "Missing Node" }],
          },
        },
        analysis: {
          summary: {
            brokenConnectionCount: 1,
          },
        },
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(getFetchInit().method).toBeUndefined();
    });

    it("proposes conservative simplification candidates without mutating n8n", async () => {
      mockN8nResponse({
        ...existingWorkflow,
        nodes: [
          ...existingWorkflow.nodes,
          {
            name: "Dead Set",
            type: "n8n-nodes-base.set",
            parameters: { values: {} },
          },
        ],
      });

      const result = await runTool(mockN8nInstance, "propose_workflow_simplification", {
        id: "workflow-large",
      });

      expect(result).toMatchObject({
        workflow_id: "workflow-large",
        proposal: {
          mode: "conservative",
          safePatch: {
            operations: [{ op: "removeConnection", from: "HTTP Request", to: "Missing Node" }],
          },
          removableNodes: [
            expect.objectContaining({
              node: "Dead Set",
              action: "removeNode",
              confidence: "high",
            }),
          ],
        },
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(getFetchInit().method).toBeUndefined();
    });

    it("previews workflow simplification without mutating n8n", async () => {
      mockN8nResponse({
        ...existingWorkflow,
        nodes: [
          ...existingWorkflow.nodes,
          { name: "Dead Set", type: "n8n-nodes-base.set", parameters: {} },
        ],
      });

      const result = await runTool(mockN8nInstance, "preview_workflow_simplification", {
        id: "workflow-large",
        candidateNodeNames: ["Dead Set", "Slack Alert"],
      });

      expect(result).toMatchObject({
        workflow_id: "workflow-large",
        preview: {
          valid: false,
          requestedNodes: ["Dead Set", "Slack Alert"],
          approvedNodes: ["Dead Set"],
          rejectedNodes: [
            {
              node: "Slack Alert",
              reason: "Requested node is not an approved conservative simplification candidate.",
            },
          ],
          nodeCountBefore: 4,
          nodeCountAfter: 3,
        },
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(getFetchInit().method).toBeUndefined();
    });

    it("safely applies workflow simplification only by creating a new draft", async () => {
      mockN8nResponse({
        ...existingWorkflow,
        nodes: [
          ...existingWorkflow.nodes,
          { name: "Dead Set", type: "n8n-nodes-base.set", parameters: {} },
        ],
      });
      mockN8nResponse({ id: "simplified-draft", name: "Simplified Large workflow", active: false });

      const result = await runTool(mockN8nInstance, "safe_apply_workflow_simplification", {
        id: "workflow-large",
        candidateNodeNames: ["Dead Set"],
        name: "Simplified Large workflow",
      });

      expect(result).toMatchObject({
        success: true,
        source_workflow_id: "workflow-large",
        draft_workflow: { id: "simplified-draft", active: false },
        preview: {
          valid: true,
          approvedNodes: ["Dead Set"],
          nodeCountBefore: 4,
          nodeCountAfter: 3,
        },
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(getFetchInit(0).method).toBeUndefined();
      expect(getFetchInit(1).method).toBe("POST");
      expect(
        mockFetch.mock.calls.every(
          (call) => getFetchInit(mockFetch.mock.calls.indexOf(call)).method !== "PATCH",
        ),
      ).toBe(true);

      const createBody = JSON.parse(getFetchInit(1).body);
      expect(createBody.name).toBe("Simplified Large workflow");
      expect(createBody.nodes.map((node: { name: string }) => node.name)).toEqual([
        "Manual Trigger",
        "HTTP Request",
        "Slack Alert",
      ]);
      expect(createBody.connections["HTTP Request"]).toEqual({
        main: [[]],
      });
      expect(createBody.active).toBe(false);
    });

    it("summarizes workflow modules without updating the workflow", async () => {
      mockN8nResponse(existingWorkflow);

      const result = await runTool(mockN8nInstance, "summarize_workflow_modules", {
        id: "workflow-large",
      });

      expect(result).toMatchObject({
        workflow_id: "workflow-large",
        modules: [
          {
            root: "Manual Trigger",
            nodeCount: 2,
            brokenConnections: [
              expect.objectContaining({ from: "HTTP Request", to: "Missing Node" }),
            ],
          },
        ],
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("audits expression dependencies without mutating n8n", async () => {
      mockN8nResponse({
        ...existingWorkflow,
        nodes: existingWorkflow.nodes.map((node) =>
          node.name === "Slack Alert"
            ? {
                ...node,
                parameters: {
                  text: '={{ $node["HTTP Request"].json.total }} {{ $node["Missing Node"].json }}',
                },
              }
            : node,
        ),
      });

      const result = await runTool(mockN8nInstance, "audit_expression_dependencies", {
        id: "workflow-large",
      });

      expect(result).toMatchObject({
        workflow_id: "workflow-large",
        audit: {
          dependencyCount: 2,
          missingCount: 1,
          missingReferences: [
            {
              fromNode: "Slack Alert",
              toNode: "Missing Node",
            },
          ],
        },
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("infers workflow business intent without mutating n8n", async () => {
      mockN8nResponse({
        ...existingWorkflow,
        name: "Amazon Ads order report",
        nodes: [
          {
            name: "Fetch Shopify Orders",
            type: "n8n-nodes-base.httpRequest",
            parameters: { url: "https://store.myshopify.com/admin/api/orders.json" },
          },
          {
            name: "Get Amazon Ads Campaign Report",
            type: "n8n-nodes-base.httpRequest",
            parameters: { url: "https://advertising-api.amazon.com/reporting/reports" },
          },
          {
            name: "Slack Daily Revenue Alert",
            type: "n8n-nodes-base.slack",
            parameters: { text: "Daily revenue" },
          },
        ],
        connections: {
          "Fetch Shopify Orders": {
            main: [[{ node: "Get Amazon Ads Campaign Report", type: "main", index: 0 }]],
          },
          "Get Amazon Ads Campaign Report": {
            main: [[{ node: "Slack Daily Revenue Alert", type: "main", index: 0 }]],
          },
        },
      });

      const result = await runTool(mockN8nInstance, "infer_workflow_business_intent", {
        id: "workflow-large",
      });

      expect(result).toMatchObject({
        workflow_id: "workflow-large",
        intent: {
          summary: {
            primaryIntent: "Advertising performance and commerce operations reporting",
            confidence: "high",
            domains: ["advertising", "orders", "notifications"],
            systems: ["Amazon Ads", "Shopify", "Slack"],
          },
        },
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(getFetchInit().method).toBeUndefined();
    });

    it("clones an existing workflow as a draft instead of editing the source workflow", async () => {
      mockN8nResponse({ ...existingWorkflow, active: true, versionId: "source-version" });
      mockN8nResponse({ id: "draft-workflow", name: "Large workflow draft", active: false });

      const result = await runTool(mockN8nInstance, "clone_workflow_as_draft", {
        id: "workflow-large",
        name: "Large workflow draft",
      });

      expect(result).toMatchObject({
        success: true,
        source_workflow_id: "workflow-large",
        draft_workflow: { id: "draft-workflow", name: "Large workflow draft" },
      });
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(String(mockFetch.mock.calls[0][0])).toContain("/workflows/workflow-large");
      expect(String(mockFetch.mock.calls[1][0])).toContain("/workflows");
      expect(getFetchInit(1).method).toBe("POST");

      const createBody = JSON.parse(getFetchInit(1).body);
      expect(createBody).toMatchObject({
        name: "Large workflow draft",
        nodes: existingWorkflow.nodes,
        connections: existingWorkflow.connections,
        settings: existingWorkflow.settings,
        active: false,
      });
      expect(createBody.id).toBeUndefined();
      expect(createBody.versionId).toBeUndefined();
      expect(
        mockFetch.mock.calls.every(
          (call) => getFetchInit(mockFetch.mock.calls.indexOf(call)).method !== "DELETE",
        ),
      ).toBe(true);
    });

    it("previews a workflow patch diff without mutating n8n", async () => {
      mockN8nResponse(existingWorkflow);

      const result = await runTool(mockN8nInstance, "preview_workflow_patch", {
        id: "workflow-large",
        patch: {
          operations: [
            { op: "updateNodeParameters", node: "Slack Alert", parameters: { text: "Updated" } },
            { op: "removeConnection", from: "HTTP Request", to: "Missing Node" },
          ],
        },
      });

      expect(result).toMatchObject({
        workflow_id: "workflow-large",
        validation: { valid: true },
        diff: {
          changed: true,
          summary: {
            updatedNodes: 1,
            removedConnections: 1,
          },
        },
      });
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(getFetchInit().method).toBeUndefined();
    });

    it("safely applies a patch and rolls back when validation after update fails", async () => {
      const patch = {
        operations: [
          {
            op: "updateNodeParameters",
            node: "Slack Alert",
            parameters: { text: '={{ $node["Missing Node"].json.value }}' },
          },
        ],
      };
      const confirmationToken = await issueConfirmationToken("safe_apply_workflow_patch", {
        id: "workflow-large",
        patch,
        postApplyChecks: ["expressionDependencies"],
      });
      expect(confirmationToken).toMatch(/^mcp_confirm_/);
      expect(mockFetch).not.toHaveBeenCalled();

      mockN8nResponse(existingWorkflow);
      mockN8nResponse({ id: "workflow-large", name: "Large workflow", saved: true });
      mockN8nResponse({ id: "workflow-large", name: "Large workflow", rolledBack: true });

      const result = await runTool(mockN8nInstance, "safe_apply_workflow_patch", {
        id: "workflow-large",
        patch,
        postApplyChecks: ["expressionDependencies"],
        confirm: true,
        confirmationToken,
      });

      expect(result).toMatchObject({
        success: false,
        rolled_back: true,
        message: "Post-apply validation failed; rollback patch was applied.",
        post_apply_validation: {
          expressionDependencies: {
            missingCount: 1,
          },
        },
        rollback_workflow: { rolledBack: true },
      });
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(getFetchInit(1).method).toBe("PATCH");
      expect(getFetchInit(2).method).toBe("PATCH");

      const rollbackBody = JSON.parse(getFetchInit(2).body);
      expect(
        rollbackBody.nodes.find((node: { name: string }) => node.name === "Slack Alert").parameters,
      ).toEqual({ channel: "#ops" });
    });
  });
});
