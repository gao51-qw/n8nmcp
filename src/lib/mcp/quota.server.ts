// MCP rate limiting, daily quota and call logging (server-only).
// Rate limit: database-backed short-window limiter + daily quota check via usage_daily.
import { pruneExpired } from "@/lib/expiring-store";
import {
  BURST_WINDOW_SECONDS,
  LEGACY_BURST_MAX,
  RATE_WINDOW_SECONDS,
  rateLimitFor,
} from "@/lib/mcp-rate-limit";
import type { Json } from "@/integrations/supabase/types";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TIER_DAILY_LIMITS, type Tier } from "@/lib/tiers";
import { tierForUser } from "./auth.server";
import { isMissingFunction } from "./postgrest";
import type { AuthedKey } from "./types";

// Opt-in in-memory rate limiter (MCP_SHORT_WINDOW_LIMITER=memory), per process.
// Keyed by `${userId}:${windowSeconds}`; the database limiter is the default.
const buckets = new Map<string, { count: number; resetAt: number }>();
const BUCKET_SWEEP_INTERVAL_MS = 60_000;
let lastBucketSweep = 0;

type RateWindow = { seconds: number; max: number };

/** The windows enforced for a tier: burst first, then the per-minute limit. */
function rateWindowsFor(tier: Tier): RateWindow[] {
  const { rpm, burst } = rateLimitFor(tier);
  return [
    { seconds: BURST_WINDOW_SECONDS, max: burst },
    { seconds: RATE_WINDOW_SECONDS, max: rpm },
  ];
}

/**
 * In-memory limiter. Every window must allow the request; it is then counted
 * in all of them. Without a tier only the legacy 60 req / 10s burst applies.
 */
export function shortWindowAllow(userId: string, tier?: Tier): boolean {
  const now = Date.now();
  if (now - lastBucketSweep >= BUCKET_SWEEP_INTERVAL_MS) {
    lastBucketSweep = now;
    pruneExpired(buckets, (bucket) => bucket.resetAt, now);
  }
  const windows = tier
    ? rateWindowsFor(tier)
    : [{ seconds: BURST_WINDOW_SECONDS, max: LEGACY_BURST_MAX }];
  const states = windows.map((window) => {
    const key = `${userId}:${window.seconds}`;
    const bucket = buckets.get(key);
    return { key, window, bucket: bucket && bucket.resetAt > now ? bucket : null };
  });
  if (states.some(({ window, bucket }) => bucket && bucket.count >= window.max)) return false;
  for (const { key, window, bucket } of states) {
    if (bucket) bucket.count++;
    else buckets.set(key, { count: 1, resetAt: now + window.seconds * 1000 });
  }
  return true;
}

let warnedMemoryLimiter = false;
let warnedMissingRateLimitRpc = false;

/**
 * Tier-aware request rate limit: the tier's rpm over 60s plus a 10s burst
 * guard (see mcp-rate-limit.ts), checked and counted atomically by the
 * check_mcp_rate_limit database function. Fails closed when the database
 * errors. Callers that do not know the tier (e.g. the dashboard agent
 * console) get it looked up.
 */
export async function checkShortWindowQuota(userId: string, tier?: Tier): Promise<boolean> {
  if (process.env.MCP_SHORT_WINDOW_LIMITER === "memory") {
    if (process.env.NODE_ENV === "production" && !warnedMemoryLimiter) {
      warnedMemoryLimiter = true;
      console.warn(
        "[mcp.rate_limit] MCP_SHORT_WINDOW_LIMITER=memory counts per process; with more than one app replica each replica allows the full limit. Use the database limiter in production.",
      );
    }
    return shortWindowAllow(userId, tier ?? (await tierForUser(userId)));
  }

  const [burst, sustained] = rateWindowsFor(tier ?? (await tierForUser(userId)));
  const { data, error } = await supabaseAdmin.rpc("check_mcp_rate_limit", {
    _user_id: userId,
    _burst_window_seconds: burst.seconds,
    _burst_max: burst.max,
    _window_seconds: sustained.seconds,
    _max_requests: sustained.max,
  });

  if (isMissingFunction(error)) {
    // Rolling deploy before the migration landed: keep the burst guard only.
    if (!warnedMissingRateLimitRpc) {
      warnedMissingRateLimitRpc = true;
      console.error(
        "[mcp.rate_limit] check_mcp_rate_limit is missing; enforcing the burst window only until the migration is applied",
      );
    }
    return legacyShortWindowCheck(userId, burst);
  }
  if (error) {
    console.error("[mcp.rate_limit] database limiter failed; failing closed", error);
    return false;
  }

  return data === true;
}

async function legacyShortWindowCheck(userId: string, burst: RateWindow): Promise<boolean> {
  const { data, error } = await supabaseAdmin.rpc("check_mcp_short_window", {
    _user_id: userId,
    _window_seconds: burst.seconds,
    _max_requests: burst.max,
  });
  if (error) {
    console.error("[mcp.rate_limit] database limiter failed; failing closed", error);
    return false;
  }
  return data === true;
}

/**
 * Read-only daily quota check. Not safe for gating billable calls (it is
 * check-then-act); those must use reserveDailyQuota().
 */
