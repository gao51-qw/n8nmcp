// Paddle singleton + helpers (server-only). BYOK: uses your Paddle account.
import { Environment, Paddle } from "@paddle/paddle-node-sdk";
import type { Tier } from "./tiers";

let _client: Paddle | null = null;

export function getPaddle(): Paddle {
  if (_client) return _client;
  const key = process.env.PADDLE_API_KEY;
  if (!key) throw new Error("PADDLE_API_KEY is not configured");
  const env =
    (process.env.PADDLE_ENV ?? "sandbox").toLowerCase() === "production"
      ? Environment.production
      : Environment.sandbox;
  _client = new Paddle(key, { environment: env });
  return _client;
}

export function isPaddleConfigured(): boolean {
  return Boolean(process.env.PADDLE_API_KEY);
}

export function priceIdForTier(tier: Tier): string | null {
  if (tier === "pro") return process.env.PADDLE_PRICE_PRO ?? null;
  if (tier === "enterprise") return process.env.PADDLE_PRICE_ENTERPRISE ?? null;
  return null;
}

export function tierFromPriceId(priceId: string | null | undefined): Tier {
  if (!priceId) return "free";
  if (priceId === process.env.PADDLE_PRICE_PRO) return "pro";
  if (priceId === process.env.PADDLE_PRICE_ENTERPRISE) return "enterprise";
  return "free";
}

export function appPublicUrl(): string {
  return process.env.APP_PUBLIC_URL ?? "http://localhost:3001";
}

/** Public client-side token for Paddle.js checkout. Safe to expose. */
export function paddleClientToken(): string | null {
  return process.env.PADDLE_CLIENT_TOKEN ?? null;
}
