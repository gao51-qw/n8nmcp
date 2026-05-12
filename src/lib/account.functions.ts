import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

/**
 * Returns a JSON dump of the authenticated user's data
 * (profile, instances, api keys metadata, usage). Honors RLS.
 */
export const exportMyData = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [profile, instances, apiKeys, usage, prompts, subscription] = await Promise.all([
      supabase.from("profiles").select("*").eq("id", userId).maybeSingle(),
      supabase
        .from("n8n_instances")
        .select("id,name,base_url,status,last_checked_at,created_at,updated_at"),
      supabase
        .from("platform_api_keys")
        .select("id,name,key_prefix,last_used_at,revoked_at,created_at"),
      supabase.from("usage_daily").select("day,mcp_calls"),
      supabase.from("prompt_usage_daily").select("day,prompts"),
      supabase.from("subscriptions").select("tier,status,current_period_end").maybeSingle(),
    ]);

    return {
      exported_at: new Date().toISOString(),
      user_id: userId,
      profile: profile.data,
      subscription: subscription.data,
      n8n_instances: instances.data ?? [],
      api_keys: apiKeys.data ?? [],
      usage_daily: usage.data ?? [],
      prompt_usage_daily: prompts.data ?? [],
    };
  });

/**
 * Records a GDPR-style deletion request (30-day grace period).
 */
export const requestAccountDeletion = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ reason: z.string().max(1000).optional() }).parse(d))
  .handler(async ({ context, data }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("account_deletion_requests")
      .insert({ user_id: userId, reason: data.reason ?? null });
    if (error) throw new Response(error.message, { status: 500 });
    return { ok: true };
  });

/**
 * Hard-deletes the authenticated user's account immediately.
 * Removes the auth user (CASCADE wipes profile/instances/keys/usage rows
 * via existing FK or RLS-bound rows that reference user_id).
 */
export const deleteAccountNow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    // Best-effort: clean up rows that don't have ON DELETE CASCADE on auth.users
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
    ]);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);
    if (error) throw new Response(error.message, { status: 500 });
    return { ok: true };
  });