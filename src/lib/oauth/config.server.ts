// OAuth 2.1 settings for the MCP resource server.
//
// Supabase Auth's OAuth 2.1 Server is the authorization server; this app only
// validates the access tokens it issues. OAuth is off unless
// MCP_OAUTH_ENABLED=1, so nothing changes until the Supabase project has the
// OAuth server, dynamic client registration and an asymmetric signing key
// configured (roadmap Phase 2, Task 2.0).
import { MCP_ENDPOINT_URL } from "@/lib/site-domains";

export function isOAuthEnabled(): boolean {
  return process.env.MCP_OAUTH_ENABLED === "1";
}

/** Issuer of Supabase Auth access tokens, e.g. https://<ref>.supabase.co/auth/v1. */
export function oauthIssuer(): string {
  const explicit = process.env.MCP_OAUTH_ISSUER?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");
  const base = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "").trim();
  if (!base) throw new Error("SUPABASE_URL is required to derive the OAuth issuer");
  return `${base.replace(/\/+$/, "")}/auth/v1`;
}

export function oauthJwksUrl(): URL {
  return new URL(`${oauthIssuer()}/.well-known/jwks.json`);
}

/**
 * Required `aud` for OAuth access tokens. Supabase issues `authenticated` by
 * default; set MCP_OAUTH_AUDIENCE when a Custom Access Token Hook narrows the
 * audience to the MCP resource.
 */
export function oauthAudience(): string | undefined {
  return process.env.MCP_OAUTH_AUDIENCE?.trim() || undefined;
}

/** Canonical URI of the protected resource (the MCP endpoint). */
export function mcpResource(): string {
  return MCP_ENDPOINT_URL;
}

/**
 * RFC 9728 metadata URL for the MCP endpoint: the well-known path is inserted
 * between the origin and the resource path (…/.well-known/oauth-protected-resource/mcp).
 */
export function protectedResourceMetadataUrl(): string {
  const resource = new URL(mcpResource());
  const path = resource.pathname === "/" ? "" : resource.pathname;
  return `${resource.origin}/.well-known/oauth-protected-resource${path}`;
}
