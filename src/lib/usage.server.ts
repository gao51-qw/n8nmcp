// Read model for the dashboard Usage page: today's MCP quota, the plan it
// comes from, per-day call counts and the most recent MCP calls. Every query
// runs with the service-role client and is filtered by the caller's user id.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { effectiveTier } from "@/lib/mcp.server";
import { TIER_DAILY_LIMITS, TIER_LABELS, TIER_LIMITS, type Tier } from "@/lib/tiers";

export const USAGE_RECENT_DEFAULT = 25;
export const USAGE_RECENT_MAX = 100;
export const USAGE_HISTORY_DAYS = 14;
const ERROR_MESSAGE_MAX = 300;

export type UsageRecentCall = {
  id: string;
  tool_name: string | null;
  status: string;
  latency_ms: number | null;
  created_at: string;
  error_message: string | null;
};

export type UsageDay = { day: string; calls: number };

export type DashboardUsage = {
  tier: Tier;
  tierLabel: string;
  subscriptionStatus: string | null;
  used: number;
  limit: number;
  unlimited: boolean;
  remaining: number;
  /** Start of the next quota day (the database counts by UTC calendar day). */
  resetsAt: string;
  daily: UsageDay[];
  recentCalls: UsageRecentCall[];
};

export class UsageUnavailableError extends Error {
  constructor(
    readonly source: string,
    cause?: unknown,
  ) {
    super(`Usage lookup failed: ${source}`, cause === undefined ? undefined : { cause });
    this.name = "UsageUnavailableError";
  }
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function truncate(value: string | null): string | null {
  if (value === null) return null;
  return value.length > ERROR_MESSAGE_MAX ? `${value.slice(0, ERROR_MESSAGE_MAX - 1)}…` : value;
}

export async function loadDashboardUsage(
  userId: string,
  options: { recentLimit?: number; now?: Date } = {},
): Promise<DashboardUsage> {
  const now = options.now ?? new Date();
  const recentLimit = Math.min(
    Math.max(Math.trunc(options.recentLimit ?? USAGE_RECENT_DEFAULT), 1),
    USAGE_RECENT_MAX,
  );
  const firstDay = addUtcDays(now, -(USAGE_HISTORY_DAYS - 1));

  const [usageResult, subscriptionResult, dailyResult, recentResult] = await Promise.all([
    supabaseAdmin.rpc("get_today_mcp_usage", { _user_id: userId }),
    supabaseAdmin.from("subscriptions").select("tier,status").eq("user_id", userId).maybeSingle(),
    supabaseAdmin
      .from("usage_daily")
      .select("day,mcp_calls")
      .eq("user_id", userId)
      .gte("day", utcDay(firstDay))
      .order("day", { ascending: true }),
    supabaseAdmin
      .from("mcp_call_logs")
      .select("id,tool_name,status,latency_ms,created_at,error_message")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(recentLimit),
  ]);

  if (usageResult.error) throw new UsageUnavailableError("usage", usageResult.error);
  if (subscriptionResult.error) {
    throw new UsageUnavailableError("subscription", subscriptionResult.error);
  }
  if (dailyResult.error) throw new UsageUnavailableError("daily", dailyResult.error);
  if (recentResult.error) throw new UsageUnavailableError("recent", recentResult.error);

  const subscription = subscriptionResult.data as { tier: string; status: string } | null;
  const tier = effectiveTier(subscription?.tier, subscription?.status);
  const unlimited = TIER_LIMITS[tier].calls_day === -1;
  const limit = TIER_DAILY_LIMITS[tier] ?? TIER_DAILY_LIMITS.free;
  const used = typeof usageResult.data === "number" ? Math.max(usageResult.data, 0) : 0;

  const counts = new Map<string, number>();
  for (const row of (dailyResult.data ?? []) as Array<{ day: string; mcp_calls: number }>) {
    counts.set(String(row.day).slice(0, 10), Number(row.mcp_calls) || 0);
  }
  const daily: UsageDay[] = [];
  for (let offset = 0; offset < USAGE_HISTORY_DAYS; offset += 1) {
    const day = utcDay(addUtcDays(firstDay, offset));
    daily.push({ day, calls: counts.get(day) ?? 0 });
  }

  const recentCalls = ((recentResult.data ?? []) as UsageRecentCall[]).map((call) => ({
    id: call.id,
    tool_name: call.tool_name,
    status: call.status,
    latency_ms: call.latency_ms,
    created_at: call.created_at,
    error_message: truncate(call.error_message),
  }));

  return {
    tier,
    tierLabel: TIER_LABELS[tier],
    subscriptionStatus: subscription?.status ?? null,
    used,
    limit,
    unlimited,
    remaining: Math.max(limit - used, 0),
    resetsAt: addUtcDays(now, 1).toISOString(),
    daily,
    recentCalls,
  };
}
