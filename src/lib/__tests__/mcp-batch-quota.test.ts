import { beforeEach, describe, expect, it, vi } from "vitest";

const mcpMocks = vi.hoisted(() => ({
  authenticateBearer: vi.fn(),
  checkDailyQuota: vi.fn(),
  checkShortWindowQuota: vi.fn(),
  dispatchTool: vi.fn(),
  getDefaultInstance: vi.fn(),
  getMergedTools: vi.fn(),
  recordCall: vi.fn(),
}));

vi.mock("@/lib/mcp.server", () => mcpMocks);

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(() => "sentry-event"),
}));

vi.mock("@/lib/mcp-upstream.server", () => ({
  isUpstreamConfigured: vi.fn(() => false),
}));

vi.mock("@/lib/logger.server", () => ({
  getRequestId: (request: Request) => request.headers.get("x-request-id") ?? "request-1",
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

function rpc(id: number, method: string, params: Record<string, unknown> = {}) {
  return { jsonrpc: "2.0", id, method, params };
}

async function post(body: unknown) {
  const { mcpPost } = await import("@/lib/mcp-route.server");
  return mcpPost(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: {
        authorization: "Bearer nmcp_test",
        "content-type": "application/json",
        "x-request-id": "request-1",
      },
      body: JSON.stringify(body),
    }),
  );
}

describe("MCP JSON-RPC batch quota enforcement", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mcpMocks.authenticateBearer.mockResolvedValue({
      user_id: "user-1",
      key_id: "key-1",
      tier: "pro",
    });
    mcpMocks.checkShortWindowQuota.mockResolvedValue(true);
    mcpMocks.checkDailyQuota.mockResolvedValue({ ok: true, used: 0, limit: 10_000 });
    mcpMocks.getDefaultInstance.mockResolvedValue({ id: "inst-1" });
    mcpMocks.dispatchTool.mockResolvedValue({
      output: { ok: true },
      upstream: false,
      category: "local",
      needsInstance: false,
    });
    mcpMocks.recordCall.mockResolvedValue(undefined);
  });

  it("rejects JSON-RPC batches larger than the security hard limit", async () => {
    const response = await post(Array.from({ length: 11 }, (_, index) => rpc(index + 1, "ping")));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: {
        code: -32600,
        message: "Batch too large: 11 requests (max 10)",
      },
    });
    expect(mcpMocks.checkShortWindowQuota).not.toHaveBeenCalled();
    expect(mcpMocks.checkDailyQuota).not.toHaveBeenCalled();
  });

  it("enforces short-window and daily quota checks per billable batch item", async () => {
    const response = await post([
      rpc(1, "tools/call", { name: "list_workflows", arguments: {} }),
      rpc(2, "tools/call", { name: "list_workflows", arguments: {} }),
      rpc(3, "ping"),
    ]);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toHaveLength(3);
    expect(mcpMocks.checkShortWindowQuota).toHaveBeenCalledTimes(3);
    expect(mcpMocks.checkDailyQuota).toHaveBeenCalledTimes(2);
    expect(mcpMocks.dispatchTool).toHaveBeenCalledTimes(2);
  });
});
