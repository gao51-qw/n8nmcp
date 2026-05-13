import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "@/lib/require-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

const TIERS = ["free", "pro", "enterprise"] as const;

async function audit(
  actorId: string,
  targetUserId: string | null,
  action: string,
  summary: string,
  changes: Record<string, unknown> = {},
) {
  const { error } = await supabaseAdmin.from("admin_audit_logs").insert({
    actor_id: actorId,
    target_user_id: targetUserId,
    action,
    summary,
    // Cast: jsonb column accepts any JSON-serializable value at runtime; the
    // generated type narrows to Json which is structurally stricter.
    changes: changes as never,
  });
  if (error) console.error("[admin audit log]", error);
}

export const adminSetTier = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) =>
    z.object({ userId: z.string().uuid(), tier: z.enum(TIERS) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.rpc("admin_set_user_tier", {
      _target_user_id: data.userId,
      _tier: data.tier,
    });
    if (error) {
      console.error("[adminSetTier]", error);
      throw new Response("Failed", { status: 500 });
    }
    await audit(context.userId, data.userId, "set_tier", `Set tier to ${data.tier}`, {
      tier: data.tier,
    });
    return { ok: true };
  });

export const adminGrantAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.rpc("admin_grant_role", {
      _target_user_id: data.userId,
      _role: "admin",
    });
    if (error) throw new Response("Failed", { status: 500 });
    await audit(context.userId, data.userId, "grant_admin", "Granted admin role");
    return { ok: true };
  });

export const adminRevokeAdmin = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    if (data.userId === context.userId) {
      throw new Response("Cannot revoke your own admin role", { status: 400 });
    }
    const { error } = await supabaseAdmin.rpc("admin_revoke_role", {
      _target_user_id: data.userId,
      _role: "admin",
    });
    if (error) throw new Response("Failed", { status: 500 });
    await audit(context.userId, data.userId, "revoke_admin", "Revoked admin role");
    return { ok: true };
  });

export const adminBanUser = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) =>
    z
      .object({
        userId: z.string().uuid(),
        // Supabase ban_duration: 'none' to unban, '8760h' = 1 year, etc.
        durationHours: z.number().int().min(1).max(24 * 365 * 10).nullable(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    if (data.userId === context.userId) {
      throw new Response("Cannot ban yourself", { status: 400 });
    }
    const ban_duration = data.durationHours === null ? "none" : `${data.durationHours}h`;
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.userId, {
      ban_duration,
    });
    if (error) {
      console.error("[adminBanUser]", error);
      throw new Response("Failed", { status: 500 });
    }
    await audit(
      context.userId,
      data.userId,
      data.durationHours === null ? "unban" : "ban",
      data.durationHours === null ? "Unbanned user" : `Banned for ${data.durationHours}h`,
      { duration: ban_duration },
    );
    return { ok: true };
  });

export const adminResetPassword = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: u } = await supabaseAdmin.auth.admin.getUserById(data.userId);
    if (!u?.user?.email) throw new Response("User has no email", { status: 400 });
    const { error } = await supabaseAdmin.auth.admin.generateLink({
      type: "recovery",
      email: u.user.email,
    });
    if (error) {
      console.error("[adminResetPassword]", error);
      throw new Response("Failed", { status: 500 });
    }
    await audit(context.userId, data.userId, "reset_password", "Sent password reset email");
    return { ok: true };
  });

export const adminForceSignOut = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.auth.admin.signOut(data.userId, "global");
    if (error) throw new Response("Failed", { status: 500 });
    await audit(context.userId, data.userId, "force_sign_out", "Forced global sign-out");
    return { ok: true };
  });

export const adminDeleteUser = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    if (data.userId === context.userId) {
      throw new Response("Use the user-facing delete flow on your own account", { status: 400 });
    }
    await Promise.all([
      supabaseAdmin.from("n8n_instances").delete().eq("user_id", data.userId),
      supabaseAdmin.from("platform_api_keys").delete().eq("user_id", data.userId),
      supabaseAdmin.from("chat_messages").delete().eq("user_id", data.userId),
      supabaseAdmin.from("chat_conversations").delete().eq("user_id", data.userId),
      supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId),
      supabaseAdmin.from("admin_user_notes").delete().eq("user_id", data.userId),
      supabaseAdmin
        .from("profiles")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", data.userId),
    ]);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.userId);
    if (error) {
      console.error("[adminDeleteUser]", error);
      throw new Response("Failed", { status: 500 });
    }
    await audit(context.userId, data.userId, "delete_user", "Deleted user account");
    return { ok: true };
  });

export const adminProcessDeletionRequest = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) =>
    z
      .object({
        requestId: z.string().uuid(),
        decision: z.enum(["approve", "dismiss"]),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { data: req } = await supabaseAdmin
      .from("account_deletion_requests")
      .select("user_id, processed_at")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!req) throw new Response("Not found", { status: 404 });
    if (req.processed_at) throw new Response("Already processed", { status: 400 });
    if (data.decision === "approve") {
      // Reuse delete logic
      await Promise.all([
        supabaseAdmin.from("n8n_instances").delete().eq("user_id", req.user_id),
        supabaseAdmin.from("platform_api_keys").delete().eq("user_id", req.user_id),
        supabaseAdmin.from("chat_messages").delete().eq("user_id", req.user_id),
        supabaseAdmin.from("chat_conversations").delete().eq("user_id", req.user_id),
        supabaseAdmin.from("user_roles").delete().eq("user_id", req.user_id),
        supabaseAdmin.from("admin_user_notes").delete().eq("user_id", req.user_id),
        supabaseAdmin
          .from("profiles")
          .update({ deleted_at: new Date().toISOString() })
          .eq("id", req.user_id),
      ]);
      const { error } = await supabaseAdmin.auth.admin.deleteUser(req.user_id);
      if (error) {
        console.error("[adminProcessDeletionRequest]", error);
        throw new Response("Failed", { status: 500 });
      }
    }
    await supabaseAdmin
      .from("account_deletion_requests")
      .update({ processed_at: new Date().toISOString() })
      .eq("id", data.requestId);
    await audit(
      context.userId,
      req.user_id,
      data.decision === "approve" ? "approve_deletion" : "dismiss_deletion",
      data.decision === "approve" ? "Approved deletion request" : "Dismissed deletion request",
    );
    return { ok: true };
  });

export const adminUpsertNote = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) =>
    z
      .object({
        userId: z.string().uuid(),
        note: z.string().max(4000),
        tags: z.array(z.string().min(1).max(40).regex(/^[a-z0-9_-]+$/i)).max(20),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { error } = await supabaseAdmin.from("admin_user_notes").upsert(
      {
        user_id: data.userId,
        note: data.note,
        tags: data.tags,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    if (error) {
      console.error("[adminUpsertNote]", error);
      throw new Response("Failed", { status: 500 });
    }
    await audit(context.userId, data.userId, "update_note", "Updated user note", {
      tags: data.tags,
    });
    return { ok: true };
  });