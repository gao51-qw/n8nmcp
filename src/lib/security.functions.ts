import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

export type SessionRow = {
  id: string;
  created_at: string | null;
  updated_at: string | null;
  user_agent: string | null;
  ip: string | null;
  not_after: string | null;
};

/**
 * Verify the user's current password by attempting a temp sign-in with a
 * non-persisting client, then update the password via admin API. We do this
 * server-side so the user's main session token isn't rotated mid-request.
 */
export const changePassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        currentPassword: z.string().min(1),
        newPassword: z.string().min(8).max(128),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    const { userId } = context;
    const { data: userRes, error: getErr } = await supabaseAdmin.auth.admin.getUserById(userId);
    if (getErr || !userRes?.user?.email) {
      throw new Response("Cannot verify account", { status: 400 });
    }
    const tmp = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_PUBLISHABLE_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error: signErr } = await tmp.auth.signInWithPassword({
      email: userRes.user.email,
      password: data.currentPassword,
    });
    if (signErr) {
      throw new Response("Current password is incorrect", { status: 400 });
    }
    const { error: updErr } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: data.newPassword,
    });
    if (updErr) {
      console.error("[changePassword] update failed", updErr);
      throw new Response("Failed to update password", { status: 500 });
    }
    return { ok: true };
  });

/**
 * List active refresh-token sessions for the current user.
 * Uses the admin client to read auth.sessions (not exposed via RLS).
 */
export const listMySessions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data, error } = await supabaseAdmin
      .schema("auth" as never)
      .from("sessions" as never)
      .select("id, created_at, updated_at, user_agent, ip, not_after")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });
    if (error) {
      console.error("[listMySessions]", error);
      return { sessions: [] as SessionRow[] };
    }
    return { sessions: (data as unknown as SessionRow[]) ?? [] };
  });

export const revokeMySession = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ sessionId: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { userId } = context;
    // Verify ownership before delete
    const { data: row } = await supabaseAdmin
      .schema("auth" as never)
      .from("sessions" as never)
      .select("user_id")
      .eq("id", data.sessionId)
      .maybeSingle();
    if (!row || (row as { user_id: string }).user_id !== userId) {
      throw new Response("Not found", { status: 404 });
    }
    const { error } = await supabaseAdmin
      .schema("auth" as never)
      .from("sessions" as never)
      .delete()
      .eq("id", data.sessionId);
    if (error) {
      console.error("[revokeMySession]", error);
      throw new Response("Failed", { status: 500 });
    }
    return { ok: true };
  });

export const revokeAllOtherSessions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId, claims } = context;
    const currentSessionId = (claims as { session_id?: string }).session_id;
    let q = supabaseAdmin
      .schema("auth" as never)
      .from("sessions" as never)
      .delete()
      .eq("user_id", userId);
    if (currentSessionId) {
      q = q.neq("id", currentSessionId);
    }
    const { error } = await q;
    if (error) {
      console.error("[revokeAllOtherSessions]", error);
      throw new Response("Failed", { status: 500 });
    }
    return { ok: true };
  });

/**
 * Trigger an email-change confirmation. Supabase sends a confirm link to the
 * new address; the change only takes effect once confirmed.
 */
export const requestEmailChange = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z.object({ newEmail: z.string().email().max(255) }).parse(d),
  )
  .handler(async ({ context, data }) => {
    const { supabase } = context;
    const { error } = await supabase.auth.updateUser({ email: data.newEmail });
    if (error) {
      throw new Response(error.message, { status: 400 });
    }
    return { ok: true };
  });

/**
 * Lists OAuth identities linked to the current account (Google, etc.).
 */
export const listMyIdentities = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { userId } = context;
    const { data } = await supabaseAdmin.auth.admin.getUserById(userId);
    const identities = (data?.user?.identities ?? []).map((i) => ({
      id: i.identity_id ?? i.id,
      provider: i.provider,
      email: (i.identity_data as { email?: string } | null)?.email ?? null,
      created_at: i.created_at ?? null,
      last_sign_in_at: i.last_sign_in_at ?? null,
    }));
    return { identities };
  });