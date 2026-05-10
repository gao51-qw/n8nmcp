// Stripe webhook receiver. Verifies signature, then mirrors subscription
// state into public.subscriptions. Configure endpoint in Stripe dashboard:
//
//   URL:    https://<APP_PUBLIC_URL>/api/public/stripe-webhook
//   Events: checkout.session.completed
//           customer.subscription.created
//           customer.subscription.updated
//           customer.subscription.deleted
//           invoice.payment_failed
import { createFileRoute } from "@tanstack/react-router";
import type Stripe from "stripe";
import { getStripe, isStripeConfigured, tierFromPriceId } from "@/lib/stripe.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger.server";

async function upsertSubscriptionFromStripe(sub: Stripe.Subscription) {
  const userId =
    (sub.metadata?.user_id as string | undefined) ??
    (typeof sub.customer === "object" && sub.customer && "metadata" in sub.customer
      ? ((sub.customer as Stripe.Customer).metadata?.user_id as string | undefined)
      : undefined);
  if (!userId) {
    log.warn("stripe.webhook.subscription_missing_user_id", { subscription_id: sub.id });
    return;
  }
  const priceId = sub.items.data[0]?.price?.id ?? null;
  const tier = tierFromPriceId(priceId);
  const periodEnd = (sub.items.data[0] as Stripe.SubscriptionItem & { current_period_end?: number })
    ?.current_period_end;
  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;

  const status = sub.status === "active" || sub.status === "trialing" ? "active" : sub.status;
  const effectiveTier = sub.status === "canceled" || sub.status === "incomplete_expired" ? "free" : tier;

  const { error } = await supabaseAdmin
    .from("subscriptions")
    .upsert(
      {
        user_id: userId,
        tier: effectiveTier,
        status,
        stripe_customer_id: customerId ?? null,
        stripe_subscription_id: sub.id,
        current_period_end: periodEnd ? new Date(periodEnd * 1000).toISOString() : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  if (error) log.error("stripe.webhook.upsert_failed", { user_id: userId, err: error.message });
  else log.info("stripe.webhook.subscription_synced", { user_id: userId, tier: effectiveTier, status });
}

export const Route = createFileRoute("/api/public/stripe-webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!isStripeConfigured()) {
          return new Response("Billing not configured", { status: 503 });
        }
        const secret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!secret) return new Response("Webhook secret missing", { status: 503 });

        const sig = request.headers.get("stripe-signature");
        if (!sig) return new Response("Missing signature", { status: 400 });

        const raw = await request.text();
        let event: Stripe.Event;
        const stripe = getStripe();
        try {
          event = await stripe.webhooks.constructEventAsync(raw, sig, secret);
        } catch (e) {
          log.warn("stripe.webhook.invalid_signature", {
            err: e instanceof Error ? e.message : String(e),
          });
          return new Response("Invalid signature", { status: 401 });
        }

        try {
          switch (event.type) {
            case "checkout.session.completed": {
              const s = event.data.object as Stripe.Checkout.Session;
              if (s.subscription && typeof s.subscription === "string") {
                const sub = await stripe.subscriptions.retrieve(s.subscription);
                await upsertSubscriptionFromStripe(sub);
              }
              break;
            }
            case "customer.subscription.created":
            case "customer.subscription.updated":
            case "customer.subscription.deleted": {
              await upsertSubscriptionFromStripe(event.data.object as Stripe.Subscription);
              break;
            }
            case "invoice.payment_failed": {
              const inv = event.data.object as Stripe.Invoice;
              const subId = (inv as Stripe.Invoice & { subscription?: string }).subscription;
              if (subId && typeof subId === "string") {
                await supabaseAdmin
                  .from("subscriptions")
                  .update({ status: "past_due", updated_at: new Date().toISOString() })
                  .eq("stripe_subscription_id", subId);
                log.warn("stripe.webhook.payment_failed", { subscription_id: subId });
              }
              break;
            }
            default:
              // Ignore unrelated events
              break;
          }
        } catch (e) {
          log.error("stripe.webhook.handler_failed", { type: event.type, err: e });
          // Return 200 anyway so Stripe doesn't retry into a poison loop on
          // bugs we'd rather see in logs and fix forward.
          return new Response("ok (handler error logged)", { status: 200 });
        }

        return new Response("ok", { status: 200 });
      },
    },
  },
});
