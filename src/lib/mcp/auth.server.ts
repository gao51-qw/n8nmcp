// MCP bearer authentication (server-only).
// Auth: Bearer nmcp_<...> from `Authorization` header → SHA-256 → platform_api_keys lookup,
// or (when MCP_OAUTH_ENABLED=1) a Supabase Auth OAuth access token backed by oauth_grants.
import { hashPlatformApiKey } from "@/lib/crypto.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { grantedTier, type Tier } from "@/lib/tiers";
import { MCP_SCOPES } from "@/lib/oauth/scopes";
import { verifyOAuthAccessToken } from "@/lib/oauth/verify.server";
import { isMissingFunction } from "./postgrest";
import type { AuthedKey } from "./types";

export async function tierForUser(userId: string): Promise<Tier> {
  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("tier,status")
    .eq("user_id", userId)
    .maybeSingle();
  return effectiveTier(sub?.tier, sub?.status);
}

let warnedMissingAuthRpc = false;

/**
 * Resolves a platform key hash to its owner and effective tier. One database
 * round trip: authenticate_mcp_platform_key joins the subscription and touches
 * last_used_at (at most once a minute). Falls back to the two-query lookup
 * while the function is not deployed yet.
 */
async function lookupPlatformKey(
  hash: string,
): Promise<{ key_id: string; user_id: string; tier: Tier } | null> {
  const { data, error } = await supabaseAdmin.rpc("authenticate_mcp_platform_key", {
    _key_hash: hash,
  });
  if (!error) {
    const row = Array.isArray(data) ? data[0] : null;
    if (!row) return null;
    return { key_id: row.key_id, user_id: row.user_id, tier: effectiveTier(row.tier, row.status) };
  }
  if (!isMissingFunction(error)) {
    console.error("[mcp.auth] platform key lookup failed; rejecting the key", error);
    return null;
  }
  if (!warnedMissingAuthRpc) {
    warnedMissingAuthRpc = true;
    console.error(
      "[mcp.auth] authenticate_mcp_platform_key is missing; using the two-query key lookup until the migration is applied",
    );
  }

  const { data: key } = await supabaseAdmin
    .from("platform_api_keys")
    .select("id,user_id,revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (!key || key.revoked_at) return null;

  // Touch last_used_at, fire and forget. Query builders are lazy: .then() is
  // what sends the request, so a bare `void builder` would never run.
  void supabaseAdmin
    .from("platform_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", key.id)
    .then(undefined, () => undefined);

  return { key_id: key.id, user_id: key.user_id, tier: await tierForUser(key.user_id) };
}

export async function authenticateBearer(req: Request): Promise<AuthedKey | null> {
  const h = req.headers.get("authorization") ?? "";
  const bearer = h.match(/^Bearer\s+(\S+)$/)?.[1];
  if (!bearer) return null;
  if (!bearer.startsWith("nmcp_")) {
    const principal = await verifyOAuthAccessToken(bearer);
    if (!principal) return null;
    return {
      user_id: principal.userId,
      key_id: `oauth:${principal.clientId}`,
      tier: await tierForUser(principal.userId),
      auth_source: "oauth",
      client_id: principal.clientId,
      scopes: principal.scopes,
    };
  }
  const m = bearer.match(/^(nmcp_[A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const full = m[1];
  const key = await lookupPlatformKey(hashPlatformApiKey(full));
  if (!key) return null;

  return {
    user_id: key.user_id,
    key_id: key.key_id,
    tier: key.tier,
    auth_source: "api_key",
    scopes: MCP_SCOPES,
  };
}

// A paid tier only confers paid quota while the subscription is in good standing.
// past_due / canceled / paused / anything non-active collapses to `free`, so a
// user whose payment failed cannot keep hitting pro/enterprise MCP limits until
// Paddle eventually sends a cancellation event. The rule lives in `grantedTier`
// (src/lib/tiers.ts) so client-safe callers share it.
export function effectiveTier(
  tier: string | null | undefined,
  status: string | null | undefined,
): Tier {
  return grantedTier(tier, status);
}
