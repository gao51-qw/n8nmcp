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

/** Bucket the support widgets upload to; objects live at `<user id>/<ticket id>/<file>`. */
const ATTACHMENT_BUCKET = "ticket-attachments";
const STORAGE_PAGE = 100;

type DbError = { message?: string; code?: string } | null;
type DbStep = PromiseLike<{ error: unknown }>;

// support_tickets is not in the generated Supabase types; mirror the narrow
// structural access of src/lib/support/tickets.server.ts.
interface DeleteBuilder {
  delete(): { eq(column: string, value: unknown): DbStep };
}
type StorageEntry = { name: string; id: string | null };
interface StorageBucket {
  list(
    path: string,
    options?: { limit?: number; offset?: number },
  ): Promise<{ data: StorageEntry[] | null; error: DbError }>;
  remove(paths: string[]): Promise<{ data: unknown; error: DbError }>;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object") {
    const record = error as { message?: unknown; code?: unknown };
    const code = typeof record.code === "string" ? `${record.code} ` : "";
    return `${code}${typeof record.message === "string" ? record.message : "unknown error"}`;
  }
  return String(error);
}

async function listAll(bucket: StorageBucket, prefix: string): Promise<StorageEntry[]> {
  const entries: StorageEntry[] = [];
  for (let offset = 0; ; offset += STORAGE_PAGE) {
    const { data, error } = await bucket.list(prefix, { limit: STORAGE_PAGE, offset });
    if (error) throw new Error(`Support attachment listing failed: ${describeError(error)}`);
    entries.push(...(data ?? []));
    if (!data || data.length < STORAGE_PAGE) return entries;
  }
}

/**
 * Removes every object under `<userId>/` in the attachments bucket (one
 * folder per ticket). Ticket rows are gone by then, so nothing else refers to
 * these objects; a failure here keeps the sign-in so the user can retry.
 */
export async function removeSupportAttachments(userId: string): Promise<number> {
  const bucket = (supabaseAdmin.storage as unknown as { from(name: string): StorageBucket }).from(
    ATTACHMENT_BUCKET,
  );
  const paths: string[] = [];
  for (const entry of await listAll(bucket, userId)) {
    if (entry.id === null) {
      // Storage lists a folder as an entry without an id.
      for (const file of await listAll(bucket, `${userId}/${entry.name}`)) {
        if (file.id !== null) paths.push(`${userId}/${entry.name}/${file.name}`);
      }
    } else {
      paths.push(`${userId}/${entry.name}`);
    }
  }
  for (let index = 0; index < paths.length; index += STORAGE_PAGE) {
    const { error } = await bucket.remove(paths.slice(index, index + STORAGE_PAGE));
    if (error) throw new Error(`Support attachment removal failed: ${describeError(error)}`);
  }
  return paths.length;
}

/**
 * Centralized hard-delete flow for user-owned data.
 * Keep this list in one place so new user-owned tables are not missed.
 * Tables keyed to auth.users with ON DELETE CASCADE (oauth_grants,
 * mcp_ephemeral_state, usage_daily, mcp_call_logs, workflow_audit_log, …) go
 * with the auth user at the end. n8n_instances is one of them on purpose: the
 * database rejects plain DELETEs of its rows (they go through
 * delete_n8n_instance() so the default-instance locks keep one order) and
 * lets only that cascade through. support_tickets has no foreign key to
 * auth.users, so it is deleted here explicitly; its replies, tags, internal
 * notes, events and attachment claims cascade from the ticket rows, and the
 * uploaded attachment objects are removed from storage afterwards. What a
 * support agent wrote on other users' tickets (tags, internal notes, events)
 * stays with those tickets and loses its author instead
 * (20261108090000_support_actor_references_set_null), so staff accounts
 * can be deleted too.
 *
 * Every step must succeed before the auth user is deleted: Supabase returns
 * errors instead of throwing, and a silently failed delete would otherwise
 * leave data behind for an account that no longer exists.
 */
export async function deleteUserAccount({
  userId,
  includeAdminNotes = false,
}: DeleteUserAccountOptions): Promise<void> {
  const untyped = supabaseAdmin as unknown as { from(table: string): DeleteBuilder };
  const steps: Array<[table: string, step: DbStep]> = [
    ["platform_api_keys", supabaseAdmin.from("platform_api_keys").delete().eq("user_id", userId)],
    ["chat_messages", supabaseAdmin.from("chat_messages").delete().eq("user_id", userId)],
    ["chat_conversations", supabaseAdmin.from("chat_conversations").delete().eq("user_id", userId)],
    ["user_roles", supabaseAdmin.from("user_roles").delete().eq("user_id", userId)],
    ["support_tickets", untyped.from("support_tickets").delete().eq("user_id", userId)],
    [
      "profiles",
      supabaseAdmin
        .from("profiles")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", userId),
    ],
    ...(includeAdminNotes
      ? [
          [
            "admin_user_notes",
            supabaseAdmin.from("admin_user_notes").delete().eq("user_id", userId),
          ] as [string, DbStep],
        ]
      : []),
  ];
  const results = await Promise.all(
    steps.map(async ([table, step]) => [table, await step] as const),
  );
  const failed = results.filter(([, result]) => result.error);
  if (failed.length > 0) {
    const detail = failed
      .map(([table, result]) => `${table}: ${describeError(result.error)}`)
      .join("; ");
    throw new Error(
      `Account data deletion failed in ${failed.length} step(s); auth user kept (${detail})`,
    );
  }

  await removeSupportAttachments(userId);

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
