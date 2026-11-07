// Server-issued, HMAC-signed, single-use binding between a checkout and a
// user account.
//
// Paddle.js `customData` is set in the browser, so a bare `user_id` is
// attacker-controlled. The billing config route therefore hands the browser
// `{ user_id, ts, nonce, sig }` where
//
//   nonce = base64url(16 random bytes)                      (22 characters)
//   sig   = base64url(HMAC-SHA256(BILLING_CUSTOM_DATA_SECRET,
//                                 "v2:" + user_id + ":" + ts + ":" + nonce))
//
// and `ts` is the issuance time in Unix seconds. v2 is the only accepted
// format. The Paddle webhook only creates a user <-> subscription binding from
// customData whose signature verifies and whose `ts` is at most
// CHECKOUT_BINDING_MAX_AGE_MS older than the subscription's Paddle
// `createdAt`. The nonce is then consumed by bind_paddle_subscription()
// (public.billing_checkout_nonces), so one signed blob binds one
// subscription only. Every later event resolves the user from the stored
// binding, never from customData.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { log } from "@/lib/logger.server";

export const CHECKOUT_BINDING_SECRET_ENV = "BILLING_CUSTOM_DATA_SECRET";
export const CHECKOUT_BINDING_VERSION = "v2";

/**
 * A signed binding may create a subscription binding only when the
 * subscription was created (Paddle `createdAt`) within 24 hours of the
 * billing config response that issued it. Measured against the Paddle
 * timestamp, not the delivery time, so webhook retries stay valid.
 */
export const CHECKOUT_BINDING_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Tolerated clock skew between this server and Paddle. */
export const CHECKOUT_BINDING_CLOCK_SKEW_MS = 5 * 60 * 1000;

/** Secrets shorter than this are treated as unset (fail closed). */
const MIN_SECRET_LENGTH = 32;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** 32-byte HMAC-SHA256 digest, base64url without padding. */
const SIGNATURE = /^[A-Za-z0-9_-]{43}$/;
/** 16 random bytes (128 bits), base64url without padding. */
export const CHECKOUT_NONCE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const TIMESTAMP_STRING = /^[0-9]{1,12}$/;

export type SignedCheckoutBinding = { user_id: string; ts: number; nonce: string; sig: string };

export type CheckoutBindingFailure =
  "secret_unset" | "missing" | "malformed" | "bad_signature" | "expired" | "issued_in_future";

export type CheckoutBindingResult =
  | { ok: true; userId: string; issuedAtMs: number; nonce: string }
  | { ok: false; reason: CheckoutBindingFailure; claimedUserId: string | null };

/**
 * The dedicated binding secret, or null when it is unset, too short, or
 * reused from another Paddle secret. There is no fallback secret.
 */
export function checkoutBindingSecret(): string | null {
  const secret = process.env[CHECKOUT_BINDING_SECRET_ENV]?.trim() ?? "";
  if (!secret) return null;
  if (secret.length < MIN_SECRET_LENGTH) {
    log.warn("billing.checkout_binding.secret_invalid", { reason: "too_short" });
    return null;
  }
  const shared = [process.env.PADDLE_WEBHOOK_SECRET, process.env.PADDLE_API_KEY]
    .map((value) => value?.trim())
    .some((value) => Boolean(value) && value === secret);
  if (shared) {
    log.warn("billing.checkout_binding.secret_invalid", { reason: "shared_with_paddle_secret" });
    return null;
  }
  return secret;
}

export function isCheckoutBindingConfigured(): boolean {
  return checkoutBindingSecret() !== null;
}

function computeSignature(secret: string, userId: string, ts: number, nonce: string): Buffer {
  return createHmac("sha256", secret)
    .update(`${CHECKOUT_BINDING_VERSION}:${userId}:${ts}:${nonce}`, "utf8")
    .digest();
}

/** A fresh 128-bit checkout nonce. */
export function newCheckoutNonce(): string {
  return randomBytes(16).toString("base64url");
}

/**
 * Signs a single-use checkout binding for `userId`. Returns null without a
 * usable secret. `nonce` is injectable for tests only.
 */
export function signCheckoutBinding(
  userId: string,
  nowMs: number = Date.now(),
  nonce: string = newCheckoutNonce(),
): SignedCheckoutBinding | null {
  const secret = checkoutBindingSecret();
  if (!secret || !UUID.test(userId) || !CHECKOUT_NONCE_PATTERN.test(nonce)) return null;
  const ts = Math.floor(nowMs / 1000);
  return {
    user_id: userId,
    ts,
    nonce,
    sig: computeSignature(secret, userId, ts, nonce).toString("base64url"),
  };
}

function parseTimestamp(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  }
  if (typeof value === "string" && TIMESTAMP_STRING.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

/** The `user_id` customData claims, for mismatch logging only. Never trusted. */
export function claimedCheckoutUserId(customData: unknown): string | null {
  if (!customData || typeof customData !== "object") return null;
  const value = (customData as Record<string, unknown>).user_id;
  return typeof value === "string" && UUID.test(value) ? value.toLowerCase() : null;
}

/**
 * Verifies signed checkout customData. `referenceTimeMs` is the moment the
 * binding is being established (the subscription's Paddle `createdAt`).
 * Single use is enforced separately, when the nonce is consumed.
 */
export function verifyCheckoutBinding(
  customData: unknown,
  referenceTimeMs: number,
): CheckoutBindingResult {
  const claimedUserId = claimedCheckoutUserId(customData);
  const secret = checkoutBindingSecret();
  if (!secret) return { ok: false, reason: "secret_unset", claimedUserId };

  if (!customData || typeof customData !== "object") {
    return { ok: false, reason: "missing", claimedUserId };
  }
  const data = customData as Record<string, unknown>;
  // Unsigned customData (for example a bare user_id) is "missing"; a signed
  // blob without every v2 field, such as a v1 blob, is "malformed".
  if (data.sig === undefined) {
    return { ok: false, reason: "missing", claimedUserId };
  }

  const userId = data.user_id;
  const ts = parseTimestamp(data.ts);
  const nonce = data.nonce;
  const sig = data.sig;
  if (
    typeof userId !== "string" ||
    !UUID.test(userId) ||
    ts === null ||
    typeof nonce !== "string" ||
    !CHECKOUT_NONCE_PATTERN.test(nonce) ||
    typeof sig !== "string" ||
    !SIGNATURE.test(sig)
  ) {
    return { ok: false, reason: "malformed", claimedUserId };
  }

  const expected = computeSignature(secret, userId, ts, nonce);
  const provided = Buffer.from(sig, "base64url");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    return { ok: false, reason: "bad_signature", claimedUserId };
  }

  const issuedAtMs = ts * 1000;
  if (!Number.isFinite(referenceTimeMs)) {
    return { ok: false, reason: "expired", claimedUserId };
  }
  if (issuedAtMs > referenceTimeMs + CHECKOUT_BINDING_CLOCK_SKEW_MS) {
    return { ok: false, reason: "issued_in_future", claimedUserId };
  }
  if (referenceTimeMs - issuedAtMs > CHECKOUT_BINDING_MAX_AGE_MS) {
    return { ok: false, reason: "expired", claimedUserId };
  }

  return { ok: true, userId: userId.toLowerCase(), issuedAtMs, nonce };
}
