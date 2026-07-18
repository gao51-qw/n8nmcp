import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("../ssrf-guard.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../ssrf-guard.server")>();
  return {
    ...actual,
    assertPublicUrl: vi.fn().mockResolvedValue(undefined),
  };
});

describe("security regression fixes", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    insertMock.mockResolvedValue({ error: null });
    fromMock.mockReturnValue({ insert: insertMock });
    delete process.env.MCP_SHORT_WINDOW_LIMITER;
  });

  it("protected outbound fetches disable automatic redirects", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue({
      status: 200,
      headers: new Headers(),
    } as Response);
    vi.stubGlobal("fetch", fetchMock);

    const { safeFetchPublicUrl } = await import("../ssrf-guard.server");
    await safeFetchPublicUrl("https://93.184.216.34/api", { method: "POST" });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://93.184.216.34/api",
      expect.objectContaining({ method: "POST", redirect: "manual" }),
    );

    vi.unstubAllGlobals();
  });

  it("rejects protected outbound redirects instead of following them", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>().mockResolvedValue({
        status: 302,
        headers: new Headers({ location: "http://169.254.169.254/latest/meta-data/" }),
      } as Response),
    );

    const { safeFetchPublicUrl } = await import("../ssrf-guard.server");

    await expect(safeFetchPublicUrl("https://93.184.216.34/api")).rejects.toThrow(
      "Redirects are not allowed",
    );

    vi.unstubAllGlobals();
  });

  it("fails daily MCP quota closed when the Supabase usage RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "missing rpc" } });
    const { checkDailyQuota } = await import("../mcp.server");

    const result = await checkDailyQuota({ user_id: "user-1", key_id: "key-1", tier: "free" });

    expect(result.ok).toBe(false);
    expect(result.used).toBe(result.limit);
  });

  it("fails short-window quota closed when the shared limiter RPC errors", async () => {
    rpcMock.mockResolvedValueOnce({ data: null, error: { message: "limiter unavailable" } });
    const { checkShortWindowQuota } = await import("../mcp.server");

    await expect(checkShortWindowQuota("user-1")).resolves.toBe(false);
  });

  it("does not increment billable usage for rate-limited calls", async () => {
    const { recordCall } = await import("../mcp.server");

    await recordCall({
      user_id: "user-1",
      tool_name: null,
      status: "rate_limited",
      latency_ms: 0,
      error_message: "short-window throttle",
    });

    expect(insertMock).toHaveBeenCalledOnce();
    expect(rpcMock).not.toHaveBeenCalledWith("increment_mcp_usage", expect.anything());
  });

  it("keeps memory short-window limiter behind the explicit local fallback flag", async () => {
    process.env.MCP_SHORT_WINDOW_LIMITER = "memory";
    const { checkShortWindowQuota } = await import("../mcp.server");

    await expect(checkShortWindowQuota(`user-${Math.random()}`)).resolves.toBe(true);
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("collapses paid tiers to free unless the subscription is active/trialing", async () => {
    const { effectiveTier } = await import("../mcp.server");

    // Good standing keeps the paid tier.
    expect(effectiveTier("pro", "active")).toBe("pro");
    expect(effectiveTier("enterprise", "trialing")).toBe("enterprise");

    // Delinquent / inactive statuses must not retain paid quota.
    expect(effectiveTier("pro", "past_due")).toBe("free");
    expect(effectiveTier("pro", "canceled")).toBe("free");
    expect(effectiveTier("pro", "paused")).toBe("free");
    expect(effectiveTier("pro", null)).toBe("free");

    // Free stays free regardless of status.
    expect(effectiveTier("free", "active")).toBe("free");
    expect(effectiveTier(null, "active")).toBe("free");
  });
});
