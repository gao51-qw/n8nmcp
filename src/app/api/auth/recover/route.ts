// POST { email, next? } → { ok: true }
// Sends the password-reset email. The link lands on /reset-password on this
// origin, which exchanges its fragment for the HttpOnly cookie. The answer is
// the same whether or not the address has an account.
import { apiJson, readJsonBody, withApiErrors } from "@/lib/http/api-response.server";
import { assertSameOriginJson, limitByAccount, limitByIp } from "@/lib/auth/request-guard.server";
import { recoverBodySchema, resetPasswordPath } from "@/lib/auth/schemas";
import { anonAuthClient, authFailure } from "@/lib/auth/supabase-auth.server";
import { authRedirectUrl } from "@/lib/site-navigation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const origin = assertSameOriginJson(request);
      limitByIp(request, "recover");
      const body = recoverBodySchema.parse(await readJsonBody(request));
      limitByAccount("recoverEmail", body.email);

      const { error } = await anonAuthClient().resetPasswordForEmail(body.email, {
        redirectTo: authRedirectUrl(resetPasswordPath(body.next), origin.origin),
      });
      if (error) throw authFailure(error, "Could not send the reset email.");

      return apiJson({ ok: true }, { requestId });
    },
    { invalidRequestMessage: "Enter a valid email address.", logEvent: "auth.recover_failed" },
  );
}
