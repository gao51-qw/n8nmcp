// DELETE { confirm_email } → delete the signed-in user's account and data
// (self-service erasure). See deleteOwnAccount for the safeguards.
import { log } from "@/lib/logger.server";
import { requireSupportUser } from "@/lib/support/auth.server";
import { AccountDeletionError, deleteOwnAccount } from "@/lib/account-deletion.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex,nofollow" };

export async function DELETE(request: Request) {
  try {
    const user = await requireSupportUser(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    await deleteOwnAccount(user, body?.confirm_email);
    log.info("account.deleted", { user_id: user.userId });
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof AccountDeletionError) {
      return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    }
    log.error("account.deletion_failed", {
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return Response.json(
      { error: "Account deletion did not finish and your sign-in still exists. Contact support." },
      { status: 500, headers: NO_STORE },
    );
  }
}
