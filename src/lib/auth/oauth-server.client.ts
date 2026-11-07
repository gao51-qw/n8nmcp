// Supabase Auth OAuth 2.1 server calls made by the signed-in user from the
// browser (the consent screen and "Connected apps"). They replace
// `supabase.auth.oauth.*`, which supabase-js disables once the client is
// configured with the in-memory `accessToken` option. Each call sends the
// current access token from the token store; nothing is persisted.
import { z } from "zod";
import { browserSupabaseConfig } from "@/integrations/supabase/client";
import { getAccessToken } from "./browser-session.client";

export type OAuthServerError = { message: string; status: number };
export type OAuthResult<T> = { data: T; error: null } | { data: null; error: OAuthServerError };

const redirectSchema = z.object({ redirect_url: z.string().url() });

const detailsSchema = z.object({
  authorization_id: z.string().min(1),
  redirect_uri: z.string(),
  client: z
    .object({ id: z.string(), name: z.string().default(""), uri: z.string().default("") })
    .passthrough(),
});

export type OAuthAuthorizationDetails = z.infer<typeof detailsSchema>;
export type OAuthRedirect = z.infer<typeof redirectSchema>;

const ID = /^[A-Za-z0-9._:-]{1,256}$/;

function failure(message: string, status: number): { data: null; error: OAuthServerError } {
  return { data: null, error: { message, status } };
}

async function call(
  method: "GET" | "POST" | "DELETE",
  path: string,
  body?: Record<string, unknown>,
): Promise<OAuthResult<unknown>> {
  const token = await getAccessToken();
  if (!token) return failure("Authentication required", 401);
  const { url, key } = browserSupabaseConfig();
  let response: Response;
  try {
    response = await fetch(`${url}/auth/v1${path}`, {
      method,
      cache: "no-store",
      credentials: "omit",
      headers: {
        apikey: key,
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    return failure("Could not reach the authorization server.", 0);
  }
  const json: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const record = (json ?? {}) as Record<string, unknown>;
    const message =
      (typeof record.msg === "string" && record.msg) ||
      (typeof record.message === "string" && record.message) ||
      `Request failed (${response.status})`;
    return failure(message.slice(0, 300), response.status);
  }
  return { data: json, error: null };
}

/** A pending request's details, or `{ redirect_url }` when consent was already given. */
export async function getAuthorizationDetails(
  authorizationId: string,
): Promise<OAuthResult<OAuthAuthorizationDetails | OAuthRedirect>> {
  if (!ID.test(authorizationId)) return failure("Invalid authorization request", 400);
  const result = await call("GET", `/oauth/authorizations/${encodeURIComponent(authorizationId)}`);
  if (result.error) return result;
  const details = detailsSchema.safeParse(result.data);
  if (details.success) return { data: details.data, error: null };
  const redirect = redirectSchema.safeParse(result.data);
  return redirect.success
    ? { data: redirect.data, error: null }
    : failure("Unexpected authorization server response", 502);
}

async function consent(
  authorizationId: string,
  action: "approve" | "deny",
): Promise<OAuthResult<OAuthRedirect>> {
  if (!ID.test(authorizationId)) return failure("Invalid authorization request", 400);
  const result = await call(
    "POST",
    `/oauth/authorizations/${encodeURIComponent(authorizationId)}/consent`,
    { action },
  );
  if (result.error) return result;
  const redirect = redirectSchema.safeParse(result.data);
  return redirect.success
    ? { data: redirect.data, error: null }
    : failure("Unexpected authorization server response", 502);
}

export function approveAuthorization(authorizationId: string) {
  return consent(authorizationId, "approve");
}

export function denyAuthorization(authorizationId: string) {
  return consent(authorizationId, "deny");
}

/** Ends the client's Supabase sessions and refresh tokens for this user. */
export async function revokeOAuthGrant(clientId: string): Promise<OAuthResult<object>> {
  if (!ID.test(clientId)) return failure("Invalid client", 400);
  const result = await call(
    "DELETE",
    `/user/oauth/grants?client_id=${encodeURIComponent(clientId)}`,
  );
  return result.error ? result : { data: {}, error: null };
}
