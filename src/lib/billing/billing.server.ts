// Server-side billing helpers for the dashboard billing page. The Paddle API
// key never leaves this module; only the public client token and price ID
// are returned to the browser.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { errorFields } from "@/lib/error-fields.server";
import { HttpError } from "@/lib/http/api-response.server";
import { log } from "@/lib/logger.server";
import {
  getPaddle,
  isPaddleConfigured,
  paddleClientToken,
  paddleEnvironment,
  priceIdForTier,
} from "@/lib/paddle.server";
import { grantedTier, tierOf } from "@/lib/tiers";
import {
  isCheckoutBindingConfigured,
  signCheckoutBinding,
} from "@/lib/billing/checkout-binding.server";
import type { BillingConfigResponse, BillingSubscription } from "@/lib/billing/billing-types";

const CLIENT_TOKEN = /^(test|live)_[A-Za-z0-9]+$/;
const PRICE_ID = /^pri_[A-Za-z0-9]+$/;

export type PaddleCheckoutConfig = Pick<
  BillingConfigResponse,
  "enabled" | "environment" | "clientToken" | "prices"
>;

/**
 * Checkout is offered only when the server API key, a well-formed client
 * token for the configured environment and a Pro price are all present.
 * Anything partial or mismatched fails closed and exposes nothing.
 */
export function paddleCheckoutConfig(): PaddleCheckoutConfig {
  const environment = paddleEnvironment();
  const disabled: PaddleCheckoutConfig = {
    enabled: false,
    environment,
    clientToken: null,
    prices: { pro: null },
  };

  const clientToken = paddleClientToken()?.trim() ?? "";
  const proPrice = priceIdForTier("pro")?.trim() ?? "";
  if (!isPaddleConfigured() || !clientToken || !proPrice) return disabled;

  const tokenEnvironment = clientToken.startsWith("live_") ? "production" : "sandbox";
  if (!CLIENT_TOKEN.test(clientToken) || !PRICE_ID.test(proPrice)) {
    log.warn("billing.config.invalid", { reason: "malformed_paddle_config" });
    return disabled;
  }
  if (tokenEnvironment !== environment) {
    log.warn("billing.config.invalid", { reason: "client_token_environment_mismatch" });
    return disabled;
  }
  // Without the binding secret the webhook could not attribute a new
  // subscription to anyone, so checkout is not offered at all.
  if (!isCheckoutBindingConfigured()) {
    log.warn("billing.config.invalid", { reason: "checkout_binding_secret_unset" });
    return disabled;
  }

  return { enabled: true, environment, clientToken, prices: { pro: proPrice } };
}

type SubscriptionRow = {
  tier: string | null;
  status: string | null;
  current_period_end: string | null;
  billing_provider: string | null;
  billing_customer_id: string | null;
};

async function loadSubscriptionRow(userId: string): Promise<SubscriptionRow | null> {
  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("tier,status,current_period_end,billing_provider,billing_customer_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    log.error("billing.subscription.lookup_failed", { user_id: userId, ...errorFields(error) });
    throw new HttpError(500, "billing_unavailable", "Billing details could not be loaded.");
  }
  return (data as SubscriptionRow | null) ?? null;
}

export async function loadBillingSubscription(userId: string): Promise<BillingSubscription> {
  const row = await loadSubscriptionRow(userId);
  return {
    tier: grantedTier(row?.tier, row?.status),
    plan: tierOf(row?.tier),
    status: row?.status ?? null,
    currentPeriodEnd: row?.current_period_end ?? null,
    canManage: row?.billing_provider === "paddle" && Boolean(row?.billing_customer_id),
  };
}

export async function loadBillingConfig(user: {
  userId: string;
  email: string | null;
}): Promise<BillingConfigResponse> {
  const config = paddleCheckoutConfig();
  const subscription = await loadBillingSubscription(user.userId);
  const customData = config.enabled ? signCheckoutBinding(user.userId) : null;
  if (!customData) {
    // Fail closed: never offer a checkout the webhook could not attribute.
    return {
      enabled: false,
      environment: config.environment,
      clientToken: null,
      prices: { pro: null },
      checkout: null,
      subscription,
    };
  }
  return { ...config, checkout: { email: user.email, customData }, subscription };
}

function isPaddlePortalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && (host === "paddle.com" || host.endsWith(".paddle.com"));
  } catch {
    return false;
  }
}

/** A one-time Paddle customer portal link for the signed-in user. */
export async function createCustomerPortalUrl(userId: string): Promise<string> {
  if (!isPaddleConfigured()) {
    throw new HttpError(503, "billing_unavailable", "Billing is not available right now.");
  }

  const { data, error } = await supabaseAdmin
    .from("subscriptions")
    .select("billing_provider,billing_customer_id,billing_subscription_id")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    log.error("billing.portal.lookup_failed", { user_id: userId, ...errorFields(error) });
    throw new HttpError(500, "billing_unavailable", "Billing details could not be loaded.");
  }

  const row = data as {
    billing_provider: string | null;
    billing_customer_id: string | null;
    billing_subscription_id: string | null;
  } | null;
  if (!row || row.billing_provider !== "paddle" || !row.billing_customer_id) {
    throw new HttpError(
      404,
      "no_subscription",
      "There is no Paddle subscription to manage for this account.",
    );
  }

  let url: string | undefined;
  try {
    const session = await getPaddle().customerPortalSessions.create(
      row.billing_customer_id,
      row.billing_subscription_id ? [row.billing_subscription_id] : [],
    );
    url = session.urls?.general?.overview;
  } catch (cause) {
    log.error("billing.portal.create_failed", { user_id: userId, ...errorFields(cause) });
    throw new HttpError(502, "portal_unavailable", "The billing portal could not be opened.");
  }

  if (!url || !isPaddlePortalUrl(url)) {
    log.error("billing.portal.unexpected_url", { user_id: userId });
    throw new HttpError(502, "portal_unavailable", "The billing portal could not be opened.");
  }
  return url;
}
