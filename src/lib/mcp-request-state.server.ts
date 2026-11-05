// Integrity-protected `requestState` for MCP Multi Round-Trip Requests.
//
// Under 2026-07-28 a tool that needs the user's confirmation returns an
// InputRequiredResult; the client retries the same request with the user's
// answer and echoes `requestState` back. The state passes through the client,
// so it is attacker-controlled input: it is HMAC-signed and bound to the
// authenticated user, the tool name, a digest of the arguments, the
// confirmation being asked and a short expiry. Its nonce is redeemed in the
// shared MCP state (mcp-shared-state.server.ts), so each state works once even
// across replicas.
// Spec: https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/mrtr
import { createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
import { getMasterKey } from "@/lib/crypto.server";

export const REQUEST_STATE_TTL_MS = 5 * 60_000;
const STATE_VERSION = 1;
const MAX_STATE_LENGTH = 4096;

type StatePayload = {
  v: number;
  /** Authenticated user id. */
  sub: string;
  /** Tool name of the originating tools/call. */
  tool: string;
  /** Digest of the originating call's arguments. */
  args: string;
  /** Fingerprint of the confirmation that was asked (title + description). */
  fp: string;
  /** Key of the elicitation in `inputRequests`. */
  key: string;
  /** Expiry, epoch milliseconds. */
  exp: number;
  nonce: string;
};

export type RequestStateBinding = {
  userId: string;
  tool: string;
  args: Record<string, unknown>;
};

export type VerifiedRequestState = {
  key: string;
  fingerprint: string;
  nonce: string;
};

let cachedKey: Buffer | null = null;

function signingKey(): Buffer {
  if (!cachedKey) {
    cachedKey = Buffer.from(
      hkdfSync("sha256", getMasterKey(), Buffer.alloc(0), "n8n-mcp/mrtr-request-state/v1", 32),
    );
  }
  return cachedKey;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

/** Order-independent digest of tool-call arguments. */
export function digestArguments(args: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(args)).digest("base64url");
}

/** Fingerprint of the confirmation a tool asked for. */
export function confirmationFingerprint(request: { title: string; description: string }): string {
  return createHash("sha256")
    .update(JSON.stringify([request.title, request.description]))
    .digest("base64url");
}

function mac(body: string): Buffer {
  return createHmac("sha256", signingKey()).update(body).digest();
}

export function signRequestState(
  binding: RequestStateBinding,
  confirmation: { key: string; fingerprint: string },
  now = Date.now(),
): string {
  const payload: StatePayload = {
    v: STATE_VERSION,
    sub: binding.userId,
    tool: binding.tool,
    args: digestArguments(binding.args),
    fp: confirmation.fingerprint,
    key: confirmation.key,
    exp: now + REQUEST_STATE_TTL_MS,
    nonce: randomBytes(16).toString("base64url"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body).toString("base64url")}`;
}

export class InvalidRequestStateError extends Error {}

/**
 * Verifies a `requestState` against the retried request. Throws
 * InvalidRequestStateError for anything that is not a valid, unexpired,
 * unredeemed state issued for this user, tool and arguments.
 */
export function verifyRequestState(
  token: unknown,
  binding: RequestStateBinding,
  now = Date.now(),
): VerifiedRequestState {
  if (typeof token !== "string" || token.length === 0 || token.length > MAX_STATE_LENGTH) {
    throw new InvalidRequestStateError("requestState is malformed");
  }
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) {
    throw new InvalidRequestStateError("requestState is malformed");
  }
  const expected = mac(body);
  const given = Buffer.from(signature, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) {
    throw new InvalidRequestStateError("requestState failed verification");
  }

  let payload: StatePayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
  } catch {
    throw new InvalidRequestStateError("requestState is malformed");
  }
  if (payload.v !== STATE_VERSION) throw new InvalidRequestStateError("requestState is malformed");
  if (payload.sub !== binding.userId) {
    throw new InvalidRequestStateError("requestState was issued to a different user");
  }
  if (payload.tool !== binding.tool || payload.args !== digestArguments(binding.args)) {
    throw new InvalidRequestStateError("requestState was issued for a different request");
  }
  if (typeof payload.exp !== "number" || payload.exp <= now) {
    throw new InvalidRequestStateError("requestState has expired");
  }
  return { key: payload.key, fingerprint: payload.fp, nonce: payload.nonce };
}

/** Error for a state whose nonce was already redeemed (see mcp-shared-state). */
export const REQUEST_STATE_USED = "requestState has already been used";

/** Test hook: forget the derived signing key (e.g. after changing the env key). */
export function resetRequestStateKeyForTests(): void {
  cachedKey = null;
}
