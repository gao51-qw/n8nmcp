// Paddle webhook receiver. Verifies HMAC signature, then mirrors subscription
// state into public.subscriptions. Configure endpoint in Paddle dashboard:
//
//   URL:    https://<APP_PUBLIC_URL>/api/public/paddle-webhook
//   Events: subscription.created
//           subscription.updated
//           subscription.canceled
//           subscription.past_due
//           transaction.completed
//           transaction.payment_failed
import { createFileRoute } from "@tanstack/react-router";
import {
  EventName,
  type SubscriptionNotification,
  type TransactionNotification,
} from "@paddle/paddle-node-sdk";
import { getPaddle, isPaddleConfigured, tierFromPriceId } from "@/lib/paddle.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger.server";

function extractUserId(
  customData: unknown,
): string | undefined {
  if (customData && typeof customData === "object" && "user_id" in customData) {
    const v = (customData as Record<string, unknown>).user_id;
    if (typeof v === "string") return v;
  }
  return undefined;
}

async function upsertFromSubscription(sub: SubscriptionNotification) {
  const userId = extractUserId(sub.customData);
  if (!userId) {
    log.warn("paddle.webhook.subscription_missing_user_id", { subscription_id: sub.id });
    return;
  }
  const priceId = sub.items?.[0]?.price?.id ?? null;
  const tier = tierFromPriceId(priceId);
  const periodEnd = sub.currentBillingPeriod?.endsAt ?? null;
  const customerId = sub.customerId ?? null;

  // Map Paddle status -> our status. Anything not active/trialing is passed through.
  const rawStatus = sub.status;
  const status =
    rawStatus === "active" || rawStatus === "trialing"
      ? "active"
      : rawStatus === "past_due"
        ? "past_due"
        : rawStatus === "canceled"
          ? "canceled"
          : String(rawStatus);

  const effectiveTier = rawStatus === "canceled" ? "free" : tier;

  const { error } = await supabaseAdmin
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        tier: effectiveTier,
        status,
        billing_provider: "paddle",
        billing_customer_id: customerId,
        billing_subscription_id: sub.id,
        current_period_end: periodEnd ? new Date(periodEnd).toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) log.error("paddle.webhook.upsert_failed", { user_id: userId, err: error.message });
  else log.info("paddle.webhook.subscription_synced", { user_id: userId, tier: effectiveTier, status });
}

async function markPastDueFromTransaction(tx: TransactionNotification) {
  const subId = tx.subscriptionId;
  if (!subId) return;
  await supabaseAdmin
    .from("subscriptions")
    .update({ status: "past_due", updated_at: new Date().toISOString() })
    .eq("billing_subscription_id", subId);
  log.warn("paddle.webhook.payment_failed", { subscription_id: subId });
}

export const Route = createFileRoute("/api/public/paddle-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isPaddleConfigured()) {
          return new Response("Billing not configured", { status: 503 });
        }
        const secret = process.env.PADDLE_WEBHOOK_SECRET;
        if (!secret) return new Response("Webhook secret missing", { status: 503 });

        const sig = request.headers.get("paddle-signature");
        if (!sig) return new Response("Missing signature", { status: 400 });

        const raw = await request.text();
        const paddle = getPaddle();

        let event;
        try {
          // SDK verifies the HMAC and timestamp window, then parses the payload.
          event = await paddle.webhooks.unmarshal(raw, secret, sig);
        } catch (e) {
          log.warn("paddle.webhook.invalid_signature", {
            err: e instanceof Error ? e.message : String(e),
          });
          return new Response("Invalid signature", { status: 401 });
        }

        if (!event) {
          return new Response("Invalid payload", { status: 400 });
        }

        try {
          switch (event.eventType) {
            case EventName.SubscriptionCreated:
            case EventName.SubscriptionUpdated:
            case EventName.SubscriptionActivated:
            case EventName.SubscriptionResumed:
            case EventName.SubscriptionCanceled:
            case EventName.SubscriptionPastDue:
            case EventName.SubscriptionTrialing: {
              await upsertFromSubscription(event.data as SubscriptionNotification);
              break;
            }
            case EventName.TransactionCompleted: {
              const tx = event.data as TransactionNotification;
              if (tx.subscriptionId) {
                // Refresh from the source of truth.
                const sub = await paddle.subscriptions.get(tx.subscriptionId);
                await upsertFromSubscription(sub as unknown as SubscriptionNotification);
              }
              break;
            }
            case EventName.TransactionPaymentFailed: {
              await markPastDueFromTransaction(event.data as TransactionNotification);
              break;
            }
            default:
              // Ignore unrelated events
              break;
          }
        } catch (e) {
          log.error("paddle.webhook.handler_failed", {
            type: event.eventType,
            err: e instanceof Error ? e.message : String(e),
          });
          // Return 200 so Paddle doesn't retry into a poison loop on bugs we'd
          // rather see in logs and fix forward.
          return new Response("ok (handler error logged)", { status: 200 });
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
