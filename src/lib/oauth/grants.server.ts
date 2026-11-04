// MCP grants per (user, OAuth client): which scopes the user allowed on the
// consent page and whether they have revoked the client since.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { isMcpScope, type McpScope } from "@/lib/oauth/scopes";

export type OAuthGrantRow = {
  client_id: string;
  client_name: string;
  scopes: McpScope[];
  granted_at: string;
  last_used_at: string | null;
};

export type AuthorizationDetails = {
  authorizationId: string;
  userId: string;
  client: { id: string; name: string };
  redirectUri: string;
};

export class GrantError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

const AUTHORIZATION_ID = /^[A-Za-z0-9_-]{1,128}$/;
const CLIENT_ID = /^[A-Za-z0-9._:-]{1,256}$/;

function supabaseAuthUrl(): string {
  const base = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!base) throw new GrantError("Supabase is not configured", 500);
  return `${base.replace(/\/+$/, "")}/auth/v1`;
}

function supabaseApiKey(): string {
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new GrantError("Supabase is not configured", 500);
  return key;
}

export function parseScopes(value: unknown): McpScope[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new GrantError("Choose at least one permission", 400);
  }
  if (!value.every(isMcpScope)) throw new GrantError("Unknown permission requested", 400);
  return [...new Set(value)];
}

export function assertClientId(value: unknown): string {
  if (typeof value !== "string" || !CLIENT_ID.test(value)) {
    throw new GrantError("Invalid client_id", 400);
  }
  return value;
}

/**
 * Loads a pending authorization from Supabase Auth as the signed-in user.
 * Done server-side so the client id and name recorded in oauth_grants come
 * from Supabase, not from the browser.
 */
export async function fetchAuthorizationDetails(
  authorizationId: unknown,
  userAccessToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<AuthorizationDetails> {
  if (typeof authorizationId !== "string" || !AUTHORIZATION_ID.test(authorizationId)) {
    throw new GrantError("Invalid authorization_id", 400);
  }
  const response = await fetchImpl(
    `${supabaseAuthUrl()}/oauth/authorizations/${encodeURIComponent(authorizationId)}`,
    {
      headers: {
        apikey: supabaseApiKey(),
        authorization: `Bearer ${userAccessToken}`,
        accept: "application/json",
      },
      cache: "no-store",
    },
  );
  if (!response.ok) {
    throw new GrantError("Authorization request not found or expired", 404);
  }
  const body = (await response.json()) as Record<string, unknown>;
  const client = body.client as Record<string, unknown> | undefined;
  const user = body.user as Record<string, unknown> | undefined;
  if (
    typeof body.authorization_id !== "string" ||
    typeof client?.id !== "string" ||
    typeof user?.id !== "string"
  ) {
    // Already-consented requests come back as { redirect_url } only.
    throw new GrantError("Authorization request has already been answered", 409);
  }
  return {
    authorizationId: body.authorization_id,
    userId: user.id,
    client: { id: client.id, name: typeof client.name === "string" ? client.name : "" },
    redirectUri: typeof body.redirect_uri === "string" ? body.redirect_uri : "",
  };
}

export async function recordGrant(
  userId: string,
  details: AuthorizationDetails,
  scopes: McpScope[],
): Promise<void> {
  if (details.userId !== userId) {
    throw new GrantError("Authorization request belongs to another user", 403);
  }
  const { error } = await supabaseAdmin.from("oauth_grants").upsert(
    {
      user_id: userId,
      client_id: details.client.id,
      client_name: details.client.name.slice(0, 200),
      scopes,
      granted_at: new Date().toISOString(),
      revoked_at: null,
    },
    { onConflict: "user_id,client_id" },
  );
  if (error) throw new GrantError("Could not save the permission", 500);
}

export async function listGrants(userId: string): Promise<OAuthGrantRow[]> {
  const { data, error } = await supabaseAdmin
    .from("oauth_grants")
    .select("client_id,client_name,scopes,granted_at,last_used_at")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .order("granted_at", { ascending: false });
  if (error) throw new GrantError("Could not load connected apps", 500);
  return (data ?? []).map((row) => ({ ...row, scopes: (row.scopes ?? []).filter(isMcpScope) }));
}

/** Revokes immediately: the verifier rejects tokens for a revoked grant. */
export async function revokeGrant(userId: string, clientId: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from("oauth_grants")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("client_id", clientId)
    .is("revoked_at", null);
  if (error) throw new GrantError("Could not revoke the app", 500);
}
