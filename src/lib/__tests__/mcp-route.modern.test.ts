import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("@/lib/mcp-upstream.server", () => ({ isUpstreamConfigured: vi.fn(() => false) }));

vi.mock("@/lib/logger.server", () => ({
  getRequestId: vi.fn(() => "request-id-1"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { mcpPost } from "../mcp-route.server";
import { resetRequestStateKeyForTests } from "../mcp-request-state.server";

const VERSION = "2026-07-28";
const SERVER_INFO_KEY = "io.modelcontextprotocol/serverInfo";

type Caps = Record<string, unknown>;

function modernRequest(
  method: string,
  params: Record<string, unknown> = {},
  options: {
    id?: string | number | null;
    caps?: Caps;
    headers?: Record<string, string | null>;
  } = {},
) {
  const name = typeof params.name === "string" ? params.name : undefined;
  const headers: Record<string, string | null> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": VERSION,
    "Mcp-Method": method,
    ...(name ? { "Mcp-Name": name } : {}),
    ...options.headers,
  };
  const init = new Headers();
  for (const [k, v] of Object.entries(headers)) if (v !== null) init.set(k, v);
  const message: Record<string, unknown> = {
    jsonrpc: "2.0",
    method,
    params: {
      ...params,
      _meta: {
        "io.modelcontextprotocol/protocolVersion": VERSION,
        "io.modelcontextprotocol/clientInfo": { name: "TestClient", version: "1.0.0" },
        "io.modelcontextprotocol/clientCapabilities": options.caps ?? {},
      },
    },
  };
  if (options.id !== null) message.id = options.id ?? `req-${method}`;
  return new Request("https://example.com/mcp", {
    method: "POST",
    headers: init,
    body: JSON.stringify(message),
  });
}

async function send(request: Request) {
  const response = await mcpPost(request);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const elicitCaps = { elicitation: {} };

/** Tool mock that asks to confirm deleting args.id and echoes the answer. */
function confirmingTool() {
  mcpServerMocks.dispatchTool.mockImplementation(async (_name, args, _inst, ctx) => {
    const answer = await ctx.requestElicitation?.({
      title: "Delete workflow",
      description: `Delete workflow ${String(args.id)}`,
      schema: {
        type: "object",
        properties: { confirm: { type: "boolean" } },
        required: ["confirm"],
      },
    });
    return {
      output: { confirmed: answer?.confirm === true, answer: answer ?? null },
      upstream: false,
      category: "local",
      needsInstance: false,
    };
  });
}

function callDelete(
  id: string,
  workflowId: string,
  extra: Record<string, unknown> = {},
  caps: Caps = elicitCaps,
) {
  return send(
    modernRequest(
      "tools/call",
      { name: "delete_workflow", arguments: { id: workflowId }, ...extra },
      { id, caps },
    ),
  );
}

function toolOutput(body: { result: { content: Array<{ text: string }> } }) {
  return JSON.parse(body.result.content[0].text);
}

beforeAll(() => {
  vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  resetRequestStateKeyForTests();
});

afterAll(() => {
  vi.unstubAllEnvs();
  resetRequestStateKeyForTests();
});

beforeEach(() => {
  vi.clearAllMocks();
  mcpServerMocks.authenticateBearer.mockResolvedValue({ user_id: "user-1", key_id: "key-1" });
  mcpServerMocks.checkShortWindowQuota.mockResolvedValue(true);
  mcpServerMocks.checkDailyQuota.mockResolvedValue({ ok: true, used: 0, limit: 1000 });
  mcpServerMocks.getDefaultInstance.mockResolvedValue({ id: "instance-1" });
  mcpServerMocks.getMergedTools.mockResolvedValue([
    { name: "a_tool", inputSchema: { type: "object" } },
  ]);
});

describe("MCP 2026-07-28 requests", () => {
  it("answers server/discover with versions, capabilities and server identity", async () => {
    const { status, body } = await send(modernRequest("server/discover"));
    expect(status).toBe(200);
    expect(body.result).toMatchObject({
      resultType: "complete",
      supportedVersions: [VERSION],
      capabilities: { tools: {} },
      ttlMs: expect.any(Number),
      cacheScope: "private",
      _meta: { [SERVER_INFO_KEY]: { name: "n8n-mcp-gateway" } },
    });
  });

  it("returns a cacheable tools/list with resultType", async () => {
    const { body } = await send(modernRequest("tools/list"));
    expect(body.result).toMatchObject({
      resultType: "complete",
      tools: [{ name: "a_tool" }],
      ttlMs: 300_000,
      cacheScope: "private",
      _meta: { [SERVER_INFO_KEY]: expect.any(Object) },
    });
  });

  it.each(["initialize", "ping", "logging/setLevel", "notifications/elicitation/complete"])(
    "does not serve the removed method %s",
    async (method) => {
      const { status, body } = await send(modernRequest(method));
      expect(status).toBe(404);
      expect(body.error).toMatchObject({ code: -32601 });
    },
  );

  it("rejects a header that does not match the body with 400 HeaderMismatch", async () => {
    const { status, body } = await send(
      modernRequest("tools/list", {}, { headers: { "Mcp-Method": "tools/call" } }),
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32020);
  });

  it("rejects an unsupported version with the supported list", async () => {
    const request = modernRequest(
      "tools/list",
      {},
      { headers: { "MCP-Protocol-Version": "2099-01-01" } },
    );
    const raw = JSON.parse(await request.clone().text());
    raw.params._meta["io.modelcontextprotocol/protocolVersion"] = "2099-01-01";
    const { status, body } = await send(
      new Request(request.url, {
        method: "POST",
        headers: request.headers,
        body: JSON.stringify(raw),
      }),
    );
    expect(status).toBe(400);
    expect(body.error).toMatchObject({
      code: -32022,
      data: { supported: [VERSION], requested: "2099-01-01" },
    });
  });

  it("refuses JSON-RPC batches from modern clients", async () => {
    const one = JSON.parse(await modernRequest("tools/list").text());
    const { status, body } = await send(
      new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json", "MCP-Protocol-Version": VERSION },
        body: JSON.stringify([one, { ...one, id: "two" }]),
      }),
    );
    expect(status).toBe(400);
    expect(body.error.code).toBe(-32600);
  });

  it("accepts notifications with 202 and no body", async () => {
    const { status, body } = await send(modernRequest("notifications/progress", {}, { id: null }));
    expect(status).toBe(202);
    expect(body).toBeNull();
  });

  it("returns 429 when throttled", async () => {
    mcpServerMocks.checkShortWindowQuota.mockResolvedValue(false);
    const { status, body } = await send(modernRequest("tools/list"));
    expect(status).toBe(429);
    expect(body.error.code).toBe(-32003);
  });

  it("reports a missing n8n instance as a tool error instead of -32002", async () => {
    mcpServerMocks.dispatchTool.mockResolvedValue({
      output: null,
      upstream: false,
      category: "management",
      needsInstance: true,
    });
    const { status, body } = await callDelete("no-inst", "wf-1");
    expect(status).toBe(200);
    expect(body.error).toBeUndefined();
    expect(body.result).toMatchObject({ resultType: "complete", isError: true });
  });

  it("does not offer elicitation to a client that did not declare it", async () => {
    mcpServerMocks.dispatchTool.mockResolvedValue({
      output: { ok: true },
      upstream: false,
      category: "local",
      needsInstance: false,
    });
    await callDelete("no-caps", "wf-1", {}, {});
    const ctx = mcpServerMocks.dispatchTool.mock.calls[0][3];
    expect(ctx.requestElicitation).toBeUndefined();
    expect(ctx.clientCapabilities).toEqual({ elicitation: false });
  });
});

describe("MCP 2026-07-28 multi round-trip confirmation", () => {
  async function firstRound(workflowId: string) {
    confirmingTool();
    const { status, body } = await callDelete(`first-${workflowId}`, workflowId);
    expect(status).toBe(200);
    return body.result as {
      resultType: string;
      inputRequests: Record<string, { method: string; params: Record<string, unknown> }>;
      requestState: string;
    };
  }

  it("asks for confirmation with an InputRequiredResult", async () => {
    const result = await firstRound("wf-1");
    expect(result).toMatchObject({
      resultType: "input_required",
      inputRequests: {
        confirm: {
          method: "elicitation/create",
          params: {
            mode: "form",
            message: expect.stringContaining("Delete workflow wf-1"),
            requestedSchema: { type: "object", required: ["confirm"] },
          },
        },
      },
      requestState: expect.any(String),
    });
  });

  it("completes the call when the retry carries an accepted answer", async () => {
    const { requestState } = await firstRound("wf-1");
    const { body } = await callDelete("retry-1", "wf-1", {
      requestState,
      inputResponses: { confirm: { action: "accept", content: { confirm: true } } },
    });
    expect(body.result.resultType).toBe("complete");
    expect(toolOutput(body)).toEqual({ confirmed: true, answer: { confirm: true } });
  });

  it.each(["decline", "cancel"])("fails closed when the user chooses %s", async (action) => {
    const { requestState } = await firstRound(`wf-${action}`);
    const { body } = await callDelete(`retry-${action}`, `wf-${action}`, {
      requestState,
      inputResponses: { confirm: { action } },
    });
    expect(toolOutput(body)).toEqual({ confirmed: false, answer: {} });
  });

  it("asks again when the retry has the state but no answer", async () => {
    const { requestState } = await firstRound("wf-1");
    const { body } = await callDelete("retry-empty", "wf-1", { requestState });
    expect(body.result.resultType).toBe("input_required");
  });

  it("ignores an answer that comes without a requestState", async () => {
    confirmingTool();
    const { body } = await callDelete("no-state", "wf-1", {
      inputResponses: { confirm: { action: "accept", content: { confirm: true } } },
    });
    expect(body.result.resultType).toBe("input_required");
  });

  it("does not let a state for one workflow confirm another", async () => {
    const { requestState } = await firstRound("wf-a");
    const { body } = await callDelete("cross", "wf-b", {
      requestState,
      inputResponses: { confirm: { action: "accept", content: { confirm: true } } },
    });
    expect(body.error).toMatchObject({ code: -32602 });
    expect(body.error.message).toContain("different request");
    expect(mcpServerMocks.dispatchTool).toHaveBeenCalledTimes(1);
  });

  it("does not accept a state issued to another user", async () => {
    const { requestState } = await firstRound("wf-1");
    mcpServerMocks.authenticateBearer.mockResolvedValueOnce({ user_id: "user-2", key_id: "k2" });
    const { body } = await callDelete("other-user", "wf-1", {
      requestState,
      inputResponses: { confirm: { action: "accept", content: { confirm: true } } },
    });
    expect(body.error.message).toContain("different user");
  });

  it("rejects a tampered requestState", async () => {
    const { requestState } = await firstRound("wf-1");
    const { body } = await callDelete("tampered", "wf-1", {
      requestState: `${requestState}x`,
      inputResponses: { confirm: { action: "accept", content: { confirm: true } } },
    });
    expect(body.error).toMatchObject({ code: -32602 });
  });

  it("redeems an accepted state only once", async () => {
    const { requestState } = await firstRound("wf-once");
    const retry = {
      requestState,
      inputResponses: { confirm: { action: "accept", content: { confirm: true } } },
    };
    const first = await callDelete("once-1", "wf-once", retry);
    expect(toolOutput(first.body).confirmed).toBe(true);

    const second = await callDelete("once-2", "wf-once", retry);
    expect(second.body.error.message).toContain("already been used");
  });
});

describe("legacy clients on the same endpoint", () => {
  it("still complete the initialize handshake", async () => {
    const { status, body } = await send(
      new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
      }),
    );
    expect(status).toBe(200);
    expect(body.result).toMatchObject({
      protocolVersion: "2025-06-18",
      serverInfo: { name: "n8n-mcp-gateway" },
    });
  });

  it("cannot call server/discover without modern _meta", async () => {
    const { body } = await send(
      new Request("https://example.com/mcp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "server/discover" }),
      }),
    );
    expect(body.error.code).toBe(-32601);
  });
});
