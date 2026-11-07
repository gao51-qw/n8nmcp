// Paddle webhook receiver. Verifies the Paddle-Signature HMAC first, then
// mirrors subscription state into public.subscriptions.
//
// Binding rules (see src/lib/billing/checkout-binding.server.ts):
// - An event for a subscription that is already stored
//   (billing_provider = paddle and billing_subscription_id = sub.id) updates
//   that row only. customData never picks the user; when it names a different
//   user the mismatch is logged and customData is ignored. This also keeps
//   subscriptions created before signed bindings existed working.
// - Any subscription.* event for a subscription that is not stored yet may
//   create the binding, but only from server-signed v2 customData whose `ts`
//   is at most 24h older than the subscription's Paddle `createdAt`, and only
//   once per nonce: bind_paddle_subscription() consumes the nonce and writes
//   the binding in one transaction. A nonce already used by another
//   subscription is rejected (`nonce_reused`); a retry for the same
//   subscription is idempotent. So events that arrive before
//   subscription.created are no longer lost.
// - transaction.* events never create a binding.
//
// Ordering: every applied event stores its Paddle `occurredAt` in
// subscriptions.billing_last_event_at. An event older than the stored value is
// logged and ignored. Equal timestamps are applied, so retries stay idempotent.
//
// Unsigned, forged, expired, replayed, stale or unbound events are logged and
// acknowledged with 200 so Paddle does not retry them forever. They change
// nothing. A database or Paddle API failure while applying a valid event is
// different: it is answered with 500 so Paddle redelivers it (with backoff,
// for a few days) instead of the event being lost until the reconciliation
// cron notices. Only permanent database errors (constraint, data or syntax
// classes) are acknowledged, since a retry cannot change them.
import {
  EventName,
  type SubscriptionNotification,
  type TransactionNotification,
} from "@paddle/paddle-node-sdk";
import { getPaddle, isPaddleConfigured } from "@/lib/paddle.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { errorFields } from "@/lib/error-fields.server";
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

type DbError = { message?: string; code?: string | null };

/**
 * A failure that a redelivery may resolve (database or Paddle API trouble).
 * The route answers it with 500, which makes Paddle retry the event.
 */
class WebhookRetryableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "WebhookRetryableError";
  }
}

/** SQLSTATE classes a retry cannot change: data (22), integrity (23), syntax/access (42). */
const PERMANENT_SQLSTATE = /^(?:22|23|42)/;

function isPermanentDbError(error: DbError): boolean {
  return typeof error.code === "string" && PERMANENT_SQLSTATE.test(error.code);
}

/** Paddle RFC 3339 timestamps, e.g. 2024-04-12T10:18:49.621022Z. */
const EVENT_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/;

/** The Paddle `occurredAt`, or null when it is missing or malformed. */
function eventTime(occurredAt: string | undefined): string | null {
  if (typeof occurredAt !== "string" || !EVENT_TIME.test(occurredAt)) return null;
  return Number.isFinite(Date.parse(occurredAt)) ? occurredAt : null;
}

/** PostgREST filter: the row has not applied an event newer than `eventAt`. */
function notNewerThan(eventAt: string): string {
  return `billing_last_event_at.is.null,billing_last_event_at.lte.${eventAt}`;
}

/** Outcomes of public.bind_paddle_subscription(). */
type BindOutcome =
  | "bound"
  | "updated"
  | "stale"
  | "nonce_reused"
  | "binding_superseded"
  | "subscription_bound_elsewhere";

const BIND_REJECTIONS = new Set<string>([
  "nonce_reused",
  "binding_superseded",
  "subscription_bound_elsewhere",
]);

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
  if (error) throw new WebhookRetryableError("Subscription binding lookup failed", error);
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

function logStale(fields: Record<string, unknown>) {
  log.info("paddle.webhook.event_stale", fields);
}

async function updateStoredBinding(
  sub: SubscriptionSnapshot,
  stored: StoredBinding,
  eventAt: string,
  eventType: string,
) {
  const claimedUserId = claimedCheckoutUserId(sub.customData);
  if (claimedUserId && claimedUserId !== stored.user_id.toLowerCase()) {
    log.warn("paddle.webhook.custom_data_mismatch", {
      subscription_id: sub.id,
      user_id: stored.user_id,
      claimed_user_id: claimedUserId,
      event_type: eventType,
    });
  }
  const fields = subscriptionUpdateFromPaddle(sub);
  // One conditional statement: the row is written only when it has not
  // already applied a newer event.
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .update({ ...fields, billing_last_event_at: eventAt })
    .eq("user_id", stored.user_id)
    .eq("billing_provider", "paddle")
    .eq("billing_subscription_id", sub.id)
    .or(notNewerThan(eventAt))
    .select("user_id");
  if (error) {
    log.error("paddle.webhook.update_failed", { user_id: stored.user_id, ...errorFields(error) });
    if (isPermanentDbError(error)) return;
    throw new WebhookRetryableError("Subscription update failed", error);
  }
  if (!data || data.length === 0) {
    logStale({
      subscription_id: sub.id,
      user_id: stored.user_id,
      event_type: eventType,
      occurred_at: eventAt,
    });
    return;
  }
  log.info("paddle.webhook.subscription_synced", {
    user_id: stored.user_id,
    tier: fields.tier,
    status: fields.status,
  });
}

