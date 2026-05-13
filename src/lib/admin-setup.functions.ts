import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

/** Public: check whether ANY admin exists. No auth required. */
export const adminBootstrapStatus = createServerFn({ method: "GET" }).handler(
  async () => {
    const { count, error } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (error) {
      console.error("[adminBootstrapStatus]", error);
      throw new Response("Failed to check admin status", { status: 500 });
    }
    return { hasAdmin: (count ?? 0) > 0 };
  },
);

/**
 * Claim the first admin role. Only succeeds when NO admin exists yet.
 * The currently authenticated user becomes the first admin.
 */
export const claimFirstAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;

    // Re-check with service role to avoid race + RLS visibility gaps.
    const { count, error: countErr } = await supabaseAdmin
      .from("user_roles")
      .select("id", { count: "exact", head: true })
      .eq("role", "admin");
    if (countErr) {
      console.error("[claimFirstAdmin] count", countErr);
      throw new Response("Failed to verify admin state", { status: 500 });
    }
    if ((count ?? 0) > 0) {
      throw new Response("An admin already exists", { status: 409 });
    }

    const { error: insErr } = await supabaseAdmin
      .from("user_roles")
      .insert({ user_id: userId, role: "admin" });
    if (insErr) {
      console.error("[claimFirstAdmin] insert", insErr);
      throw new Response("Failed to grant admin role", { status: 500 });
    }

    // Best-effort audit log.
    await supabaseAdmin.from("admin_audit_logs").insert({
      actor_id: userId,
      target_user_id: userId,
      action: "first_admin_claimed",
      summary: "Bootstrap: first admin role granted via /admin-setup",
      changes: {},
    });

    return { ok: true };
  });