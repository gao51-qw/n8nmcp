import { createHash } from "node:crypto";
import { decodeJwt } from "jose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createExpiringStore } from "@/lib/expiring-store";
import { jsonError } from "@/lib/http/api-response.server";

export type SupportUser = {
  userId: string;
  email: string | null;
};

export type RequireUserOptions = {
  /**
   * Verify with Supabase Auth even when the token was verified a moment ago.
   * For routes that act on the sign-in itself (account deletion, password
   * change), where a session revoked seconds ago must already be refused.
   */
  fresh?: boolean;
};

/**
 * Verified tokens are remembered briefly. One dashboard page issues several
 * API calls within a second, and each cost a Supabase Auth round trip (all
 * from the VPS's single IP, which Supabase rate-limits). A session revoked
 * elsewhere is refused once its entry expires, at most USER_CACHE_TTL_MS
 * later; the entry never outlives the token's own `exp`.
 */
const USER_CACHE_TTL_MS = 60_000;
let verifiedUsers = createExpiringStore<SupportUser>({ maxEntries: 10_000 });

/** Test hook: forget every verified token. */
export function resetSupportUserCache(): void {
  verifiedUsers = createExpiringStore<SupportUser>({ maxEntries: 10_000 });
}

// Thrown Responses use the shared JSON error shape. Route handlers usually
// remap them by status (withApiErrors, supportRouteError) to add a request id;
// a handler that returns the thrown Response as-is still sends valid JSON.
function unauthorized(): Response {
  return jsonError(401, "authentication_required", "Authentication required");
}

function forbidden(): Response {
  return jsonError(403, "forbidden", "Forbidden");
}

/** The token was already validated by getUser; this only reads its claims. */
function issuedToOAuthClient(token: string): boolean {
  try {
    const clientId = decodeJwt(token).client_id;
    return typeof clientId === "string" && clientId.length > 0;
  } catch {
    // Supabase access tokens are always JWTs; anything else fails closed.
    return true;
  }
}

/** Milliseconds until the token's `exp`, or 0 when it is missing or unreadable. */
function tokenLifetimeMs(token: string, now: number): number {
  try {
    const exp = decodeJwt(token).exp;
    return typeof exp === "number" ? Math.max(0, exp * 1000 - now) : 0;
  } catch {
    return 0;
  }
}

function cacheKey(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function requireSupportUser(
  request: Request,
  options: RequireUserOptions = {},
): Promise<SupportUser> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (!token) {
    throw unauthorized();
  }

  const key = cacheKey(token);
  if (!options.fresh) {
    const cached = verifiedUsers.get(key);
    if (cached) return cached;
  }

  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) {
    throw unauthorized();
  }

  // Access tokens issued to OAuth clients (MCP agents) carry `client_id`. They
  // are scoped MCP credentials, not dashboard sessions, so they must not reach
  // dashboard or support APIs — e.g. to widen their own grant.
  if (issuedToOAuthClient(token)) {
    throw unauthorized();
  }

  const user: SupportUser = {
    userId: data.user.id,
    email: data.user.email ?? null,
  };
  const now = Date.now();
  const ttl = Math.min(USER_CACHE_TTL_MS, tokenLifetimeMs(token, now));
  if (ttl > 0) verifiedUsers.set(key, user, ttl, now);
  return user;
}

export async function requireSupportAdmin(request: Request): Promise<SupportUser> {
  const user = await requireSupportUser(request);
  const { data, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error || !data) {
    throw forbidden();
  }

  return user;
}
