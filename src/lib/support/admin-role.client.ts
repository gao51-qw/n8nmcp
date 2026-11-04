import { supabase } from "@/integrations/supabase/client";

/**
 * Browser-side check for the support admin role. Row-level security on
 * `user_roles` lets a user read only their own rows, so this can never reveal
 * another user's role. The API routes keep their own server-side
 * `requireSupportAdmin` check; this only decides whether to render the admin
 * UI shell at all. Any error fails closed.
 */
export async function hasSupportAdminRole(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  return !error && data?.role === "admin";
}
