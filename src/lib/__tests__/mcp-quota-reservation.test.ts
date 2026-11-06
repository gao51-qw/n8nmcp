import { beforeEach, describe, expect, it, vi } from "vitest";

import { TIER_DAILY_LIMITS } from "../tiers";

const rpcMock = vi.fn();
const insertMock = vi.fn();
const fromMock = vi.fn(() => ({
  insert: insertMock,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: rpcMock,
    from: fromMock,
  },
}));

const CALL = {
  user_id: "user-1",
  tool_name: "list_workflows",
  status: "ok" as const,
  latency_ms: 5,
};

describe("atomic daily MCP quota reservation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    insertMock.mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ insert: insertMock });
    rpcMock.mockResolvedValue({ data: null, error: null });
  });

  it("reserves one unit against the tier limit in a single RPC", async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ allowed: true, used: 7, quota_limit: TIER_DAILY_LIMITS.pro }],
      error: null,
    });
    const { reserveDailyQuota } = await import("../mcp.server");

    const result = await reserveDailyQuota({ user_id: "user-1", tier: "pro" });

    expect(rpcMock).toHaveBeenCalledExactlyOnceWith("reserve_mcp_usage", {
      _user_id: "user-1",
      _limit: TIER_DAILY_LIMITS.pro,
      _n: 1,
    });
    expect(result).toEqual({ ok: true, used: 7, limit: TIER_DAILY_LIMITS.pro });
  });

  it("denies the reservation at the limit and reports the unchanged counter", async () => {
    const limit = TIER_DAILY_LIMITS.free;
    rpcMock.mockResolvedValueOnce({
      data: [{ allowed: false, used: limit, quota_limit: limit }],
      error: null,
    });
    const { reserveDailyQuota } = await import("../mcp.server");

    await expect(reserveDailyQuota({ user_id: "user-1", tier: "free" })).resolves.toEqual({
      ok: false,
      used: limit,
      limit,
    });
  });

  it("fails closed when the reservation RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "missing rpc" } });
    const { reserveDailyQuota } = await import("../mcp.server");

    const result = await reserveDailyQuota({ user_id: "user-1", tier: "free" });

    expect(result.ok).toBe(false);
    expect(result.used).toBe(result.limit);
  });

  it("fails closed when the reservation RPC returns no row", async () => {
    rpcMock.mockResolvedValueOnce({ data: [], error: null });
    const { reserveDailyQuota } = await import("../mcp.server");

    await expect(reserveDailyQuota({ user_id: "user-1", tier: "free" })).resolves.toMatchObject({
      ok: false,
    });
  });

  it("refunds through release_mcp_usage", async () => {
    const { releaseDailyQuota } = await import("../mcp.server");

    await releaseDailyQuota("user-1");

    expect(rpcMock).toHaveBeenCalledExactlyOnceWith("release_mcp_usage", {
      _user_id: "user-1",
      _n: 1,
    });
  });

  it("never throws when a refund fails", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { releaseDailyQuota } = await import("../mcp.server");

    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    await expect(releaseDailyQuota("user-1")).resolves.toBeUndefined();
    rpcMock.mockRejectedValueOnce(new Error("network"));
    await expect(releaseDailyQuota("user-1")).resolves.toBeUndefined();

    consoleError.mockRestore();
  });

  it("does not increment usage again for a reserved call", async () => {
    const { recordCall } = await import("../mcp.server");

    await recordCall({ ...CALL, usage: "reserved" });

    expect(insertMock).toHaveBeenCalledOnce();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("does not increment usage for a non-billable call", async () => {
    const { recordCall } = await import("../mcp.server");

    await recordCall({ ...CALL, status: "error", usage: "none" });

    expect(insertMock).toHaveBeenCalledOnce();
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("keeps incrementing usage for callers that did not reserve", async () => {
    const { recordCall } = await import("../mcp.server");

    await recordCall(CALL);

    expect(rpcMock).toHaveBeenCalledExactlyOnceWith("increment_mcp_usage", {
      _user_id: "user-1",
      _n: 1,
    });
  });
});
