// Shared tier definitions — safe to import on client and server.
export type Tier = "free" | "pro" | "enterprise";

export type TierLimits = {
  /** Daily MCP calls. -1 = unlimited */
  calls_day: number;
  /** Requests-per-minute hard ceiling */
  rpm: number;
  /** Feature flags unlocked at this tier */
  features: readonly Feature[];
};

export type Feature = "mcp" | "instances" | "audit-export" | "priority-support";

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    calls_day: 100,
    rpm: 50,
    features: ["mcp", "instances"],
  },
  pro: {
    calls_day: 100_000,
    rpm: 100,
    features: ["mcp", "instances", "audit-export"],
  },
  enterprise: {
    calls_day: -1,
    rpm: 1_000,
    features: ["mcp", "instances", "audit-export", "priority-support"],
  },
};

export const TIER_PRICES: Record<Tier, string> = {
  free: "$0",
  pro: "$19",
  enterprise: "Contact",
};

export const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  pro: "Pro",
  enterprise: "Enterprise",
};

export const FEATURE_LABELS: Record<Feature, string> = {
  mcp: "MCP gateway access",
  instances: "n8n instance management",
  "audit-export": "Audit log export (CSV / JSON / XLSX)",
  "priority-support": "Priority support",
};

export function tierOf(tier: string | null | undefined): Tier {
  return (tier as Tier) in TIER_LIMITS ? (tier as Tier) : "free";
}

export function tierLimits(tier: string | null | undefined): TierLimits {
  return TIER_LIMITS[tierOf(tier)];
}

// Back-compat shim for older imports
export const TIER_DAILY_LIMITS: Record<Tier, number> = {
  free: TIER_LIMITS.free.calls_day,
  pro: TIER_LIMITS.pro.calls_day,
  enterprise:
    TIER_LIMITS.enterprise.calls_day === -1 ? 1_000_000 : TIER_LIMITS.enterprise.calls_day,
};

export function tierLimit(tier: string | null | undefined): number {
  const v = TIER_LIMITS[tierOf(tier)].calls_day;
  return v === -1 ? Number.POSITIVE_INFINITY : v;
}

export function hasFeature(tier: string | null | undefined, f: Feature): boolean {
  return TIER_LIMITS[tierOf(tier)].features.includes(f);
}

/** Plans in display order (pricing page, billing page). */
export const TIER_ORDER: readonly Tier[] = ["free", "pro", "enterprise"];

export const TIER_SUMMARIES: Record<Tier, string> = {
  free: "For trying MCP client setup and low-volume workflow exploration.",
  pro: "For individuals and small teams running AI-assisted workflow operations every day.",
  enterprise:
    "For organisations that need unlimited calls, higher rate limits and priority support.",
};

/** "100 MCP calls / day", "100,000 MCP calls / day", "Unlimited MCP calls". */
export function formatDailyCalls(tier: Tier): string {
  const calls = TIER_LIMITS[tier].calls_day;
  if (calls === -1) return "Unlimited MCP calls";
  return `${calls.toLocaleString("en-US")} MCP calls / day`;
}

/** Subscription statuses under which a paid tier confers its paid limits. */
export const ACTIVE_SUBSCRIPTION_STATUSES: readonly string[] = ["active", "trialing"];

/**
 * The tier a stored subscription row actually grants: a paid tier collapses
 * to `free` unless its status is active/trialing. `effectiveTier` in
 * `src/lib/mcp.server.ts` delegates here, so the MCP gateway and client-safe
 * callers such as the billing page share one rule.
 */
export function grantedTier(
  tier: string | null | undefined,
  status: string | null | undefined,
): Tier {
  const resolved = tierOf(tier);
  if (resolved === "free") return "free";
  return ACTIVE_SUBSCRIPTION_STATUSES.includes(status ?? "") ? resolved : "free";
}

/** Billing interval shown after a paid price; must match the Paddle price. */
export const TIER_PRICE_PERIODS: Record<Tier, string | null> = {
  free: null,
  pro: "/ month",
  enterprise: null,
};
