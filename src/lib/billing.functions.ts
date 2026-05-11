import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  appPublicUrl,
  getPaddle,
  isPaddleConfigured,
  priceIdForTier,
} from "./paddle.server";
import { log } from "./logger.server";
import type { Tier } from "./tiers";

/**
 * Create a Paddle transaction for the requested tier and return its id + checkout URL.
 *
 * The frontend can either:
 *  - redirect the user to the hosted checkout via the returned `checkout_url`, or
 *  - open Paddle.js inline checkout passing the returned `transaction_id`.
 */
export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ tier: z.enum(["pro", "enterprise"]) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    if (!isPaddleConfigured()) {
      throw new Error("Billing is not configured on this deployment");
    }
    const priceId = priceIdForTier(data.tier as Tier);
    if (!priceId) {
      throw new Error(`No Paddle price configured for tier=${data.tier}`);
    }
    const paddle = getPaddle();
    const base = appPublicUrl();

    // Reuse customer id if we already have one for this user.
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("billing_customer_id")
      .eq("user_id", context.userId)
      .maybeSingle();

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", context.userId)
      .maybeSingle();

    try {
      let customerId = sub?.billing_customer_id ?? undefined;
      if (!customerId && profile?.email) {
        // Try create; if Paddle already has one with that email, look it up and reuse.
        try {
          const created = await paddle.customers.create({
            email: profile.email,
            customData: { user_id: context.userId },
          });
          customerId = created.id;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const m = msg.match(/ctm_[a-z0-9]+/i);
          if (m) {
            customerId = m[0];
          } else {
            // Fallback: list customers by email
            const list = paddle.customers.list({ email: [profile.email] });
            const first = await list.next();
            if (first?.id) customerId = first.id;
            else throw e;
          }
        }
        // Persist for future checkouts so we never hit the conflict again.
        if (customerId) {
          await supabaseAdmin
            .from("subscriptions")
            .upsert(
              { user_id: context.userId, billing_customer_id: customerId },
              { onConflict: "user_id" },
            );
        }
      }

      const tx = await paddle.transactions.create({
        items: [{ priceId, quantity: 1 }],
        customerId,
        customData: { user_id: context.userId, tier: data.tier },
        checkout: {
          url: `${base}/billing?upgraded=1`,
        },
      });

      log.info("paddle.checkout.created", {
        user_id: context.userId,
        tier: data.tier,
        transaction_id: tx.id,
      });
      return {
        transaction_id: tx.id,
        url: tx.checkout?.url ?? null,
      };
    } catch (e) {
      log.error("paddle.checkout.failed", { user_id: context.userId, err: e });
      throw new Error("Could not start checkout. Please try again.");
    }
  });

/**
 * Generate a one-time URL into Paddle's hosted customer portal so users can
 * update payment methods, view invoices, or cancel.
 */
export const createBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!isPaddleConfigured()) throw new Error("Billing is not configured");
    const paddle = getPaddle();

    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("billing_customer_id, billing_subscription_id")
      .eq("user_id", context.userId)
      .maybeSingle();

    if (!sub?.billing_customer_id) {
      throw new Error("No active subscription to manage");
    }
    try {
      const portal = await paddle.customerPortalSessions.create(
        sub.billing_customer_id,
        sub.billing_subscription_id ? [sub.billing_subscription_id] : [],
      );
      const url =
        portal.urls?.general?.overview ??
        portal.urls?.subscriptions?.[0]?.updateSubscriptionPaymentMethod ??
        null;
      if (!url) throw new Error("Paddle did not return a portal URL");
      return { url };
    } catch (e) {
      log.error("paddle.portal.failed", { user_id: context.userId, err: e });
      throw new Error("Could not open billing portal");
    }
  });
