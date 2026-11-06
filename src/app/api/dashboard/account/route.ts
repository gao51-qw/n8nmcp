// DELETE { confirm_email } → delete the signed-in user's account and data
// (self-service erasure). See deleteOwnAccount for the safeguards.
import { log } from "@/lib/logger.server";
import { requireSupportUser } from "@/lib/support/auth.server";
import { apiJson, readJsonObject, withApiErrors } from "@/lib/http/api-response.server";
import { AccountDeletionError, deleteOwnAccount } from "@/lib/account-deletion.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const user = await requireSupportUser(request);
      const body = await readJsonObject(request);
      await deleteOwnAccount(user, body?.confirm_email);
      log.info("account.deleted", { user_id: user.userId });
      return apiJson({ ok: true }, { requestId });
    },
    {
      expose: [AccountDeletionError],
      logEvent: "account.deletion_failed",
      internalMessage:
        "Account deletion did not finish and your sign-in still exists. Contact support.",
    },
  );
}
