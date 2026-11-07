// Counts the Supabase round trips and secret decryptions that one MCP
// tools/call costs, end to end through mcpPost with the real mcp.server.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Call = { kind: "from" | "rpc"; name: string; ops: string[] };

const db = vi.hoisted(() => ({
  calls: [] as Call[],
  rpcResult: (_name: string): { data: unknown; error: unknown } => ({ data: null, error: null }),
}));

const cryptoMocks = vi.hoisted(() => ({
  decryptSecret: vi.fn(() => "decrypted-secret"),
  hashPlatformApiKey: vi.fn((full: string) => `hash:${full}`),
}));

const upstreamMocks = vi.hoisted(() => ({
  callUpstreamTool: vi.fn(),
}));

const n8nMocks = vi.hoisted(() => ({
  safeFetchPublicUrl: vi.fn(),
}));

function tableResult(table: string, ops: string[]): { data: unknown; error: unknown } {
  if (table === "platform_api_keys") {
    return { data: { id: "key-1", user_id: "user-1", revoked_at: null }, error: null };
  }
  if (table === "subscriptions") return { data: { tier: "pro", status: "active" }, error: null };
  if (table === "n8n_instances") {
    return {
      data: {
        id: "instance-1",
        name: "Main",
        base_url: "https://n8n.example.com",
        api_key_encrypted: "c",
        api_key_iv: "i",
        api_key_tag: "t",
        mcp_token_encrypted: "c2",
        mcp_token_iv: "i2",
        mcp_token_tag: "t2",
        mcp_capabilities: { tools: [] },
      },
      error: null,
    };
  }
  void ops;
  return { data: null, error: null };
}

function builder(table: string) {
  const ops: string[] = [];
  const settle = () => {
    db.calls.push({ kind: "from", name: table, ops: [...ops] });
    return Promise.resolve(tableResult(table, ops));
  };
  const chain: Record<string, unknown> = new Proxy(
    {},
    {
      get(_target, prop: string) {
        if (prop === "then") {
          return (resolve?: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
            settle().then(resolve, reject);
        }
        if (prop === "maybeSingle" || prop === "single") return () => settle();
        return (..._args: unknown[]) => {
          ops.push(prop);
          return chain;
        };
      },
    },
  );
  return chain;
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => builder(table),
    rpc: (name: string) => {
      db.calls.push({ kind: "rpc", name, ops: [] });
      return Promise.resolve(db.rpcResult(name));
    },
  },
}));

vi.mock("../crypto.server", () => cryptoMocks);

vi.mock("../mcp-upstream.server", () => ({
  callUpstreamTool: upstreamMocks.callUpstreamTool,
  categorize: vi.fn(() => "knowledge"),
  isManagementTool: vi.fn((name: string) => name.startsWith("n8n_")),
  isUpstreamConfigured: vi.fn(() => true),
  listUpstreamTools: vi.fn(async () => []),
}));

vi.mock("../ssrf-guard.server", () => ({ safeFetchPublicUrl: n8nMocks.safeFetchPublicUrl }));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(() => "sentry-event") }));

vi.mock("@/lib/logger.server", () => ({
  getRequestId: () => "request-1",
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

function rpcResult(name: string): { data: unknown; error: unknown } {
  switch (name) {
    case "authenticate_mcp_platform_key":
      return {
        data: [{ key_id: "key-1", user_id: "user-1", tier: "pro", status: "active" }],
        error: null,
      };
    case "check_mcp_short_window":
    case "check_mcp_rate_limit":
      return { data: true, error: null };
    case "reserve_mcp_usage":
      return { data: [{ allowed: true, used: 1, quota_limit: 100_000 }], error: null };
    default:
      return { data: null, error: null };
  }
}

async function callTool(name: string, args: Record<string, unknown>) {
  const { mcpPost } = await import("../mcp-route.server");
  const response = await mcpPost(
    new Request("https://mcp.example.test/mcp", {
      method: "POST",
      headers: { authorization: "Bearer nmcp_roundtrip", "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    }),
  );
  return response.json();
}

describe("MCP tools/call round trips", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    db.calls = [];
    db.rpcResult = rpcResult;
    upstreamMocks.callUpstreamTool.mockResolvedValue({
      content: [{ type: "text", text: "[]" }],
    });
    const { clearKnowledgeCacheForTests } = await import("../knowledge-cache.server");
    clearKnowledgeCacheForTests();
  });

  function n8nMethods(): string[] {
    return n8nMocks.safeFetchPublicUrl.mock.calls.map(([, init]) =>
      String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase(),
    );
  }

  it("serves a knowledge tool without loading or decrypting the n8n instance", async () => {
    const payload = await callTool("search_nodes", { query: `http-${Math.random()}` });

    expect(payload.result).toBeDefined();
    expect(cryptoMocks.decryptSecret).not.toHaveBeenCalled();
    expect(db.calls.map((call) => call.name)).toEqual([
      "authenticate_mcp_platform_key",
      "check_mcp_rate_limit",
      "reserve_mcp_usage",
      "mcp_call_logs",
    ]);
    expect(db.calls.some((call) => call.name === "n8n_instances")).toBe(false);
  });

  it("still loads and decrypts the instance for a tool that needs it, once", async () => {
    upstreamMocks.callUpstreamTool.mockResolvedValue({ content: [] });
    const payload = await callTool("n8n_list_workflows", {});

    expect(payload.result).toBeDefined();
    expect(db.calls.filter((call) => call.name === "n8n_instances")).toHaveLength(1);
    // API key + instance-level MCP token.
    expect(cryptoMocks.decryptSecret).toHaveBeenCalledTimes(2);
    expect(upstreamMocks.callUpstreamTool).toHaveBeenCalledWith(
      "n8n_list_workflows",
      {},
      { base_url: "https://n8n.example.com", api_key: "decrypted-secret" },
      expect.objectContaining({ user_id: "user-1" }),
    );
  });
  it("adds exactly one n8n verification read to a workflow write, and no database round trip", async () => {
    const workflow = {
      id: "wf-1",
      name: "Orders",
      versionId: "v1",
      nodes: [],
      connections: {},
      settings: {},
    };
    n8nMocks.safeFetchPublicUrl.mockImplementation(async (_url: string, init?: RequestInit) => {
      const body =
        init?.method === "PUT" ? { ...workflow, name: "Renamed", versionId: "v2" } : workflow;
      return { ok: true, status: 200, text: async () => JSON.stringify(body) };
    });

    const payload = await callTool("update_workflow", {
      id: "wf-1",
      name: "Renamed",
      confirm: true,
    });

    expect(payload.result).toBeDefined();
    // Audit before-snapshot read, the tool's own read, the PUT, then one
    // post-write verification read (the only call this check adds).
    expect(n8nMethods()).toEqual(["GET", "GET", "PUT", "GET"]);
    expect(db.calls.map((call) => call.name)).toEqual([
      "authenticate_mcp_platform_key",
      "check_mcp_rate_limit",
      "reserve_mcp_usage",
      "n8n_instances",
      "workflow_audit_log",
      "mcp_call_logs",
    ]);
  });
});
