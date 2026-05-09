// Shared tier definitions — safe to import on client and server.
export type Tier = "free" | "pro" | "enterprise";

export type TierLimits = {
  /** Daily prompts to the Chat Agent. -1 = unlimited */
  prompts_day: number;
  /** Daily MCP calls. -1 = unlimited */
  calls_day: number;
  /** Requests-per-minute hard ceiling */
  rpm: number;
  /** Feature flags unlocked at this tier */
  features: readonly Feature[];
};

export type Feature = "mcp" | "instances" | "chat-agent" | "audit-export" | "priority-support";

export const TIER_LIMITS: Record<Tier, TierLimits> = {
  free: {
    prompts_day: 5,
    calls_day: 100,
    rpm: 50,
    features: ["mcp", "instances"],
  },
  pro: {
    prompts_day: 200,
    calls_day: 100_000,
    rpm: 100,
    features: ["mcp", "instances", "chat-agent", "audit-export"],
  },
  enterprise: {
    prompts_day: -1,
    calls_day: -1,
    rpm: 1_000,
    features: ["mcp", "instances", "chat-agent", "audit-export", "priority-support"],
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
  "chat-agent": "AI Chat Agent (n8n workflow generator)",
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
  enterprise: TIER_LIMITS.enterprise.calls_day === -1 ? 1_000_000 : TIER_LIMITS.enterprise.calls_day,
};

export function tierLimit(tier: string | null | undefined): number {
  const v = TIER_LIMITS[tierOf(tier)].calls_day;
  return v === -1 ? Number.POSITIVE_INFINITY : v;
}

export function hasFeature(tier: string | null | undefined, f: Feature): boolean {
  return TIER_LIMITS[tierOf(tier)].features.includes(f);
}