async function applySubscription(
  sub: SubscriptionSnapshot,
  opts: { eventType: string; occurredAt?: string; mayCreateBinding: boolean },
) {
  if (!sub?.id) {
    log.warn("paddle.webhook.subscription_missing_id", { event_type: opts.eventType });
    return;
  }

  const eventAt = eventTime(opts.occurredAt);
  if (!eventAt) {
    // Without a Paddle event time the ordering guard cannot run: fail closed.
    log.warn("paddle.webhook.event_time_invalid", {
      subscription_id: sub.id,
      event_type: opts.eventType,
    });
    return;
  }

  const stored = await findStoredBinding(sub.id);

  if (stored === "ambiguous") {
    log.error("paddle.webhook.binding_ambiguous", {
      subscription_id: sub.id,
      event_type: opts.eventType,
    });
    return;
  }

  if (stored) {
    await updateStoredBinding(sub, stored, eventAt, opts.eventType);
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

  const fields = subscriptionUpdateFromPaddle(sub);
  const { data, error } = await supabaseAdmin.rpc("bind_paddle_subscription", {
    _nonce: verified.nonce,
    _user_id: verified.userId,
    _subscription_id: sub.id,
    _tier: fields.tier,
    _status: fields.status,
    _event_at: eventAt,
    _customer_id: fields.billing_customer_id ?? undefined,
    _current_period_end: fields.current_period_end ?? undefined,
  });
  if (error) {
    log.error("paddle.webhook.upsert_failed", { user_id: verified.userId, ...errorFields(error) });
    if (isPermanentDbError(error)) return;
    throw new WebhookRetryableError("Subscription binding failed", error);
  }

  const outcome = data as BindOutcome | null;
  if (outcome && BIND_REJECTIONS.has(outcome)) {
    log.warn("paddle.webhook.binding_rejected", {
      subscription_id: sub.id,
      event_type: opts.eventType,
      reason: outcome,
      claimed_user_id: verified.userId,
    });
    return;
  }
  if (outcome === "stale") {
    logStale({
      subscription_id: sub.id,
      user_id: verified.userId,
      event_type: opts.eventType,
      occurred_at: eventAt,
    });
    return;
  }
  if (outcome !== "bound" && outcome !== "updated") {
    log.error("paddle.webhook.upsert_failed", {
      user_id: verified.userId,
      err: "unexpected bind outcome",
    });
    return;
  }
  log.info(
    outcome === "bound"
      ? "paddle.webhook.subscription_bound"
      : "paddle.webhook.subscription_synced",
    {
      user_id: verified.userId,
      subscription_id: sub.id,
      tier: fields.tier,
      status: fields.status,
    },
  );
}

async function markPastDueFromTransaction(tx: TransactionNotification, occurredAt?: string) {
  const subId = tx.subscriptionId;
  if (!subId) return;
  const eventAt = eventTime(occurredAt);
  if (!eventAt) {
    log.warn("paddle.webhook.event_time_invalid", {
      subscription_id: subId,
      event_type: EventName.TransactionPaymentFailed,
    });
    return;
  }
  // Resolved through the stored binding only, and subject to event ordering.
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .update({
      status: "past_due",
      updated_at: new Date().toISOString(),
      billing_last_event_at: eventAt,
    })
    .eq("billing_provider", "paddle")
    .eq("billing_subscription_id", subId)
    .or(notNewerThan(eventAt))
    .select("user_id");
  if (error) {
    log.error("paddle.webhook.update_failed", { subscription_id: subId, ...errorFields(error) });
    if (!isPermanentDbError(error)) {
      throw new WebhookRetryableError("Past-due update failed", error);
    }
  } else if (!data || data.length === 0) {
    // Either no stored binding or a newer event was already applied.
    logStale({
      subscription_id: subId,
      event_type: EventName.TransactionPaymentFailed,
      occurred_at: eventAt,
    });
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
      case EventName.SubscriptionUpdated:
      case EventName.SubscriptionActivated:
      case EventName.SubscriptionResumed:
      case EventName.SubscriptionCanceled:
      case EventName.SubscriptionPastDue:
      case EventName.SubscriptionTrialing:
        // Any of these may arrive first; the signed, single-use customData is
        // what authorizes a new binding, not the event type.
        await applySubscription(event.data as SubscriptionNotification, {
          eventType: event.eventType,
          occurredAt: event.occurredAt,
          mayCreateBinding: true,
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
        await markPastDueFromTransaction(event.data as TransactionNotification, event.occurredAt);
        break;
      default:
        break;
    }
  } catch (e) {
    // A valid event that could not be applied (database or Paddle API
    // failure, or a bug): Paddle retries non-2xx deliveries, so the event is
    // not lost. The log line carries the cause.
    log.error("paddle.webhook.handler_failed", {
      type: event.eventType,
      retryable: e instanceof WebhookRetryableError,
      ...errorFields(e),
    });
    return new Response("Event not applied; retry", { status: 500 });
  }

  return new Response("ok", { status: 200 });
}
