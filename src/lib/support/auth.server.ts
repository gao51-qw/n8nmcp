import { decodeJwt } from "jose";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { jsonError } from "@/lib/http/api-response.server";

export type SupportUser = {
  userId: string;
  email: string | null;
};

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

export async function requireSupportUser(request: Request): Promise<SupportUser> {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();

  if (!token) {
    throw unauthorized();
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

  return {
    userId: data.user.id,
    email: data.user.email ?? null,
  };
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