export async function checkDailyQuota(
  auth: AuthedKey,
): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = dailyLimitFor(auth.tier);
  const { data, error } = await supabaseAdmin.rpc("get_today_mcp_usage", {
    _user_id: auth.user_id,
  });
  if (error) {
    console.error("[mcp.quota] daily quota lookup failed; failing closed", error);
    return { ok: false, used: limit, limit };
  }
  const used = typeof data === "number" ? data : 0;
  return { ok: used < limit, used, limit };
}

/*
 * Daily quota billing rule (MCP gateway and dashboard agent console):
 *
 * - One unit is reserved atomically (reserve_mcp_usage) BEFORE a billable call
 *   is dispatched, so concurrent calls can never overshoot the tier limit.
 * - The reservation is kept (the call is charged) once the tool was actually
 *   dispatched: successful calls, business failures and ordinary tool errors.
 *   Those calls are logged with recordCall({ usage: "reserved" }) so they are
 *   not counted a second time.
 * - The reservation is refunded (releaseDailyQuota) when the call did no
 *   billable work: no n8n instance configured, OAuth scope denied, invalid
 *   modern requestState, a confirmation round-trip (elicitation required),
 *   rejected dashboard preconditions, or an unexpected failure before dispatch.
 * - Throttled / quota-denied calls are never charged.
 */

/** Daily limit for a tier, defaulting to the free tier. */
function dailyLimitFor(tier: Tier): number {
  return TIER_DAILY_LIMITS[tier] ?? TIER_DAILY_LIMITS.free;
}

/**
 * Atomically reserves `n` units of the user's daily MCP quota. `ok: false`
 * means nothing was reserved. Fails closed when the RPC errors.
 */
export async function reserveDailyQuota(
  auth: Pick<AuthedKey, "user_id" | "tier">,
  n = 1,
): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = dailyLimitFor(auth.tier);
  const { data, error } = await supabaseAdmin.rpc("reserve_mcp_usage", {
    _user_id: auth.user_id,
    _limit: limit,
    _n: n,
  });
  const row = Array.isArray(data) ? data[0] : null;
  if (error || !row) {
    console.error("[mcp.quota] daily quota reservation failed; failing closed", error);
    return { ok: false, used: limit, limit };
  }
  return { ok: row.allowed === true, used: row.used, limit: row.quota_limit ?? limit };
}

/**
 * Refunds `n` previously reserved units (never below zero). Best effort: a
 * failed refund only over-counts the user's own usage, so it is logged and
 * swallowed rather than failing the request.
 */
export async function releaseDailyQuota(userId: string, n = 1): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc("release_mcp_usage", { _user_id: userId, _n: n });
    if (error) console.error("[mcp.quota] daily quota refund failed", error);
  } catch (error) {
    console.error("[mcp.quota] daily quota refund failed", error);
  }
}

/**
 * How recordCall() treats the daily usage counter:
 * - "increment": count the call now (legacy path for callers that did not reserve).
 * - "reserved": the call was already counted by reserveDailyQuota(); do not count again.
 * - "none": the call is not billable (e.g. its reservation was refunded).
 * Rate-limited calls are never counted.
 */
export type CallUsage = "increment" | "reserved" | "none";

export async function recordCall(opts: {
  user_id: string;
  instance_id?: string | null;
  tool_name: string | null;
  status: "ok" | "error" | "rate_limited";
  latency_ms: number;
  error_message?: string | null;
  upstream?: boolean;
  category?: "local" | "knowledge" | "management" | null;
  workflow_id?: string | null;
  session_id?: string | null;
  metadata?: Json;
  /** How the caller authenticated; stored under metadata.auth. */
  auth?: { source: "api_key" | "oauth"; client_id?: string };
  /** Daily usage accounting; defaults to "increment". See CallUsage. */
  usage?: CallUsage;
}) {
  const baseMetadata =
    opts.metadata && typeof opts.metadata === "object" && !Array.isArray(opts.metadata)
      ? opts.metadata
      : {};
  const metadata: Json = opts.auth
    ? {
        ...baseMetadata,
        auth: {
          source: opts.auth.source,
          ...(opts.auth.client_id ? { client_id: opts.auth.client_id } : {}),
        },
      }
    : (opts.metadata ?? {});
  const writes: PromiseLike<unknown>[] = [
    supabaseAdmin.from("mcp_call_logs").insert({
      user_id: opts.user_id,
      instance_id: opts.instance_id ?? null,
      tool_name: opts.tool_name,
      status: opts.status,
      latency_ms: opts.latency_ms,
      error_message: opts.error_message ?? null,
      upstream: opts.upstream ?? false,
      category: opts.category ?? null,
      workflow_id: opts.workflow_id ?? null,
      session_id: opts.session_id ?? null,
      metadata,
    }),
  ];

  if ((opts.usage ?? "increment") === "increment" && opts.status !== "rate_limited") {
    writes.push(supabaseAdmin.rpc("increment_mcp_usage", { _user_id: opts.user_id, _n: 1 }));
  }

  await Promise.allSettled(writes);
}
