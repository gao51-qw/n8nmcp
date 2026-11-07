// POST {} (optionally with `Authorization: Bearer <access token>`) → { ok, revoked }
// Revokes the user's Supabase sessions (global scope, as the browser client
// did before) when possible, then always clears both HttpOnly cookies. A
// failed revoke never leaves the cookies behind.
import { apiJson, withApiErrors } from "@/lib/http/api-response.server";
import { log } from "@/lib/logger.server";
import { assertSameOriginJson, bearerToken, limitByIp } from "@/lib/auth/request-guard.server";
import {
  clearSessionCookies,
  cookieContext,
  readRefreshCookie,
} from "@/lib/auth/session-cookies.server";
import { anonAuthClient, refreshWithDeadline } from "@/lib/auth/supabase-auth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function revoke(request: Request): Promise<boolean> {
  try {
    limitByIp(request, "logout");
    const auth = anonAuthClient();
    let token = bearerToken(request);
    if (!token) {
      // No in-memory token (e.g. a stale tab): use the cookie to get one.
      const refreshToken = readRefreshCookie(request);
      if (refreshToken) {
        const { data } = await refreshWithDeadline(auth, refreshToken);
        token = data.session?.access_token ?? null;
      }
    }
    if (!token) return false;
    const { error } = await auth.admin.signOut(token, "global");
    return !error;
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const origin = assertSameOriginJson(request);
      const revoked = await revoke(request);
      if (!revoked) log.info("auth.logout_not_revoked", { requestId });
      return clearSessionCookies(
        apiJson({ ok: true, revoked }, { requestId }),
        cookieContext(origin),
      );
    },
    { logEvent: "auth.logout_failed" },
  );
}
