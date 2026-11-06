import { beforeEach, describe, expect, it, vi } from "vitest";

const mcpServerMocks = vi.hoisted(() => ({
  authenticateBearer: vi.fn(),
  reserveDailyQuota: vi.fn(),
  releaseDailyQuota: vi.fn(),
  checkShortWindowQuota: vi.fn(),
  dispatchTool: vi.fn(),
  getDefaultInstance: vi.fn(),
  getMergedTools: vi.fn(),
  recordCall: vi.fn(),
}));

vi.mock("@/lib/mcp.server", () => ({
  ...mcpServerMocks,
  ElicitationRequiredError: class ElicitationRequiredError extends Error {
    constructor(
      public readonly elicitationId: string,
      public readonly request: unknown,
    ) {
      super(`Elicitation required (${elicitationId})`);
    }
  },
}));

vi.mock("@/lib/mcp-upstream.server", () => ({
  isUpstreamConfigured: vi.fn(() => false),
}));

vi.mock("@/lib/logger.server", () => ({
  getRequestId: vi.fn(() => "request-id-1"),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { mcpPost } from "../mcp-route.server";

describe("mcp route elicitation transport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mcpServerMocks.authenticateBearer.mockResolvedValue({
      user_id: "user-1",
      key_id: "key-1",
    });
    mcpServerMocks.checkShortWindowQuota.mockResolvedValue(true);
    mcpServerMocks.reserveDailyQuota.mockResolvedValue({
      ok: true,
      used: 0,
      limit: 1000,
    });
    mcpServerMocks.getDefaultInstance.mockResolvedValue({
      id: "instance-1",
      name: "Test Instance",
      base_url: "https://n8n.example.com",
      api_key: "test-key",
    });
  });

  describe("capability parsing and session handling", () => {
    it("records structured business failures as failed tool calls", async () => {
      mcpServerMocks.dispatchTool.mockResolvedValue({
        output: {
          success: false,
          message: "Validation failed",
          results: { validation: { passed: false, errors: ["Missing URL"] } },
        },
        upstream: false,
        category: "local",
        needsInstance: false,
      });

      const response = await mcpPost(
        new Request("https://example.com/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "business-failure",
            method: "tools/call",
            params: {
              name: "deploy_and_test_workflow",
              arguments: { workflowId: "wf-1", testData: { id: 1 } },
            },
          }),
        }),
      );
      const payload = await response.json();

      expect(mcpServerMocks.recordCall).toHaveBeenCalledWith(
        expect.objectContaining({
          status: "error",
          error_message: "Validation failed",
          metadata: expect.objectContaining({ businessSuccess: false }),
        }),
      );
      expect(payload).toMatchObject({
        result: expect.objectContaining({ isError: true }),
      });
    });

    it("passes the confirmation token challenge through to the client", async () => {
      // The prompt contains "confirmationToken"; the generic secret filter used
      // to drop it, so deploy_and_test_workflow could never be confirmed.
      mcpServerMocks.dispatchTool.mockRejectedValue(
        new Error(
          'Deploy and test workflow requires confirmation. Re-send with {"confirm": true, "confirmationToken": "mcp_confirm_kJupli2ld6PehWeqiGhGZg"} to proceed.',
        ),
      );

      const response = await mcpPost(
        new Request("https://example.com/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "confirm-token",
            method: "tools/call",
            params: {
              name: "deploy_and_test_workflow",
              arguments: { workflowId: "wf-1", testData: { id: 1 } },
            },
          }),
        }),
      );
      const payload = await response.json();

      expect(payload.result.isError).toBe(true);
      expect(payload.result.content[0].text).toContain(
        '"confirmationToken": "mcp_confirm_kJupli2ld6PehWeqiGhGZg"',
      );
    });

    it("still hides other errors that mention tokens or keys", async () => {
      mcpServerMocks.dispatchTool.mockRejectedValue(
        new Error("n8n rejected token abc123 for https://n8n.example.com"),
      );

      const response = await mcpPost(
        new Request("https://example.com/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "secret-error",
            method: "tools/call",
            params: { name: "list_workflows", arguments: {} },
          }),
        }),
      );
      const payload = await response.json();

      expect(payload.result.content[0].text).not.toContain("abc123");
      expect(payload.result.content[0].text).toMatch(/^Tool execution failed\./);
      // The persisted call log gets the generic fallback, never the raw message.
      expect(mcpServerMocks.recordCall).toHaveBeenCalledWith(
        expect.objectContaining({ status: "error", error_message: "Tool execution failed" }),
      );
      expect(JSON.stringify(mcpServerMocks.recordCall.mock.calls)).not.toContain("abc123");
    });

    it("persists only sanitized text for thrown tool errors", async () => {
      class UpstreamTimeoutError extends Error {
        constructor() {
          super("fetch to https://internal.n8n.local:5678/api/v1/workflows/wf-1 timed out");
          this.name = "UpstreamTimeoutError";
        }
      }
      mcpServerMocks.dispatchTool
        .mockRejectedValueOnce(new UpstreamTimeoutError())
        .mockRejectedValueOnce(
          new Error(
            "The n8n instance changed since this audit entry was recorded; rollback was not applied.",
          ),
        );

      for (const id of ["raw-1", "raw-2"]) {
        await mcpPost(
          new Request("https://example.com/mcp", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id,
              method: "tools/call",
              params: { name: "rollback_workflow", arguments: { auditLogId: "audit-1" } },
            }),
          }),
        );
      }

      const persisted = mcpServerMocks.recordCall.mock.calls.map(
        ([call]) => (call as { error_message?: string }).error_message,
      );
      expect(persisted).toEqual([
        "Tool execution failed (UpstreamTimeoutError)",
        "The n8n instance changed since this audit entry was recorded; rollback was not applied.",
      ]);
      expect(JSON.stringify(persisted)).not.toContain("internal.n8n.local");
    });

    it("returns a structured elicitation required error when confirm is not provided", async () => {
      mcpServerMocks.dispatchTool.mockImplementation(async () => {
        const { ElicitationRequiredError } = await import("@/lib/mcp.server");
        throw new ElicitationRequiredError("elicitation_abc", {
          title: "Delete workflow",
          description: "Delete workflow wf-1",
          schema: {
            type: "object",
            properties: { confirm: { type: "boolean" } },
            required: ["confirm"],
          },
        });
      });

      const req = new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          method: "tools/call",
          params: {
            name: "delete_workflow",
            clientCapabilities: { elicitation: true },
            arguments: { id: "wf-1" },
          },
        }),
      });

      const response = await mcpPost(req);
      const payload = await response.json();

      expect(payload).toMatchObject({
        jsonrpc: "2.0",
        id: "1",
        result: expect.objectContaining({
          isError: true,
          code: "elicitation_required",
          request: expect.objectContaining({
            elicitationId: "elicitation_abc",
            title: "Delete workflow",
          }),
        }),
      });
    });

    it("reuses session capabilities for subsequent calls without inline capabilities", async () => {
      const initReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-1",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "init",
          method: "initialize",
          params: {
            clientCapabilities: { elicitation: true },
          },
        }),
      });

      const initResponse = await mcpPost(initReq);
      expect(initResponse.status).toBe(200);

      mcpServerMocks.dispatchTool.mockImplementation(async () => {
        const { ElicitationRequiredError } = await import("@/lib/mcp.server");
        throw new ElicitationRequiredError("elicitation_session_1", {
          title: "Delete workflow",
          description: "Delete workflow wf-session",
          schema: {
            type: "object",
            properties: { confirm: { type: "boolean" } },
            required: ["confirm"],
          },
        });
      });

      const callReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-1",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "call-no-caps",
          method: "tools/call",
          params: {
            name: "delete_workflow",
            arguments: { id: "wf-session" },
          },
        }),
      });

      const callResponse = await mcpPost(callReq);
      const callPayload = await callResponse.json();
      expect(callPayload).toMatchObject({
        jsonrpc: "2.0",
        id: "call-no-caps",
        result: expect.objectContaining({
          isError: true,
          code: "elicitation_required",
          request: expect.objectContaining({
            elicitationId: "elicitation_session_1",
            title: "Delete workflow",
          }),
        }),
      });
    });

    it("records trusted preview metadata with the stable session id", async () => {
      mcpServerMocks.dispatchTool.mockResolvedValue({
        output: {
          workflowId: "wf-metadata",
          baseVersionId: "v1",
          baseFingerprint: "fingerprint-1",
          diff: { changedNodes: ["HTTP Request"] },
          validation: { ok: true, errors: [], warnings: [] },
        },
        upstream: false,
        category: "local",
        needsInstance: false,
      });

      const response = await mcpPost(
        new Request("https://example.com/mcp", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "mcp-session-id": "session-metadata",
          },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "metadata-call",
            method: "tools/call",
            params: {
              name: "preview_workflow_diff",
              arguments: {
                workflowId: "wf-metadata",
                operations: [{ type: "cleanStaleConnections" }],
              },
            },
          }),
        }),
      );

      expect(response.status).toBe(200);
      expect(mcpServerMocks.recordCall).toHaveBeenCalledWith(
        expect.objectContaining({
          workflow_id: "wf-metadata",
          session_id: "session-metadata",
          metadata: expect.objectContaining({
            workflowId: "wf-metadata",
            baseVersionId: "v1",
            operations: [{ type: "cleanStaleConnections" }],
          }),
        }),
      );
      expect(mcpServerMocks.dispatchTool).toHaveBeenCalledWith(
        "preview_workflow_diff",
        expect.any(Object),
        expect.any(Function),
        expect.objectContaining({ session_id: "session-metadata" }),
      );
    });

    it("lets request capabilities override session capabilities", async () => {
      const initReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-3",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "init-no-e",
          method: "initialize",
          params: {
            clientCapabilities: { elicitation: false },
          },
        }),
      });
      const initResponse = await mcpPost(initReq);
      expect(initResponse.status).toBe(200);

      mcpServerMocks.dispatchTool.mockImplementation(async () => {
        const { ElicitationRequiredError } = await import("@/lib/mcp.server");
        throw new ElicitationRequiredError("elicitation_override_1", {
          title: "Rollback workflow",
          description: "Rollback workflow wf-override",
          schema: {
            type: "object",
            properties: { confirm: { type: "boolean" } },
            required: ["confirm"],
          },
        });
      });

      const callReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-3",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "call-override",
          method: "tools/call",
          params: {
            name: "rollback_workflow",
            clientCapabilities: { elicitation: true },
            arguments: {
              auditLogId: "audit-1",
            },
          },
        }),
      });

      const payload = await (await mcpPost(callReq)).json();
      expect(payload).toMatchObject({
        jsonrpc: "2.0",
        id: "call-override",
        result: expect.objectContaining({
          isError: true,
          code: "elicitation_required",
          request: expect.objectContaining({
            elicitationId: "elicitation_override_1",
            title: "Rollback workflow",
          }),
        }),
      });
    });

    it("isolates capability cache by session id", async () => {
      const initReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-a",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "init-session-a",
          method: "initialize",
          params: {
            clientCapabilities: { elicitation: true },
          },
        }),
      });
      const initResponse = await mcpPost(initReq);
      expect(initResponse.status).toBe(200);

      mcpServerMocks.dispatchTool.mockImplementation(async () => {
        throw new Error("Delete workflow requires confirmation.");
      });

      const callReqWrongSession = new Request("https://example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-b",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "call-different-session",
          method: "tools/call",
          params: {
            name: "delete_workflow",
            arguments: { id: "wf-session-isolated" },
          },
        }),
      });

      const payload = await (await mcpPost(callReqWrongSession)).json();
      expect(payload).toMatchObject({
        jsonrpc: "2.0",
        id: "call-different-session",
        result: {
          content: [
            {
              type: "text",
              text: expect.stringContaining("Delete workflow requires confirmation."),
            },
          ],
          isError: true,
        },
      });
    });

    it("extracts legacy capabilities from initialize params", async () => {
      const initReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-session-id": "session-2",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "init-legacy",
          method: "initialize",
          params: {
            capabilities: { elicitation: true },
          },
        }),
      });

      const initResponse = await mcpPost(initReq);
      expect(initResponse.status).toBe(200);

      mcpServerMocks.dispatchTool.mockImplementation(async () => {
        const { ElicitationRequiredError } = await import("@/lib/mcp.server");
        throw new ElicitationRequiredError("elicitation_legacy_1", {
          title: "Update workflow",
          description: "Update workflow wf-legacy",
          schema: {
            type: "object",
            properties: { confirm: { type: "boolean" } },
            required: ["confirm"],
          },
        });
      });

      const callReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-session-id": "session-2",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "legacy-call-no-caps",
          method: "tools/call",
          params: {
            name: "update_workflow",
            arguments: {
              id: "wf-legacy",
              name: "legacy",
            },
          },
        }),
      });

      const callResponse = await mcpPost(callReq);
      const callPayload = await callResponse.json();
      expect(callPayload).toMatchObject({
        jsonrpc: "2.0",
        id: "legacy-call-no-caps",
        result: expect.objectContaining({
          isError: true,
          code: "elicitation_required",
          request: expect.objectContaining({
            elicitationId: "elicitation_legacy_1",
            title: "Update workflow",
          }),
        }),
      });
    });

    it("supports experimental clientCapabilities for tools/call", async () => {
      mcpServerMocks.dispatchTool.mockImplementation(async () => {
        const { ElicitationRequiredError } = await import("@/lib/mcp.server");
        throw new ElicitationRequiredError("elicitation_experimental_1", {
          title: "Delete workflow",
          description: "Delete workflow wf-experimental",
          schema: {
            type: "object",
            properties: { confirm: { type: "boolean" } },
            required: ["confirm"],
          },
        });
      });

      const callReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "experimental-caps",
          method: "tools/call",
          params: {
            name: "delete_workflow",
            experimental: {
              clientCapabilities: {
                elicitation: true,
              },
            },
            arguments: { id: "wf-exp" },
          },
        }),
      });

      const response = await mcpPost(callReq);
      const payload = await response.json();
      expect(payload).toMatchObject({
        jsonrpc: "2.0",
        id: "experimental-caps",
        result: expect.objectContaining({
          isError: true,
          code: "elicitation_required",
          request: expect.objectContaining({
            elicitationId: "elicitation_experimental_1",
            title: "Delete workflow",
          }),
        }),
      });
    });

    it("does not persist elicitation capability when initialize params are empty", async () => {
      const initReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-no-caps",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "init-empty",
          method: "initialize",
          params: {},
        }),
      });
      const initResponse = await mcpPost(initReq);
      expect(initResponse.status).toBe(200);

      mcpServerMocks.dispatchTool.mockImplementation(async () => {
        throw new Error("Delete workflow requires confirmation.");
      });

      const callReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-no-caps",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "call-empty-caps",
          method: "tools/call",
          params: {
            name: "delete_workflow",
            arguments: { id: "wf-empty" },
          },
        }),
      });

      const payload = await (await mcpPost(callReq)).json();
      expect(payload).toMatchObject({
        jsonrpc: "2.0",
        id: "call-empty-caps",
        result: {
          content: [
            {
              type: "text",
              text: expect.stringContaining("Delete workflow requires confirmation."),
            },
          ],
          isError: true,
        },
      });
    });

    it("ignores non-object initialize capabilities payload", async () => {
      const initReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-bad-caps",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "init-bad-caps",
          method: "initialize",
          params: {
            clientCapabilities: "true",
          },
        }),
      });
      const initResponse = await mcpPost(initReq);
      expect(initResponse.status).toBe(200);

      mcpServerMocks.dispatchTool.mockImplementation(async () => {
        throw new Error("Delete workflow requires confirmation.");
      });

      const callReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "mcp-session-id": "session-bad-caps",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "call-bad-caps",
          method: "tools/call",
          params: {
            name: "delete_workflow",
            arguments: { id: "wf-bad" },
          },
        }),
      });

      const payload = await (await mcpPost(callReq)).json();
      expect(payload).toMatchObject({
        jsonrpc: "2.0",
        id: "call-bad-caps",
        result: {
          content: [
            {
              type: "text",
              text: expect.stringContaining("Delete workflow requires confirmation."),
            },
          ],
          isError: true,
        },
      });
    });
  });

  describe("notifications/elicitation/complete endpoint", () => {
    const confirmSchema = {
      type: "object" as const,
      properties: { confirm: { type: "boolean" } },
      required: ["confirm"],
    };

    async function rpc(id: string, method: string, params: Record<string, unknown>) {
      const response = await mcpPost(
        new Request("https://example.com/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        }),
      );
      expect(response.status).toBe(200);
      return response.json();
    }

    /** The mocked tool asks to confirm deleting `args.id` and echoes the answer. */
    function confirmingTool() {
      mcpServerMocks.dispatchTool.mockImplementation(async (_name, args, _inst, ctx) => {
        const response = await ctx.requestElicitation?.({
          title: "Delete workflow",
          description: `Delete workflow ${String(args.id)}`,
          schema: confirmSchema,
        });
        return { output: response, upstream: false, category: "local", needsInstance: false };
      });
    }

    function callTool(id: string, workflowId: string, elicitationResponse?: unknown) {
      return rpc(id, "tools/call", {
        name: "delete_workflow",
        clientCapabilities: { elicitation: true },
        arguments: { id: workflowId },
        ...(elicitationResponse === undefined ? {} : { elicitationResponse }),
      });
    }

    async function issueElicitation(workflowId: string): Promise<string> {
      confirmingTool();
      const payload = await callTool(`issue-${workflowId}`, workflowId);
      expect(payload).toMatchObject({ result: { code: "elicitation_required" } });
      return payload.result.request.elicitationId as string;
    }

    function complete(id: string, params: Record<string, unknown>) {
      return rpc(id, "notifications/elicitation/complete", params);
    }

    const accept = { action: "accept", content: { confirm: true } };

    it("accepts the MCP accept shape for an issued elicitation and replays it", async () => {
      const elicitationId = await issueElicitation("wf-1");
      expect(elicitationId).toMatch(/^elicitation_/);

      await expect(complete("c1", { elicitationId, ...accept })).resolves.toMatchObject({
        result: { ok: true, elicitationId },
      });

      const payload = await callTool("r1", "wf-1", { elicitationId });
      expect(payload).toMatchObject({
        result: {
          content: [{ type: "text", text: expect.stringContaining('"confirm": true') }],
          isError: false,
        },
      });
    });

    it("still accepts the pre-spec action object as an implicit accept", async () => {
      const elicitationId = await issueElicitation("wf-legacy");
      await complete("c2", { elicitationId, action: { confirm: true } });

      const payload = await callTool("r2", "wf-legacy", { elicitationId });
      expect(payload.result.content[0].text).toContain('"confirm": true');
    });

    it("records decline and cancel as an empty answer so confirmation fails closed", async () => {
      for (const action of ["decline", "cancel"]) {
        const elicitationId = await issueElicitation(`wf-${action}`);
        await expect(complete(`c-${action}`, { elicitationId, action })).resolves.toMatchObject({
          result: { ok: true },
        });
        const payload = await callTool(`r-${action}`, `wf-${action}`, { elicitationId });
        expect(payload.result.isError).toBe(false);
        expect(payload.result.content[0].text).not.toContain("confirm");
      }
    });

    it("ignores an inline answer that does not name an issued elicitation", async () => {
      confirmingTool();
      const payload = await callTool("inline", "wf-inline", { confirm: true });
      expect(payload).toMatchObject({
        result: { isError: true, code: "elicitation_required" },
      });
    });

    it("rejects completion of an id the server never issued", async () => {
      await expect(
        complete("c3", { elicitationId: "elicitation_forged", ...accept }),
      ).resolves.toMatchObject({
        error: { code: -32602, message: "Unknown or expired elicitationId" },
      });
    });

    it("rejects completion of an id issued to another user", async () => {
      const elicitationId = await issueElicitation("wf-owner");
      mcpServerMocks.authenticateBearer.mockResolvedValueOnce({
        user_id: "user-2",
        key_id: "key-2",
      });
      await expect(complete("c4", { elicitationId, ...accept })).resolves.toMatchObject({
        error: { code: -32602, message: "Unknown or expired elicitationId" },
      });
    });

    it("does not let one confirmation satisfy a different request", async () => {
      const elicitationId = await issueElicitation("wf-a");
      await complete("c5", { elicitationId, ...accept });

      const payload = await callTool("r5", "wf-b", { elicitationId });
      expect(payload).toMatchObject({
        result: {
          content: [
            { type: "text", text: expect.stringContaining("issued for a different request") },
          ],
          isError: true,
        },
      });
    });

    it("replays a completed elicitation only once", async () => {
      const elicitationId = await issueElicitation("wf-once");
      await complete("c6", { elicitationId, ...accept });

      const first = await callTool("r6a", "wf-once", { elicitationId });
      expect(first.result.isError).toBe(false);

      const second = await callTool("r6b", "wf-once", { elicitationId });
      expect(second.result.content[0].text).toContain(
        `Missing elicitation response for ${elicitationId}`,
      );
    });

    it("returns an explicit error when replaying an unknown elicitation", async () => {
      confirmingTool();
      const payload = await callTool("r7", "wf-3", { elicitationId: "missing_elicitation" });
      expect(payload).toMatchObject({
        result: {
          content: [
            {
              type: "text",
              text: expect.stringContaining("Missing elicitation response for missing_elicitation"),
            },
          ],
          isError: true,
        },
      });
    });

    it("expires an elicitation response after its TTL", async () => {
      const nowSpy = vi.spyOn(Date, "now");
      const baseline = Date.now();
      try {
        nowSpy.mockReturnValue(baseline);
        const elicitationId = await issueElicitation("wf-ttl");
        await complete("c8", { elicitationId, ...accept });

        nowSpy.mockReturnValue(baseline + 6 * 60 * 1000 + 1);
        const payload = await callTool("r8", "wf-ttl", { elicitationId });
        expect(payload.result.content[0].text).toContain(
          `Missing elicitation response for ${elicitationId}`,
        );
      } finally {
        nowSpy.mockRestore();
      }
    });

    it.each([
      ["without elicitationId", { ...accept }, "Missing elicitationId"],
      ["without action", { elicitationId: "e1" }, "Missing elicitation response payload"],
      [
        "with a boolean action",
        { elicitationId: "e1", action: true },
        "Missing elicitation response payload",
      ],
      [
        "accept without content",
        { elicitationId: "e1", action: "accept" },
        "Missing elicitation response payload",
      ],
      [
        "with an unknown action",
        { elicitationId: "e1", action: "maybe" },
        "Missing elicitation response payload",
      ],
    ])("rejects completion %s", async (_label, params, message) => {
      await expect(complete("bad", params)).resolves.toMatchObject({
        error: { code: -32602, message },
      });
    });
  });

  describe("non-elicitation fallback compatibility", () => {
    it("falls back to normal errors when client does not advertise elicitation", async () => {
      mcpServerMocks.dispatchTool.mockImplementation(async (_name, _args, _inst, ctx) => {
        expect(ctx.requestElicitation).toBeUndefined();
        throw new Error("Delete workflow requires confirmation.");
      });

      const callReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "13",
          method: "tools/call",
          params: {
            name: "delete_workflow",
            clientCapabilities: { elicitation: false },
            arguments: { id: "wf-7" },
          },
        }),
      });

      const callResponse = await mcpPost(callReq);
      const callPayload = await callResponse.json();
      expect(callPayload).toMatchObject({
        jsonrpc: "2.0",
        id: "13",
        result: {
          content: [
            {
              type: "text",
              text: expect.stringContaining("Delete workflow requires confirmation."),
            },
          ],
          isError: true,
        },
      });
    });

    it("ignores non-boolean elicitation capability values", async () => {
      mcpServerMocks.dispatchTool.mockImplementation(async (_name, _args, _inst, ctx) => {
        expect(ctx.requestElicitation).toBeUndefined();
        throw new Error("Delete workflow requires confirmation.");
      });

      const callReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "14",
          method: "tools/call",
          params: {
            name: "delete_workflow",
            clientCapabilities: { elicitation: "true" as unknown },
            arguments: { id: "wf-8" },
          },
        }),
      });

      const callResponse = await mcpPost(callReq);
      const callPayload = await callResponse.json();
      expect(callPayload).toMatchObject({
        jsonrpc: "2.0",
        id: "14",
        result: {
          content: [
            {
              type: "text",
              text: expect.stringContaining("Delete workflow requires confirmation."),
            },
          ],
          isError: true,
        },
      });
    });
  });
});
