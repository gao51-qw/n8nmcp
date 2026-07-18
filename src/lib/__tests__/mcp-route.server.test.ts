import { beforeEach, describe, expect, it, vi } from "vitest";

const mcpServerMocks = vi.hoisted(() => ({
  authenticateBearer: vi.fn(),
  checkDailyQuota: vi.fn(),
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
    mcpServerMocks.checkDailyQuota.mockResolvedValue({
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
        expect.any(Object),
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
    it("stores a completed elicitation response for replay", async () => {
      const req = new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "2",
          method: "notifications/elicitation/complete",
          params: {
            elicitationId: "elicitation_abc",
            action: { confirm: true },
          },
        }),
      });

      const response = await mcpPost(req);
      const payload = await response.json();

      expect(response.status).toBe(200);
      expect(payload).toMatchObject({
        jsonrpc: "2.0",
        id: "2",
        result: {
          ok: true,
          elicitationId: "elicitation_abc",
        },
      });
    });

    describe("tools/call replay behavior", () => {
      it("replays completed elicitation response for a subsequent tool call", async () => {
        const completeReq = new Request("https://example.com/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "3",
            method: "notifications/elicitation/complete",
            params: {
              elicitationId: "elicitation_replay_1",
              action: { confirm: true },
            },
          }),
        });

        await mcpPost(completeReq);

        mcpServerMocks.dispatchTool.mockImplementation(async (_name, _args, _inst, ctx) => {
          const response = await ctx.requestElicitation?.({
            title: "Delete workflow",
            description: "Delete workflow wf-2",
            schema: {
              type: "object",
              properties: { confirm: { type: "boolean" } },
              required: ["confirm"],
            },
          });
          if (response?.confirm !== true) {
            throw new Error("unexpected response");
          }
          return { output: { ok: true }, upstream: false, category: "local", needsInstance: false };
        });

        const callReq = new Request("https://example.com/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "4",
            method: "tools/call",
            params: {
              name: "delete_workflow",
              clientCapabilities: { elicitation: true },
              arguments: { id: "wf-2" },
              elicitationResponse: { elicitationId: "elicitation_replay_1" },
            },
          }),
        });

        const callResponse = await mcpPost(callReq);
        const callPayload = await callResponse.json();
        expect(callPayload).toMatchObject({
          jsonrpc: "2.0",
          id: "4",
          result: {
            content: [{ type: "text", text: expect.stringContaining('"ok": true') }],
            isError: false,
          },
        });
      });

      it("returns an explicit error when replaying a missing elicitation response", async () => {
        mcpServerMocks.dispatchTool.mockImplementation(async (_name, _args, _inst, ctx) => {
          const response = await ctx.requestElicitation?.({
            title: "Delete workflow",
            description: "Delete workflow wf-3",
            schema: {
              type: "object",
              properties: { confirm: { type: "boolean" } },
              required: ["confirm"],
            },
          });
          return { output: response, upstream: false, category: "local", needsInstance: false };
        });

        const callReq = new Request("https://example.com/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "5",
            method: "tools/call",
            params: {
              name: "delete_workflow",
              clientCapabilities: { elicitation: true },
              arguments: { id: "wf-3" },
              elicitationResponse: { elicitationId: "missing_elicitation" },
            },
          }),
        });

        const callResponse = await mcpPost(callReq);
        const callPayload = await callResponse.json();
        expect(callResponse.status).toBe(200);
        expect(callPayload).toMatchObject({
          jsonrpc: "2.0",
          id: "5",
          result: {
            content: [
              {
                type: "text",
                text: expect.stringContaining(
                  "Missing elicitation response for missing_elicitation",
                ),
              },
            ],
            isError: true,
          },
        });
      });

      it("rejects elicitation completion requests without elicitationId", async () => {
        const req = new Request("https://example.com/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "6",
            method: "notifications/elicitation/complete",
            params: {
              action: { confirm: true },
            },
          }),
        });

        const response = await mcpPost(req);
        const payload = await response.json();
        expect(response.status).toBe(200);
        expect(payload).toMatchObject({
          jsonrpc: "2.0",
          id: "6",
          error: {
            code: -32602,
            message: "Missing elicitationId",
          },
        });
      });

      it("rejects elicitation completion requests without action", async () => {
        const req = new Request("https://example.com/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "7",
            method: "notifications/elicitation/complete",
            params: {
              elicitationId: "elicitation_abc",
            },
          }),
        });

        const response = await mcpPost(req);
        const payload = await response.json();
        expect(response.status).toBe(200);
        expect(payload).toMatchObject({
          jsonrpc: "2.0",
          id: "7",
          error: {
            code: -32602,
            message: "Missing elicitation response payload",
          },
        });
      });

      it("rejects elicitation completion requests with non-object action", async () => {
        const req = new Request("https://example.com/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "7b",
            method: "notifications/elicitation/complete",
            params: {
              elicitationId: "elicitation_abc",
              action: true,
            },
          }),
        });

        const response = await mcpPost(req);
        const payload = await response.json();
        expect(response.status).toBe(200);
        expect(payload).toMatchObject({
          jsonrpc: "2.0",
          id: "7b",
          error: {
            code: -32602,
            message: "Missing elicitation response payload",
          },
        });
      });
    });

    it("treats an empty elicitationResponse object as direct response payload", async () => {
      mcpServerMocks.dispatchTool.mockImplementation(async (_name, _args, _inst, ctx) => {
        const response = await ctx.requestElicitation?.({
          title: "Delete workflow",
          description: "Delete workflow wf-4",
          schema: {
            type: "object",
            properties: { confirm: { type: "boolean" } },
            required: ["confirm"],
          },
        });
        return {
          output: { gotResponse: response },
          upstream: false,
          category: "local",
          needsInstance: false,
        };
      });

      const callReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "8",
          method: "tools/call",
          params: {
            name: "delete_workflow",
            clientCapabilities: { elicitation: true },
            arguments: { id: "wf-4" },
            elicitationResponse: {},
          },
        }),
      });

      const callResponse = await mcpPost(callReq);
      const callPayload = await callResponse.json();
      expect(callPayload).toMatchObject({
        jsonrpc: "2.0",
        id: "8",
        result: {
          content: [{ type: "text", text: expect.stringContaining('"gotResponse"') }],
          isError: false,
        },
      });
    });

    it("expires an elicitation response after one replay", async () => {
      const completeReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "9",
          method: "notifications/elicitation/complete",
          params: {
            elicitationId: "single_use_replay",
            action: { confirm: true },
          },
        }),
      });
      await mcpPost(completeReq);

      mcpServerMocks.dispatchTool.mockImplementation(async (_name, _args, _inst, ctx) => {
        const response = await ctx.requestElicitation?.({
          title: "Delete workflow",
          description: "Delete workflow wf-5",
          schema: {
            type: "object",
            properties: { confirm: { type: "boolean" } },
            required: ["confirm"],
          },
        });
        return {
          output: response,
          upstream: false,
          category: "local",
          needsInstance: false,
        };
      });

      const callReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "10",
          method: "tools/call",
          params: {
            name: "delete_workflow",
            clientCapabilities: { elicitation: true },
            arguments: { id: "wf-5" },
            elicitationResponse: { elicitationId: "single_use_replay" },
          },
        }),
      });

      const firstCall = await mcpPost(callReq);
      const firstPayload = await firstCall.json();
      expect(firstPayload).toMatchObject({
        jsonrpc: "2.0",
        id: "10",
        result: {
          content: [{ type: "text", text: expect.stringContaining('"confirm": true') }],
          isError: false,
        },
      });

      const secondCallReq = new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "10",
          method: "tools/call",
          params: {
            name: "delete_workflow",
            clientCapabilities: { elicitation: true },
            arguments: { id: "wf-5" },
            elicitationResponse: { elicitationId: "single_use_replay" },
          },
        }),
      });

      const secondCall = await mcpPost(secondCallReq);
      const secondPayload = await secondCall.json();
      expect(secondPayload).toMatchObject({
        jsonrpc: "2.0",
        id: "10",
        result: {
          content: [
            {
              type: "text",
              text: expect.stringContaining("Missing elicitation response for single_use_replay"),
            },
          ],
          isError: true,
        },
      });
    });

    it("expires an elicitation response after TTL", async () => {
      const nowSpy = vi.spyOn(Date, "now");
      const baseline = Date.now();

      try {
        nowSpy.mockReturnValue(baseline);
        const completeReq = new Request("https://example.com/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "11",
            method: "notifications/elicitation/complete",
            params: {
              elicitationId: "expiring_elicitation",
              action: { confirm: true },
            },
          }),
        });
        await mcpPost(completeReq);

        const delayed = baseline + 6 * 60 * 1000 + 1;
        nowSpy.mockReturnValue(delayed);

        mcpServerMocks.dispatchTool.mockImplementation(async (_name, _args, _inst, ctx) => {
          const response = await ctx.requestElicitation?.({
            title: "Delete workflow",
            description: "Delete workflow wf-6",
            schema: {
              type: "object",
              properties: { confirm: { type: "boolean" } },
              required: ["confirm"],
            },
          });
          return {
            output: response,
            upstream: false,
            category: "local",
            needsInstance: false,
          };
        });

        const callReq = new Request("https://example.com/mcp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "12",
            method: "tools/call",
            params: {
              name: "delete_workflow",
              clientCapabilities: { elicitation: true },
              arguments: { id: "wf-6" },
              elicitationResponse: { elicitationId: "expiring_elicitation" },
            },
          }),
        });

        const payload = await (await mcpPost(callReq)).json();
        expect(payload).toMatchObject({
          jsonrpc: "2.0",
          id: "12",
          result: {
            content: [
              {
                type: "text",
                text: expect.stringContaining(
                  "Missing elicitation response for expiring_elicitation",
                ),
              },
            ],
            isError: true,
          },
        });
      } finally {
        nowSpy.mockRestore();
      }
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
