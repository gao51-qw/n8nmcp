// POST { refresh_token, access_token? } → { access_token, expires_at, user }
// Moves a session the browser obtained outside the cookie flow into the
// HttpOnly cookie:
// - an implicit-flow email link (`#access_token=…&refresh_token=…`), and
// - a legacy JavaScript-readable session (localStorage or `sb-*` cookie),
//   whose access token has usually expired, so only its refresh token is sent.
// When an access token is given it must be valid (getUser) and belong to the
// same user. The refresh token is rotated immediately, so the copy that was
// exposed to JavaScript (or sat in the URL) stops working.
// A rejected exchange answers 401 and leaves any existing cookies alone.
import { apiJson, HttpError, readJsonBody, withApiErrors } from "@/lib/http/api-response.server";
import { assertSameOriginJson, limitByIp } from "@/lib/auth/request-guard.server";
import { exchangeBodySchema } from "@/lib/auth/schemas";
import { cookieContext, setSessionCookies } from "@/lib/auth/session-cookies.server";
import {
  anonAuthClient,
  authFailure,
  sessionBody,
  refreshWithDeadline,
} from "@/lib/auth/supabase-auth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const LINK_INVALID = "This sign-in link is invalid or has expired.";

function rejected(error: Parameters<typeof authFailure>[0]): HttpError {
  const failure = authFailure(error, LINK_INVALID);
  if (failure.status === 429 || failure.status >= 500) return failure;
  return new HttpError(401, "invalid_grant", LINK_INVALID);
}

export async function POST(request: Request) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const origin = assertSameOriginJson(request);
      limitByIp(request, "exchange");
      const body = exchangeBodySchema.parse(await readJsonBody(request));
      const auth = anonAuthClient();

      let expectedUserId: string | null = null;
      if (body.access_token) {
        const { data, error } = await auth.getUser(body.access_token);
        if (error || !data.user) throw rejected(error);
        expectedUserId = data.user.id;
      }

      const { data, error } = await refreshWithDeadline(auth, body.refresh_token);
      if (error || !data.session) throw rejected(error);
      if (expectedUserId && data.session.user.id !== expectedUserId) {
        throw new HttpError(401, "invalid_grant", LINK_INVALID);
      }

      return setSessionCookies(
        apiJson(sessionBody(data.session), { requestId }),
        data.session.refresh_token,
        cookieContext(origin),
      );
    },
    { invalidRequestMessage: LINK_INVALID, logEvent: "auth.exchange_failed" },
  );
}
