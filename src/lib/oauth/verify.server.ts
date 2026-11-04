// Validates OAuth 2.1 access tokens issued by Supabase Auth for MCP clients.
//
// A token is accepted only when it is a JWT signed by the project's JWKS
// (ES256/RS256), from the configured issuer, unexpired, issued to an OAuth
// client (it carries `client_id`) and backed by an active row in
// public.oauth_grants. Plain Supabase session tokens (no client_id) are not
// MCP credentials. Every failure returns null so the caller answers 401.
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from "jose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger.server";
import {
  isOAuthEnabled,
  oauthAudience,
  oauthIssuer,
  oauthJwksUrl,
} from "@/lib/oauth/config.server";
import { isMcpScope, type McpScope } from "@/lib/oauth/scopes";

export type OAuthPrincipal = {
  userId: string;
  clientId: string;
  clientName: string;
  sessionId?: string;
  scopes: McpScope[];
};

const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const ALLOWED_ALGORITHMS = ["ES256", "RS256"];

let keyResolver: JWTVerifyGetKey | null = null;

function jwks(): JWTVerifyGetKey {
  if (!keyResolver) {
    keyResolver = createRemoteJWKSet(oauthJwksUrl(), {
      timeoutDuration: 5_000,
      cooldownDuration: 30_000,
      cacheMaxAge: 10 * 60_000,
    });
  }
  return keyResolver;
}

/** Test hook: use a local key set instead of fetching the project's JWKS. */
export function setJwksForTests(resolver: JWTVerifyGetKey | null): void {
  keyResolver = resolver;
}

export function looksLikeJwt(token: string): boolean {
  return JWT_SHAPE.test(token);
}

export async function verifyOAuthAccessToken(token: string): Promise<OAuthPrincipal | null> {
  if (!isOAuthEnabled() || !looksLikeJwt(token)) return null;

  let payload: Record<string, unknown>;
  try {
    ({ payload } = await jwtVerify(token, jwks(), {
      issuer: oauthIssuer(),
      audience: oauthAudience(),
      algorithms: ALLOWED_ALGORITHMS,
      requiredClaims: ["sub", "exp"],
    }));
  } catch (error) {
    log.warn("mcp.oauth.token_rejected", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }

  const userId = payload.sub;
  const clientId = payload.client_id;
  if (typeof userId !== "string" || !userId || typeof clientId !== "string" || !clientId) {
    return null;
  }

  const { data: grant, error } = await supabaseAdmin
    .from("oauth_grants")
    .select("id,client_name,scopes,revoked_at")
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .maybeSingle();
  if (error || !grant || grant.revoked_at) return null;

  // Query builders are lazy: .then() is what sends the request. Fire and forget.
  void supabaseAdmin
    .from("oauth_grants")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", grant.id)
    .then(undefined, () => undefined);

  return {
    userId,
    clientId,
    clientName: grant.client_name,
    sessionId: typeof payload.session_id === "string" ? payload.session_id : undefined,
    scopes: (grant.scopes ?? []).filter(isMcpScope),
  };
}
