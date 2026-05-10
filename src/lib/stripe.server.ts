// Stripe singleton (server-only).
import Stripe from "stripe";

let _client: Stripe | null = null;

export function getStripe(): Stripe {
  if (_client) return _client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  _client = new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
  return _client;
}

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

import type { Tier } from "./tiers";

export function priceIdForTier(tier: Tier): string | null {
  if (tier === "pro") return process.env.STRIPE_PRICE_PRO ?? null;
  if (tier === "enterprise") return process.env.STRIPE_PRICE_ENTERPRISE ?? null;
  return null;
}

export function tierFromPriceId(priceId: string | null | undefined): Tier {
  if (!priceId) return "free";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  if (priceId === process.env.STRIPE_PRICE_ENTERPRISE) return "enterprise";
  return "free";
}

export function appPublicUrl(): string {
  return process.env.APP_PUBLIC_URL ?? "http://localhost:3001";
}
