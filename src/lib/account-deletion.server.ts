import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type DeleteUserAccountOptions = {
  userId: string;
  includeAdminNotes?: boolean;
};

/**
 * Centralized hard-delete flow for user-owned data.
 * Keep this list in one place so new user-owned tables are not missed.
 */
export async function deleteUserAccount({
  userId,
  includeAdminNotes = false,
}: DeleteUserAccountOptions): Promise<void> {
  await Promise.all([
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

  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
  if (error) {
    throw error;
  }
}
