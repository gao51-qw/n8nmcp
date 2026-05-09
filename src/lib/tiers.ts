// Shared tier definitions — safe to import on client and server.
export type Tier = "free" | "pro" | "enterprise";

export const TIER_DAILY_LIMITS: Record<Tier, number> = {
  free: 1000,
  pro: 100_000,
  enterprise: 1_000_000,
};

export const TIER_LABELS: Record<Tier, string> = {
  free: "Free",
  pro: "Pro",
  enterprise: "Enterprise",
};

export function tierLimit(tier: string | null | undefined): number {
  return TIER_DAILY_LIMITS[(tier as Tier) ?? "free"] ?? TIER_DAILY_LIMITS.free;
}
