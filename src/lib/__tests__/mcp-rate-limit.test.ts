import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimitFor, rateLimitMessage } from "../mcp-rate-limit";
import { TIER_LIMITS } from "../tiers";

const db = vi.hoisted(() => ({
  rpc: vi.fn(),
  subscription: { tier: "pro", status: "active" } as unknown,
  fromCalls: [] as string[],
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: db.rpc,
    from: (table: string) => {
      db.fromCalls.push(table);
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({ data: db.subscription, error: null }),
      };
      return chain;
    },
  },
}));

vi.mock("../mcp-upstream.server", () => ({
  callUpstreamTool: vi.fn(),
  categorize: vi.fn(),
  isManagementTool: vi.fn(() => false),
  isUpstreamConfigured: vi.fn(() => false),
  listUpstreamTools: vi.fn(async () => []),
}));

import { checkShortWindowQuota, shortWindowAllow } from "../mcp.server";

beforeEach(() => {
  db.rpc.mockReset();
  db.fromCalls = [];
  db.subscription = { tier: "pro", status: "active" };
  delete process.env.MCP_SHORT_WINDOW_LIMITER;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("rateLimitFor", () => {
  it("enforces each tier's declared rpm with a burst guard", () => {
    expect(rateLimitFor("free")).toEqual({ tier: "free", rpm: 50, burst: 50 });
    expect(rateLimitFor("pro")).toEqual({ tier: "pro", rpm: 100, burst: 60 });
    expect(rateLimitFor("enterprise")).toEqual({ tier: "enterprise", rpm: 1000, burst: 334 });
  });

  it("always derives rpm from TIER_LIMITS and keeps the full rpm reachable", () => {
    for (const tier of Object.keys(TIER_LIMITS) as Array<keyof typeof TIER_LIMITS>) {
      const { rpm, burst } = rateLimitFor(tier);
      expect(rpm).toBe(TIER_LIMITS[tier].rpm);
      expect(burst).toBeLessThanOrEqual(rpm);
      // Six 10s windows per minute must be able to carry the per-minute budget.
      expect(burst * 6).toBeGreaterThanOrEqual(rpm);
    }
  });

  it("treats unknown or missing tiers as free", () => {
    expect(rateLimitFor(undefined).tier).toBe("free");
    expect(rateLimitFor("platinum").tier).toBe("free");
    expect(rateLimitFor("__proto__").tier).toBe("free");
  });

  it("names the limits in the client message", () => {
    expect(rateLimitMessage("pro")).toBe(
      "Rate limit exceeded (pro tier: 100 req / 60s, burst 60 req / 10s)",
    );
  });
});

describe("shortWindowAllow (memory limiter)", () => {
  it("keeps the legacy 60 / 10s when no tier is given", () => {
    const user = `legacy-${Math.random()}`;
    let allowed = 0;
    for (let i = 0; i < 70; i++) if (shortWindowAllow(user)) allowed++;
    expect(allowed).toBe(60);
  });

  it("enforces the per-minute limit across burst windows", () => {
    const nowSpy = vi.spyOn(Date, "now");
    const user = `pro-${Math.random()}`;
    let now = 1_000_000;
    nowSpy.mockImplementation(() => now);

    let allowed = 0;
    // Six 10-second windows, 60 attempts each: the burst allows 60 per window
    // but the minute allows only 100 in total.
    for (let window = 0; window < 6; window++) {
      for (let i = 0; i < 60; i++) if (shortWindowAllow(user, "pro")) allowed++;
      now += 10_001;
    }
    expect(allowed).toBe(100);
  });

  it("enforces the burst window inside a minute", () => {
    const user = `burst-${Math.random()}`;
    let allowed = 0;
    for (let i = 0; i < 100; i++) if (shortWindowAllow(user, "pro")) allowed++;
    expect(allowed).toBe(60);
  });

  it("does not count a denied request in any window", () => {
    const nowSpy = vi.spyOn(Date, "now");
    const user = `denied-${Math.random()}`;
    let now = 2_000_000;
    nowSpy.mockImplementation(() => now);
    for (let i = 0; i < 70; i++) shortWindowAllow(user, "pro"); // 60 allowed, 10 denied
    now += 10_001; // next burst window, same minute: 40 left
    let allowed = 0;
    for (let i = 0; i < 70; i++) if (shortWindowAllow(user, "pro")) allowed++;
    expect(allowed).toBe(40);
  });
});

describe("checkShortWindowQuota (database limiter)", () => {
  it("checks the tier's minute and burst windows in one RPC", async () => {
    db.rpc.mockResolvedValue({ data: true, error: null });
    await expect(checkShortWindowQuota("user-1", "enterprise")).resolves.toBe(true);
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("check_mcp_rate_limit", {
      _user_id: "user-1",
      _burst_window_seconds: 10,
      _burst_max: 334,
      _window_seconds: 60,
      _max_requests: 1000,
    });
    expect(db.fromCalls).toEqual([]);
  });

  it("returns false when the limiter denies", async () => {
    db.rpc.mockResolvedValue({ data: false, error: null });
    await expect(checkShortWindowQuota("user-1", "free")).resolves.toBe(false);
  });

  it("looks the tier up when the caller does not pass one (old signature)", async () => {
    db.subscription = { tier: "pro", status: "past_due" };
    db.rpc.mockResolvedValue({ data: true, error: null });
    await expect(checkShortWindowQuota("user-1")).resolves.toBe(true);
    expect(db.fromCalls).toEqual(["subscriptions"]);
    // past_due collapses to free.
    expect(db.rpc).toHaveBeenCalledWith(
      "check_mcp_rate_limit",
      expect.objectContaining({ _burst_max: 50, _max_requests: 50 }),
    );
  });

  it("falls back to the burst-only limiter while the migration is missing", async () => {
    db.rpc
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "not found" } })
      .mockResolvedValueOnce({ data: true, error: null });
    await expect(checkShortWindowQuota("user-1", "pro")).resolves.toBe(true);
    expect(db.rpc).toHaveBeenLastCalledWith("check_mcp_short_window", {
      _user_id: "user-1",
      _window_seconds: 10,
      _max_requests: 60,
    });
  });

  it("fails closed when the fallback limiter errors too", async () => {
    db.rpc
      .mockResolvedValueOnce({ data: null, error: { code: "PGRST202", message: "not found" } })
      .mockResolvedValueOnce({ data: null, error: { message: "down" } });
    await expect(checkShortWindowQuota("user-1", "pro")).resolves.toBe(false);
  });

  it("uses the memory limiter only behind the explicit flag", async () => {
    process.env.MCP_SHORT_WINDOW_LIMITER = "memory";
    await expect(checkShortWindowQuota(`mem-${Math.random()}`, "free")).resolves.toBe(true);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
