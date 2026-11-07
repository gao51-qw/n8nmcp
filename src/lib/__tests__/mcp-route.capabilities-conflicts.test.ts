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

const observability = vi.hoisted(() => ({
  captureException: vi.fn(() => "sentry-event-1"),
  info: vi.fn(),
  warn: vi.fn(),
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

vi.mock("@sentry/nextjs", () => ({ captureException: observability.captureException }));

vi.mock("@/lib/mcp-upstream.server", () => ({
  isUpstreamConfigured: vi.fn(() => false),
}));

vi.mock("@/lib/logger.server", () => ({
  getRequestId: vi.fn(() => "request-id-1"),
  log: { info: observability.info, warn: observability.warn },
}));

import { mcpPost } from "../mcp-route.server";
import {
  PREVIEW_STALE_MESSAGE,
  ROLLBACK_CONFLICT_MESSAGE,
  WorkflowActionConflictError,
} from "../workflow-agent/action-conflict";

type ToolCtx = {
  clientCapabilities?: { elicitation?: boolean; sampling?: boolean };
  requestElicitation?: unknown;
};

function rpc(body: unknown, headers: Record<string, string> = {}) {
  return mcpPost(
    new Request("https://example.com/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

function toolCall(id: string, params: Record<string, unknown> = {}) {
  return {
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name: "delete_workflow", arguments: { id: "wf-1" }, ...params },
  };
}

/** Runs one tools/call and returns the tool context the gateway built for it. */
async function contextFor(params: Record<string, unknown>, headers?: Record<string, string>) {
  let seen: ToolCtx | undefined;
  mcpServerMocks.dispatchTool.mockImplementationOnce(async (_n, _a, _i, ctx: ToolCtx) => {
    seen = ctx;
    return { output: { ok: true }, upstream: false, category: "local", needsInstance: false };
  });
  await rpc(toolCall("ctx", params), headers);
  return seen;
}

beforeEach(() => {
  vi.clearAllMocks();
  mcpServerMocks.authenticateBearer.mockResolvedValue({ user_id: "user-1", key_id: "key-1" });
  mcpServerMocks.checkShortWindowQuota.mockResolvedValue(true);
  mcpServerMocks.reserveDailyQuota.mockResolvedValue({ ok: true, used: 0, limit: 1000 });
  mcpServerMocks.releaseDailyQuota.mockResolvedValue(undefined);
  mcpServerMocks.getDefaultInstance.mockResolvedValue({
    id: "instance-1",
    name: "Test Instance",
    base_url: "https://n8n.example.com",
    api_key: "test-key",
  });
});

describe("legacy client capability parsing", () => {
  it.each([
    ["an empty object (2025-06-18 form support)", {}],
    ["a form mode object", { form: {} }],
    ["form and url modes", { form: {}, url: {} }],
    ["an object with only unknown keys", { future: {} }],
    ["the legacy boolean true", true],
  ])("treats elicitation as %s as supported", async (_label, elicitation) => {
    const ctx = await contextFor({ clientCapabilities: { elicitation } });

    expect(ctx?.clientCapabilities?.elicitation).toBe(true);
    expect(typeof ctx?.requestElicitation).toBe("function");
  });

  it.each([
    ["false", false],
    ["a url-only object (this server only issues form elicitations)", { url: {} }],
  ])("treats elicitation as %s as unsupported", async (_label, elicitation) => {
    const ctx = await contextFor({ clientCapabilities: { elicitation } });

    expect(ctx?.clientCapabilities?.elicitation).toBe(false);
    expect(ctx?.requestElicitation).toBeUndefined();
  });

  it.each([
    ["absent", {}],
    ["null", { elicitation: null }],
    ["an array", { elicitation: [] }],
    ["a string", { elicitation: "true" }],
  ])("ignores an elicitation capability that is %s", async (_label, clientCapabilities) => {
    const ctx = await contextFor({ clientCapabilities: { sampling: {}, ...clientCapabilities } });

    expect(ctx?.clientCapabilities?.elicitation).toBeUndefined();
    expect(ctx?.requestElicitation).toBeUndefined();
  });

  it("parses sampling objects and booleans to booleans", async () => {
    expect(
      (await contextFor({ clientCapabilities: { sampling: {} } }))?.clientCapabilities,
    ).toMatchObject({ sampling: true });
    expect(
      (await contextFor({ clientCapabilities: { sampling: false } }))?.clientCapabilities,
    ).toMatchObject({ sampling: false });
  });

  it("stores object capabilities from initialize as booleans for later calls", async () => {
    const session = { "mcp-session-id": "session-object-caps" };
    const init = await rpc(
      {
        jsonrpc: "2.0",
        id: "init",
        method: "initialize",
        params: { capabilities: { elicitation: {}, sampling: {} } },
      },
      session,
    );
    expect(init.status).toBe(200);

    const ctx = await contextFor({}, session);

    expect(ctx?.clientCapabilities).toEqual({ elicitation: true, sampling: true });
    expect(typeof ctx?.requestElicitation).toBe("function");
  });

  it("lets a call declaring elicitation: false override an object stored at initialize", async () => {
    const session = { "mcp-session-id": "session-override" };
    await rpc(
      {
        jsonrpc: "2.0",
        id: "init",
        method: "initialize",
        params: { clientCapabilities: { elicitation: { form: {} } } },
      },
      session,
    );

    const ctx = await contextFor({ clientCapabilities: { elicitation: false } }, session);

    expect(ctx?.clientCapabilities?.elicitation).toBe(false);
    expect(ctx?.requestElicitation).toBeUndefined();
  });
});

describe("expected workflow-agent conflicts on tools/call", () => {
  it("returns the fixed conflict message without a Sentry event and charges like a business failure", async () => {
    mcpServerMocks.dispatchTool.mockRejectedValueOnce(
      new WorkflowActionConflictError("rollback_conflict", ROLLBACK_CONFLICT_MESSAGE),
    );

    const response = await rpc(
      toolCall("conflict", { name: "rollback_workflow", arguments: { auditLogId: "audit-1" } }),
    );
    const payload = await response.json();

    expect(observability.captureException).not.toHaveBeenCalled();
    expect(payload.result.isError).toBe(true);
    expect(JSON.parse(payload.result.content[0].text)).toEqual({
      success: false,
      code: "rollback_conflict",
      message: ROLLBACK_CONFLICT_MESSAGE,
    });
    expect(mcpServerMocks.recordCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        status: "error",
        usage: "reserved",
        error_message: ROLLBACK_CONFLICT_MESSAGE,
        tool_name: "rollback_workflow",
      }),
    );
    expect(mcpServerMocks.releaseDailyQuota).not.toHaveBeenCalled();
    expect(observability.info).toHaveBeenCalledWith(
      "mcp.gateway.request",
      expect.objectContaining({ status: "conflict", conflict_code: "rollback_conflict" }),
    );
    expect(observability.warn).not.toHaveBeenCalled();
  });

  it("still reports unexpected tool errors to Sentry", async () => {
    mcpServerMocks.dispatchTool.mockRejectedValueOnce(new Error("n8n returned 500"));

    const payload = await (await rpc(toolCall("unexpected"))).json();

    expect(observability.captureException).toHaveBeenCalledTimes(1);
    expect(payload.result.content[0].text).toContain("Sentry event ID: sentry-event-1.");
  });

  it("returns a stale preview as a typed conflict without a Sentry event", async () => {
    mcpServerMocks.dispatchTool.mockRejectedValueOnce(
      new WorkflowActionConflictError("preview_stale", PREVIEW_STALE_MESSAGE),
    );

    const payload = await (
      await rpc(
        toolCall("stale", {
          name: "update_partial_workflow",
          arguments: { workflowId: "wf-1", operations: [], sourcePreviewCallId: "p-1" },
        }),
      )
    ).json();

    expect(observability.captureException).not.toHaveBeenCalled();
    expect(observability.warn).not.toHaveBeenCalled();
    expect(payload.result.isError).toBe(true);
    expect(JSON.parse(payload.result.content[0].text)).toEqual({
      success: false,
      code: "preview_stale",
      message: PREVIEW_STALE_MESSAGE,
    });
    expect(mcpServerMocks.recordCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        status: "error",
        error_message: PREVIEW_STALE_MESSAGE,
        tool_name: "update_partial_workflow",
      }),
    );
    expect(observability.info).toHaveBeenCalledWith(
      "mcp.gateway.request",
      expect.objectContaining({ status: "conflict", conflict_code: "preview_stale" }),
    );
  });
});
