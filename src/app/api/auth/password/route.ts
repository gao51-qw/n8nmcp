// POST { password } with `Authorization: Bearer <access token>` → { ok: true }
// Sets a new password for the signed-in user (the reset-password flow, after
// the recovery link was exchanged). Supabase Auth's `PUT /user` applies its
// password policy; OAuth-client tokens are refused like on every dashboard API.
import { apiJson, HttpError, readJsonBody, withApiErrors } from "@/lib/http/api-response.server";
import { assertSameOriginJson, bearerToken, limitByIp } from "@/lib/auth/request-guard.server";
import { passwordBodySchema } from "@/lib/auth/schemas";
import { updatePasswordWithToken } from "@/lib/auth/supabase-auth.server";
import { requireSupportUser } from "@/lib/support/auth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      assertSameOriginJson(request);
      limitByIp(request, "password");
      const token = bearerToken(request);
      if (!token) throw new HttpError(401, "authentication_required", "Authentication required");
      // A password change must see a revocation at once: skip the short cache.
      await requireSupportUser(request, { fresh: true });
      const body = passwordBodySchema.parse(await readJsonBody(request));

      await updatePasswordWithToken(token, body.password);
      return apiJson({ ok: true }, { requestId });
    },
    {
      invalidRequestMessage: "Use a password of 8 to 72 characters.",
      logEvent: "auth.password_failed",
    },
  );
}
