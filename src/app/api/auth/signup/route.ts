// POST { email, password, next? }
//   → { confirmation_required: true }                       (email confirmation on)
//   → { access_token, expires_at, user, confirmation_required: false }
// The confirmation email links to /auth/callback on this origin, which
// exchanges the implicit-flow fragment for the HttpOnly cookie.
import { apiJson, readJsonBody, withApiErrors } from "@/lib/http/api-response.server";
import { assertSameOriginJson, limitByIp } from "@/lib/auth/request-guard.server";
import { signupBodySchema } from "@/lib/auth/schemas";
import { cookieContext, setSessionCookies } from "@/lib/auth/session-cookies.server";
import { anonAuthClient, authFailure, sessionBody } from "@/lib/auth/supabase-auth.server";
import { authRedirectUrl } from "@/lib/site-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const origin = assertSameOriginJson(request);
      limitByIp(request, "signup");
      const body = signupBodySchema.parse(await readJsonBody(request));

      const { data, error } = await anonAuthClient().signUp({
        email: body.email,
        password: body.password,
        options: { emailRedirectTo: authRedirectUrl(body.next, origin.origin) },
      });
      if (error) throw authFailure(error, "Could not create the account.");

      // Supabase answers the same way for an address that is already
      // registered, so this never reveals which it was.
      if (!data.session) return apiJson({ confirmation_required: true }, { requestId });

      return setSessionCookies(
        apiJson({ ...sessionBody(data.session), confirmation_required: false }, { requestId }),
        data.session.refresh_token,
        cookieContext(origin),
      );
    },
    {
      invalidRequestMessage: "Enter a valid email address and a password of 8 to 72 characters.",
      logEvent: "auth.signup_failed",
    },
  );
}
