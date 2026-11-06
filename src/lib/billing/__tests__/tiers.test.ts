import { describe, expect, it } from "vitest";
import {
  formatDailyCalls,
  grantedTier,
  TIER_DAILY_LIMITS,
  TIER_LIMITS,
  TIER_ORDER,
} from "@/lib/tiers";

describe("tier helpers", () => {
  it("formats daily quotas from TIER_LIMITS", () => {
    expect(formatDailyCalls("free")).toBe("100 MCP calls / day");
    expect(formatDailyCalls("pro")).toBe("100,000 MCP calls / day");
    expect(formatDailyCalls("enterprise")).toBe("Unlimited MCP calls");
    expect(TIER_ORDER).toEqual(["free", "pro", "enterprise"]);
  });

  it("grants paid tiers only while the subscription is active or trialing", () => {
    expect(grantedTier("pro", "active")).toBe("pro");
    expect(grantedTier("enterprise", "trialing")).toBe("enterprise");
    expect(grantedTier("pro", "past_due")).toBe("free");
    expect(grantedTier("pro", "canceled")).toBe("free");
    expect(grantedTier("pro", null)).toBe("free");
    expect(grantedTier("bogus", "active")).toBe("free");
    expect(grantedTier(null, null)).toBe("free");
  });

  it("leaves the existing quota exports unchanged", () => {
    expect(TIER_DAILY_LIMITS).toEqual({ free: 100, pro: 100_000, enterprise: 1_000_000 });
    expect(TIER_LIMITS.enterprise.calls_day).toBe(-1);
  });
});
