// Per-tier MCP request rate limits (shared by the gateway and the dashboard
// agent console). Pure policy: enforcement lives in checkShortWindowQuota()
// in mcp.server.ts and the check_mcp_rate_limit database function.
//
// Two fixed windows are checked together and counted only when both allow:
// - the tier's requests-per-minute (TIER_LIMITS[tier].rpm) over 60 seconds;
// - a 10-second burst guard, so a client cannot spend the whole minute's
//   budget in one instant. The guard is never below the legacy 60 / 10s
//   (unless rpm itself is lower) and is at least a third of rpm, so the full
//   rpm stays reachable for high tiers.
import { TIER_LIMITS, type Tier } from "./tiers";

export const RATE_WINDOW_SECONDS = 60;
export const BURST_WINDOW_SECONDS = 10;
/** The burst cap every caller had before limits became tier-aware. */
export const LEGACY_BURST_MAX = 60;

export type RateLimit = {
  tier: Tier;
  /** Requests allowed per RATE_WINDOW_SECONDS. */
  rpm: number;
  /** Requests allowed per BURST_WINDOW_SECONDS. */
  burst: number;
};

function knownTier(tier: string | null | undefined): Tier {
  return tier && Object.prototype.hasOwnProperty.call(TIER_LIMITS, tier) ? (tier as Tier) : "free";
}

export function rateLimitFor(tier: string | null | undefined): RateLimit {
  const resolved = knownTier(tier);
  const rpm = Math.max(1, Math.floor(TIER_LIMITS[resolved].rpm));
  const burst = Math.min(rpm, Math.max(LEGACY_BURST_MAX, Math.ceil(rpm / 3)));
  return { tier: resolved, rpm, burst };
}

/** Client-facing message for JSON-RPC -32003 (HTTP 429). */
export function rateLimitMessage(tier: string | null | undefined): string {
  const { tier: resolved, rpm, burst } = rateLimitFor(tier);
  return `Rate limit exceeded (${resolved} tier: ${rpm} req / 60s, burst ${burst} req / 10s)`;
}

/** Short reason stored in mcp_call_logs.error_message for a throttled call. */
export function rateLimitLogReason(tier: string | null | undefined): string {
  const { tier: resolved, rpm, burst } = rateLimitFor(tier);
  return `rate limit (${resolved}: ${rpm}/60s, ${burst}/10s)`;
}
