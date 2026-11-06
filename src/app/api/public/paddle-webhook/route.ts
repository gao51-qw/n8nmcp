// Paddle webhook receiver. Verifies the Paddle-Signature HMAC first, then
// mirrors subscription state into public.subscriptions.
//
// Binding rules (see src/lib/billing/checkout-binding.server.ts):
// - An event for a subscription that is already stored
//   (billing_provider = paddle and billing_subscription_id = sub.id) updates
//   that row only. customData never picks the user; when it names a different
//   user the mismatch is logged and customData is ignored. This also keeps
//   subscriptions created before signed bindings existed working.
// - Only `subscription.created` may create a new user <-> subscription
//   binding, and only from server-signed customData whose `ts` is at most 24h
//   older than the subscription's Paddle `createdAt`.
// - Unsigned, forged, expired or unbound events are logged and acknowledged
//   with 200 so Paddle does not retry them forever. They change nothing.
import {
  EventName,
  type SubscriptionNotification,
  type TransactionNotification,
} from "@paddle/paddle-node-sdk";
import { getPaddle, isPaddleConfigured } from "@/lib/paddle.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger.server";
import {
  claimedCheckoutUserId,
  verifyCheckoutBinding,
} from "@/lib/billing/checkout-binding.server";
import { subscriptionUpdateFromPaddle } from "@/lib/billing/subscription-sync.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubscriptionSnapshot = Pick<
  SubscriptionNotification,
  "id" | "status" | "customerId" | "createdAt" | "currentBillingPeriod" | "items" | "customData"
>;

type StoredBinding = { user_id: string };

/** The row already bound to this Paddle subscription, if any. */
async function findStoredBinding(
  subscriptionId: string,
): Promise<StoredBinding | "ambiguous" | null> {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("user_id")
    .eq("billing_provider", "paddle")
    .eq("billing_subscription_id", subscriptionId)
    .limit(2);
  if (error) throw new Error(`Subscription binding lookup failed: ${error.message}`);
  const rows = (data ?? []) as StoredBinding[];
  if (rows.length > 1) return "ambiguous";
  return rows[0] ?? null;
}

function bindingReferenceTime(sub: SubscriptionSnapshot, occurredAt: string | undefined): number {
  const createdAt = Date.parse(sub.createdAt ?? "");
  if (Number.isFinite(createdAt)) return createdAt;
  // Without any usable Paddle timestamp the result is NaN, which fails closed.
  return Date.parse(occurredAt ?? "");
}

async function applySubscription(
  sub: SubscriptionSnapshot,
  opts: { eventType: string; occurredAt?: string; mayCreateBinding: boolean },
) {
  if (!sub?.id) {
    log.warn("paddle.webhook.subscription_missing_id", { event_type: opts.eventType });
    return;
  }

  const fields = subscriptionUpdateFromPaddle(sub);
  const stored = await findStoredBinding(sub.id);

  if (stored === "ambiguous") {
    log.error("paddle.webhook.binding_ambiguous", {
      subscription_id: sub.id,
      event_type: opts.eventType,
    });
    return;
  }

  if (stored) {
    const claimedUserId = claimedCheckoutUserId(sub.customData);
    if (claimedUserId && claimedUserId !== stored.user_id.toLowerCase()) {
      log.warn("paddle.webhook.custom_data_mismatch", {
        subscription_id: sub.id,
        user_id: stored.user_id,
        claimed_user_id: claimedUserId,
        event_type: opts.eventType,
      });
    }
    const { error } = await supabaseAdmin
      .from("subscriptions")
      .update(fields)
      .eq("user_id", stored.user_id)
      .eq("billing_subscription_id", sub.id);
    if (error) {
      log.error("paddle.webhook.update_failed", { user_id: stored.user_id, err: error.message });
    } else {
      log.info("paddle.webhook.subscription_synced", {
        user_id: stored.user_id,
        tier: fields.tier,
        status: fields.status,
      });
    }
    return;
  }

  if (!opts.mayCreateBinding) {
    log.warn("paddle.webhook.subscription_unbound", {
      subscription_id: sub.id,
      event_type: opts.eventType,
    });
    return;
  }

  const verified = verifyCheckoutBinding(
    sub.customData,
    bindingReferenceTime(sub, opts.occurredAt),
  );
  if (!verified.ok) {
    log.warn("paddle.webhook.binding_rejected", {
      subscription_id: sub.id,
      event_type: opts.eventType,
      reason: verified.reason,
      claimed_user_id: verified.claimedUserId,
    });
    return;
  }

  const { error } = await supabaseAdmin.from("subscriptions").upsert(
    {
      user_id: verified.userId,
      billing_provider: "paddle",
      billing_subscription_id: sub.id,
      ...fields,
    },
    { onConflict: "user_id" },
  );
  if (error) {
    log.error("paddle.webhook.upsert_failed", { user_id: verified.userId, err: error.message });
  } else {
    log.info("paddle.webhook.subscription_bound", {
      user_id: verified.userId,
      subscription_id: sub.id,
      tier: fields.tier,
      status: fields.status,
    });
  }
}

async function markPastDueFromTransaction(tx: TransactionNotification) {
  const subId = tx.subscriptionId;
  if (!subId) return;
  // Resolved through the stored binding only.
  const { error } = await supabaseAdmin
    .from("subscriptions")
    .update({ status: "past_due", updated_at: new Date().toISOString() })
    .eq("billing_provider", "paddle")
    .eq("billing_subscription_id", subId);
  if (error) {
    log.error("paddle.webhook.update_failed", { subscription_id: subId, err: error.message });
  }
  log.warn("paddle.webhook.payment_failed", { subscription_id: subId });
}

export async function POST(request: Request) {
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
        await applySubscription(event.data as SubscriptionNotification, {
          eventType: event.eventType,
          occurredAt: event.occurredAt,
          mayCreateBinding: true,
        });
        break;
      case EventName.SubscriptionUpdated:
      case EventName.SubscriptionActivated:
      case EventName.SubscriptionResumed:
      case EventName.SubscriptionCanceled:
      case EventName.SubscriptionPastDue:
      case EventName.SubscriptionTrialing:
        await applySubscription(event.data as SubscriptionNotification, {
          eventType: event.eventType,
          occurredAt: event.occurredAt,
          mayCreateBinding: false,
        });
        break;
      case EventName.TransactionCompleted: {
        const tx = event.data as TransactionNotification;
        if (tx.subscriptionId) {
          // Fetched from the Paddle API, then resolved through the stored binding only.
          const sub = await paddle.subscriptions.get(tx.subscriptionId);
          await applySubscription(sub as unknown as SubscriptionSnapshot, {
            eventType: event.eventType,
            occurredAt: event.occurredAt,
            mayCreateBinding: false,
          });
        }
        break;
      }
      case EventName.TransactionPaymentFailed:
        await markPastDueFromTransaction(event.data as TransactionNotification);
        break;
      default:
        break;
    }
  } catch (e) {
    log.error("paddle.webhook.handler_failed", {
      type: event.eventType,
      err: e instanceof Error ? e.message : String(e),
    });
    return new Response("ok (handler error logged)", { status: 200 });
  }

  return new Response("ok", { status: 200 });
}
