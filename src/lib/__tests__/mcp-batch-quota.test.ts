import { beforeEach, describe, expect, it, vi } from "vitest";

const mcpMocks = vi.hoisted(() => ({
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
  ...mcpMocks,
  ElicitationRequiredError: class ElicitationRequiredError extends Error {},
}));

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
    mcpMocks.reserveDailyQuota.mockResolvedValue({ ok: true, used: 0, limit: 10_000 });
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
    expect(mcpMocks.reserveDailyQuota).not.toHaveBeenCalled();
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
    expect(mcpMocks.reserveDailyQuota).toHaveBeenCalledTimes(2);
    expect(mcpMocks.dispatchTool).toHaveBeenCalledTimes(2);
  });
});

describe("MCP atomic daily quota reservation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mcpMocks.authenticateBearer.mockResolvedValue({
      user_id: "user-1",
      key_id: "key-1",
      tier: "free",
    });
    mcpMocks.checkShortWindowQuota.mockResolvedValue(true);
    mcpMocks.reserveDailyQuota.mockResolvedValue({ ok: true, used: 1, limit: 100 });
    mcpMocks.releaseDailyQuota.mockResolvedValue(undefined);
    mcpMocks.getDefaultInstance.mockResolvedValue({ id: "inst-1" });
    mcpMocks.dispatchTool.mockResolvedValue({
      output: { ok: true },
      upstream: false,
      category: "local",
      needsInstance: false,
    });
    mcpMocks.recordCall.mockResolvedValue(undefined);
  });

  it("reserves before dispatching and denies at the limit with 429 / -32004", async () => {
    mcpMocks.reserveDailyQuota.mockResolvedValue({ ok: false, used: 100, limit: 100 });

    const response = await post(rpc(1, "tools/call", { name: "list_workflows", arguments: {} }));

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({
      error: { code: -32004, message: "Daily quota exceeded (100/100)" },
    });
    expect(mcpMocks.reserveDailyQuota).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user-1", tier: "free" }),
    );
    expect(mcpMocks.dispatchTool).not.toHaveBeenCalled();
    expect(mcpMocks.releaseDailyQuota).not.toHaveBeenCalled();
    expect(mcpMocks.recordCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        status: "rate_limited",
        error_message: "daily quota exceeded (100/100)",
      }),
    );
  });

  it("does not reserve quota for non-billable methods", async () => {
    await post(rpc(1, "ping"));
    expect(mcpMocks.reserveDailyQuota).not.toHaveBeenCalled();
    expect(mcpMocks.releaseDailyQuota).not.toHaveBeenCalled();
  });

  it("charges a successful call through its reservation without a second increment", async () => {
    const response = await post(rpc(1, "tools/call", { name: "list_workflows", arguments: {} }));

    expect(response.status).toBe(200);
    expect(mcpMocks.reserveDailyQuota).toHaveBeenCalledTimes(1);
    expect(mcpMocks.releaseDailyQuota).not.toHaveBeenCalled();
    expect(mcpMocks.recordCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: "ok", usage: "reserved" }),
    );
    expect(mcpMocks.reserveDailyQuota.mock.invocationCallOrder[0]).toBeLessThan(
      mcpMocks.dispatchTool.mock.invocationCallOrder[0],
    );
  });

  it("charges ordinary tool errors", async () => {
    mcpMocks.dispatchTool.mockRejectedValue(new Error("n8n returned 500"));

    const response = await post(rpc(1, "tools/call", { name: "list_workflows", arguments: {} }));

    expect((await response.json()).result).toMatchObject({ isError: true });
    expect(mcpMocks.releaseDailyQuota).not.toHaveBeenCalled();
    expect(mcpMocks.recordCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: "error", usage: "reserved" }),
    );
  });

  it("refunds the reservation when no n8n instance is configured", async () => {
    mcpMocks.dispatchTool.mockResolvedValue({
      output: null,
      upstream: false,
      category: "management",
      needsInstance: true,
    });

    const response = await post(rpc(1, "tools/call", { name: "list_workflows", arguments: {} }));

    expect((await response.json()).error).toMatchObject({ code: -32002 });
    expect(mcpMocks.releaseDailyQuota).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(mcpMocks.recordCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: "error", usage: "none" }),
    );
  });

  it("refunds the reservation when loading the n8n instance fails", async () => {
    mcpMocks.getDefaultInstance.mockRejectedValue(new Error("database unavailable"));
    // The instance is loaded on demand by dispatchTool, through the loader.
    mcpMocks.dispatchTool.mockImplementation(
      async (_name: string, _args: unknown, loadInstance: () => Promise<unknown>) => {
        await loadInstance();
        return { output: { ok: true }, upstream: false, category: "local", needsInstance: false };
      },
    );

    await expect(
      post(rpc(1, "tools/call", { name: "list_workflows", arguments: {} })),
    ).rejects.toThrow("database unavailable");

    expect(mcpMocks.releaseDailyQuota).toHaveBeenCalledExactlyOnceWith("user-1");
    // Not a tool error: nothing is logged as a charged call.
    expect(mcpMocks.recordCall).not.toHaveBeenCalled();
  });

  it("does not load the n8n instance unless the dispatched tool asks for it", async () => {
    await post(rpc(1, "tools/call", { name: "search_nodes", arguments: { query: "http" } }));

    expect(mcpMocks.getDefaultInstance).not.toHaveBeenCalled();
    expect(mcpMocks.recordCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: "ok", instance_id: null }),
    );
  });

  it("records the instance id when the tool used the instance", async () => {
    mcpMocks.dispatchTool.mockImplementation(
      async (_name: string, _args: unknown, loadInstance: () => Promise<unknown>) => {
        await loadInstance();
        return { output: { ok: true }, upstream: false, category: "local", needsInstance: false };
      },
    );

    await post(rpc(1, "tools/call", { name: "list_workflows", arguments: {} }));

    expect(mcpMocks.getDefaultInstance).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(mcpMocks.recordCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: "ok", instance_id: "inst-1" }),
    );
  });

  it("reserves once per batch item, sequentially, and stops at the limit", async () => {
    mcpMocks.reserveDailyQuota
      .mockResolvedValueOnce({ ok: true, used: 99, limit: 100 })
      .mockResolvedValueOnce({ ok: true, used: 100, limit: 100 })
      .mockResolvedValueOnce({ ok: false, used: 100, limit: 100 });

    const response = await post([
      rpc(1, "tools/call", { name: "list_workflows", arguments: {} }),
      rpc(2, "tools/call", { name: "list_workflows", arguments: {} }),
      rpc(3, "tools/call", { name: "list_workflows", arguments: {} }),
    ]);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body[0]).toHaveProperty("result");
    expect(body[1]).toHaveProperty("result");
    expect(body[2]).toMatchObject({
      id: 3,
      error: { code: -32004, message: "Daily quota exceeded (100/100)" },
    });
    expect(mcpMocks.reserveDailyQuota).toHaveBeenCalledTimes(3);
    expect(mcpMocks.dispatchTool).toHaveBeenCalledTimes(2);
    const reserves = mcpMocks.reserveDailyQuota.mock.invocationCallOrder;
    const dispatches = mcpMocks.dispatchTool.mock.invocationCallOrder;
    // reserve 1 -> dispatch 1 -> reserve 2 -> dispatch 2 -> reserve 3
    expect(reserves[0]).toBeLessThan(dispatches[0]);
    expect(dispatches[0]).toBeLessThan(reserves[1]);
    expect(reserves[1]).toBeLessThan(dispatches[1]);
    expect(dispatches[1]).toBeLessThan(reserves[2]);
  });

  it("refunds a needs-instance batch item before reserving the next one", async () => {
    mcpMocks.dispatchTool.mockResolvedValueOnce({
      output: null,
      upstream: false,
      category: "management",
      needsInstance: true,
    });

    await post([
      rpc(1, "tools/call", { name: "list_workflows", arguments: {} }),
      rpc(2, "tools/call", { name: "list_workflows", arguments: {} }),
    ]);

    expect(mcpMocks.reserveDailyQuota).toHaveBeenCalledTimes(2);
    expect(mcpMocks.releaseDailyQuota).toHaveBeenCalledTimes(1);
    expect(mcpMocks.releaseDailyQuota.mock.invocationCallOrder[0]).toBeLessThan(
      mcpMocks.reserveDailyQuota.mock.invocationCallOrder[1],
    );
    expect(mcpMocks.recordCall.mock.calls.map(([call]) => call.usage)).toEqual([
      "none",
      "reserved",
    ]);
  });
});
