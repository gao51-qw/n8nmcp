import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Returns whether the authenticated user has the `admin` role.
 * Verification happens entirely server-side using the JWT from the request,
 * so a malicious client cannot fake the result by patching local state.
 */
export const getAdminStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ isAdmin: boolean; userId: string }> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (error) throw new Response(error.message, { status: 500 });
    return { isAdmin: data === true, userId };
  });
