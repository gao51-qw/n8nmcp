// POST { email, password } → { access_token, expires_at, user }
// Signs in with Supabase server-side and stores the refresh token in the
// HttpOnly cookie; the browser keeps only the access token, in memory.
import { apiJson, readJsonBody, withApiErrors } from "@/lib/http/api-response.server";
import { assertSameOriginJson, limitByAccount, limitByIp } from "@/lib/auth/request-guard.server";
import { loginBodySchema } from "@/lib/auth/schemas";
import { cookieContext, setSessionCookies } from "@/lib/auth/session-cookies.server";
import { anonAuthClient, authFailure, sessionBody } from "@/lib/auth/supabase-auth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const origin = assertSameOriginJson(request);
      limitByIp(request, "login");
      const body = loginBodySchema.parse(await readJsonBody(request));
      limitByAccount("loginEmail", body.email);

      const { data, error } = await anonAuthClient().signInWithPassword(body);
      if (error || !data.session) throw authFailure(error, "Could not sign in.");

      return setSessionCookies(
        apiJson(sessionBody(data.session), { requestId }),
        data.session.refresh_token,
        cookieContext(origin),
      );
    },
    {
      invalidRequestMessage: "Enter your email address and password.",
      logEvent: "auth.login_failed",
    },
  );
}
