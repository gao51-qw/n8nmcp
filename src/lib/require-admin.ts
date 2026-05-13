import { createMiddleware } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Server-fn middleware that ensures the caller is signed in AND has the
 * `admin` role. Returns 403 on missing role, 401 on missing auth.
 * Adds `userId` and `supabase` (RLS-bound) to context, same as
 * requireSupabaseAuth.
 */
export const requireAdmin = createMiddleware({ type: "function" })
  .middleware([requireSupabaseAuth])
  .server(async ({ next, context }) => {
    const { supabase, userId } = context;
    const { data, error } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });
    if (error) {
      console.error("[requireAdmin] has_role check failed", error);
      throw new Response("Forbidden", { status: 403 });
    }
    if (data !== true) {
      throw new Response("Forbidden", { status: 403 });
    }
    return next({ context });
  });