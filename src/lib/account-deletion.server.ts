import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type DeleteUserAccountOptions = {
  userId: string;
  includeAdminNotes?: boolean;
};

export class AccountDeletionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

const PAID_ACTIVE_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * Centralized hard-delete flow for user-owned data.
 * Keep this list in one place so new user-owned tables are not missed.
 * Tables keyed to auth.users with ON DELETE CASCADE (oauth_grants,
 * mcp_ephemeral_state, …) go with the auth user at the end.
 *
 * Every step must succeed before the auth user is deleted: Supabase returns
 * errors instead of throwing, and a silently failed delete would otherwise
 * leave data behind for an account that no longer exists.
 */
export async function deleteUserAccount({
  userId,
  includeAdminNotes = false,
}: DeleteUserAccountOptions): Promise<void> {
  const results = await Promise.all([
    supabaseAdmin.from("n8n_instances").delete().eq("user_id", userId),
    supabaseAdmin.from("platform_api_keys").delete().eq("user_id", userId),
    supabaseAdmin.from("chat_messages").delete().eq("user_id", userId),
    supabaseAdmin.from("chat_conversations").delete().eq("user_id", userId),
    supabaseAdmin.from("user_roles").delete().eq("user_id", userId),
    supabaseAdmin
      .from("profiles")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", userId),
    ...(includeAdminNotes
      ? [supabaseAdmin.from("admin_user_notes").delete().eq("user_id", userId)]
      : []),
  ]);
  const failed = results.filter((result) => result.error);
  if (failed.length > 0) {
    throw new Error(`Account data deletion failed in ${failed.length} step(s); auth user kept`);
  }

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    throw error;
  }
}

/**
 * Self-service deletion (GDPR erasure). The user confirms by typing their
 * email address. A paid subscription that is still running must be cancelled
 * first, so billing never outlives the account. The request is recorded in
 * account_deletion_requests before anything is deleted.
 */
export async function deleteOwnAccount(
  user: { userId: string; email: string | null },
  confirmEmail: unknown,
): Promise<void> {
  if (!user.email || typeof confirmEmail !== "string") {
    throw new AccountDeletionError("Type your account email address to confirm", 400);
  }
  if (confirmEmail.trim().toLowerCase() !== user.email.toLowerCase()) {
    throw new AccountDeletionError("The email address does not match this account", 400);
  }

  const { data: subscription, error: subscriptionError } = await supabaseAdmin
    .from("subscriptions")
    .select("tier,status")
    .eq("user_id", user.userId)
    .maybeSingle();
  if (subscriptionError) throw new AccountDeletionError("Could not check the subscription", 500);
  if (
    subscription &&
    subscription.tier !== "free" &&
    PAID_ACTIVE_STATUSES.has(subscription.status)
  ) {
    throw new AccountDeletionError(
      "Cancel your paid subscription before deleting the account",
      409,
    );
  }

  const { data: request, error: requestError } = await supabaseAdmin
    .from("account_deletion_requests")
    .insert({ user_id: user.userId, reason: "self-service" })
    .select("id")
    .single();
  if (requestError || !request) {
    throw new AccountDeletionError("Could not record the deletion request", 500);
  }

  await deleteUserAccount({ userId: user.userId });

  await supabaseAdmin
    .from("account_deletion_requests")
    .update({ processed_at: new Date().toISOString() })
    .eq("id", request.id);
}
