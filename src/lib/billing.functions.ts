import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { appPublicUrl, getStripe, isStripeConfigured, priceIdForTier } from "./stripe.server";
import { log } from "./logger.server";
import type { Tier } from "./tiers";

/** Create a Stripe Checkout Session for the requested tier and return its URL. */
export const createCheckoutSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ tier: z.enum(["pro", "enterprise"]) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    if (!isStripeConfigured()) {
      throw new Error("Billing is not configured on this deployment");
    }
    const priceId = priceIdForTier(data.tier as Tier);
    if (!priceId) {
      throw new Error(`No Stripe price configured for tier=${data.tier}`);
    }
    const stripe = getStripe();
    const base = appPublicUrl();

    // Reuse customer id if we already have one for this user.
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", context.userId)
      .maybeSingle();

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("email")
      .eq("id", context.userId)
      .maybeSingle();

    try {
      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        line_items: [{ price: priceId, quantity: 1 }],
        success_url: `${base}/billing?upgraded=1&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${base}/billing?canceled=1`,
        client_reference_id: context.userId,
        customer: sub?.stripe_customer_id ?? undefined,
        customer_email: sub?.stripe_customer_id ? undefined : profile?.email ?? undefined,
        metadata: { user_id: context.userId, tier: data.tier },
        subscription_data: { metadata: { user_id: context.userId, tier: data.tier } },
        allow_promotion_codes: true,
      });
      log.info("stripe.checkout.created", {
        user_id: context.userId,
        tier: data.tier,
        session_id: session.id,
      });
      return { url: session.url };
    } catch (e) {
      log.error("stripe.checkout.failed", { user_id: context.userId, err: e });
      throw new Error("Could not start checkout. Please try again.");
    }
  });

/** Open the Stripe Customer Portal so users can manage / cancel their subscription. */
export const createBillingPortalSession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    if (!isStripeConfigured()) throw new Error("Billing is not configured");
    const stripe = getStripe();
    const { data: sub } = await supabaseAdmin
      .from("subscriptions")
      .select("stripe_customer_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!sub?.stripe_customer_id) {
      throw new Error("No active subscription to manage");
    }
    try {
      const portal = await stripe.billingPortal.sessions.create({
        customer: sub.stripe_customer_id,
        return_url: `${appPublicUrl()}/billing`,
      });
      return { url: portal.url };
    } catch (e) {
      log.error("stripe.portal.failed", { user_id: context.userId, err: e });
      throw new Error("Could not open billing portal");
    }
  });
