// POST {} → { access_token, expires_at, user }
// Rotates the HttpOnly refresh cookie and returns a fresh access token.
//   204: there is no refresh cookie (a signed-out visitor; not an error, so
//        anonymous page views do not log failed requests);
//   401: Supabase rejected the refresh token; both cookies are cleared;
//   429/502: rate limited or Supabase unavailable; the cookie is kept so an
//        outage does not sign everyone out.
import {
  apiJson,
  jsonError,
  NO_STORE_HEADERS,
  withApiErrors,
} from "@/lib/http/api-response.server";
import { assertSameOriginJson, limitByIp } from "@/lib/auth/request-guard.server";
import {
  clearSessionCookies,
  cookieContext,
  hasPresenceCookie,
  readRefreshCookie,
  setSessionCookies,
} from "@/lib/auth/session-cookies.server";
import {
  anonAuthClient,
  authFailure,
  sessionBody,
  refreshWithDeadline,
} from "@/lib/auth/supabase-auth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_ENDED = "Your session has ended. Sign in again.";

export async function POST(request: Request) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const origin = assertSameOriginJson(request);
      const context = cookieContext(origin);
      const refreshToken = readRefreshCookie(request);

      if (!refreshToken) {
        const response = new Response(null, {
          status: 204,
          headers: { ...NO_STORE_HEADERS, "x-request-id": requestId },
        });
        // A presence marker without a usable refresh cookie is stale.
        return hasPresenceCookie(request) ? clearSessionCookies(response, context) : response;
      }

      limitByIp(request, "refresh");
      const { data, error } = await refreshWithDeadline(anonAuthClient(), refreshToken);
      if (error || !data.session) {
        const failure = authFailure(error, SESSION_ENDED);
        if (failure.status === 429 || failure.status >= 500) throw failure;
        return clearSessionCookies(
          jsonError(401, "session_expired", SESSION_ENDED, { requestId }),
          context,
        );
      }

      return setSessionCookies(
        apiJson(sessionBody(data.session), { requestId }),
        data.session.refresh_token,
        context,
      );
    },
    { logEvent: "auth.refresh_failed" },
  );
}
