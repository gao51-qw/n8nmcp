import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger.server";
import { getPaddle, tierFromPriceId } from "@/lib/paddle.server";

type LocalSubscriptionRow = {
  user_id: string;
  tier: string | null;
  status: string | null;
  billing_subscription_id: string | null;
  billing_customer_id: string | null;
  current_period_end: string | null;
};

type PaddleSubscriptionSnapshot = {
  id: string;
  status?: string | null;
  customerId?: string | null;
  currentBillingPeriod?: { endsAt?: string | null } | null;
  items?: Array<{ price?: { id?: string | null } | null }> | null;
};

export type SubscriptionSyncCounts = {
  scanned: number;
  synced: number;
  failed: number;
};

function normalizedStatus(rawStatus: string | null | undefined): string {
  if (rawStatus === "active" || rawStatus === "trialing") return "active";
  if (rawStatus === "past_due") return "past_due";
  if (rawStatus === "canceled") return "canceled";
  return String(rawStatus ?? "unknown");
}

function normalizePeriodEnd(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function subscriptionUpdateFromPaddle(sub: PaddleSubscriptionSnapshot) {
  const rawStatus = sub.status ?? null;
  const status = normalizedStatus(rawStatus);
  const priceId = sub.items?.[0]?.price?.id ?? null;

  return {
    tier: rawStatus === "canceled" ? "free" : tierFromPriceId(priceId),
    status,
    billing_customer_id: sub.customerId ?? null,
    current_period_end: normalizePeriodEnd(sub.currentBillingPeriod?.endsAt ?? null),
    updated_at: new Date().toISOString(),
  };
}

export async function syncPaddleSubscriptions(
  opts: { limit?: number } = {},
): Promise<SubscriptionSyncCounts> {
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id,tier,status,billing_subscription_id,billing_customer_id,current_period_end")
    .eq("billing_provider", "paddle")
    .not("billing_subscription_id", "is", null)
    .in("status", ["active", "trialing", "past_due"])
    .limit(limit);

  if (error) {
    throw new Error(`Could not load subscriptions for Paddle sync: ${error.message}`);
  }

  const rows = (data ?? []) as LocalSubscriptionRow[];
  const counts: SubscriptionSyncCounts = { scanned: rows.length, synced: 0, failed: 0 };
  const paddle = getPaddle();

  for (const row of rows) {
    const subscriptionId = row.billing_subscription_id;
    if (!subscriptionId) continue;

    try {
      const remote = (await paddle.subscriptions.get(subscriptionId)) as PaddleSubscriptionSnapshot;
      const update = subscriptionUpdateFromPaddle(remote);
      const { error: updateError } = await supabaseAdmin
        .from("subscriptions")
        .update(update)
        .eq("billing_subscription_id", subscriptionId);

      if (updateError) {
        counts.failed++;
        log.warn("billing.subscription_sync.update_failed", {
          subscriptionId,
          userId: row.user_id,
          errorType: "SupabaseError",
        });
        continue;
      }

      counts.synced++;
    } catch (error) {
      counts.failed++;
      log.warn("billing.subscription_sync.lookup_failed", {
        subscriptionId,
        userId: row.user_id,
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  log.info("billing.subscription_sync.completed", counts);
  return counts;
}
