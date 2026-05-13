import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "@/lib/require-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

export type AdminUserRow = {
  id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  created_at: string;
  tier: "free" | "pro" | "enterprise";
  isAdmin: boolean;
  banned: boolean;
  callsToday: number;
  instances: number;
  tags: string[];
};

const ListInput = z.object({
  search: z.string().max(255).optional(),
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  sort: z.enum(["created_desc", "created_asc", "calls_desc"]).default("created_desc"),
});

export const adminListUsers = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) => ListInput.parse(d))
  .handler(async ({ data }) => {
    const today = new Date().toISOString().slice(0, 10);
    const ascending = data.sort === "created_asc";
    let q = supabaseAdmin
      .from("profiles")
      .select("id, email, display_name, avatar_url, created_at", { count: "exact" })
      .order("created_at", { ascending });
    if (data.search) {
      // Strip all PostgREST filter-structural characters to prevent .or() injection.
      // Keep only letters, numbers, spaces, and a small set of safe email/name chars.
      const safe = data.search.replace(/[^\w\s@.\-+]/g, "");
      const term = `%${safe}%`;
      q = q.or(`email.ilike.${term},display_name.ilike.${term}`);
    }
    const from = (data.page - 1) * data.pageSize;
    const to = from + data.pageSize - 1;
    const { data: profiles, count, error } = await q.range(from, to);
    if (error) {
      console.error("[adminListUsers]", error);
      throw new Response("Failed", { status: 500 });
    }
    const ids = (profiles ?? []).map((p) => p.id);
    if (ids.length === 0) {
      return { rows: [] as AdminUserRow[], total: count ?? 0 };
    }
    const [{ data: subs }, { data: usage }, { data: insts }, { data: roles }, { data: notes }, { data: bans }] =
      await Promise.all([
        supabaseAdmin.from("subscriptions").select("user_id, tier").in("user_id", ids),
        supabaseAdmin.from("usage_daily").select("user_id, mcp_calls").in("user_id", ids).eq("day", today),
        supabaseAdmin.from("n8n_instances").select("user_id").in("user_id", ids),
        supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids).eq("role", "admin"),
        supabaseAdmin.from("admin_user_notes").select("user_id, tags").in("user_id", ids),
        supabaseAdmin
          .schema("auth" as never)
          .from("users" as never)
          .select("id, banned_until")
          .in("id", ids),
      ]);
    const tierMap = new Map((subs ?? []).map((s) => [s.user_id, s.tier as AdminUserRow["tier"]]));
    const usageMap = new Map((usage ?? []).map((u) => [u.user_id, u.mcp_calls]));
    const instMap = new Map<string, number>();
    (insts ?? []).forEach((i) => instMap.set(i.user_id, (instMap.get(i.user_id) ?? 0) + 1));
    const adminSet = new Set((roles ?? []).map((r) => r.user_id));
    const tagsMap = new Map((notes ?? []).map((n) => [n.user_id, (n.tags ?? []) as string[]]));
    const banMap = new Map(
      ((bans as unknown as { id: string; banned_until: string | null }[]) ?? []).map((b) => [
        b.id,
        b.banned_until && new Date(b.banned_until).getTime() > Date.now(),
      ]),
    );

    let rows: AdminUserRow[] = (profiles ?? []).map((p) => ({
      id: p.id,
      email: p.email,
      display_name: p.display_name,
      avatar_url: p.avatar_url,
      created_at: p.created_at,
      tier: tierMap.get(p.id) ?? "free",
      isAdmin: adminSet.has(p.id),
      banned: !!banMap.get(p.id),
      callsToday: usageMap.get(p.id) ?? 0,
      instances: instMap.get(p.id) ?? 0,
      tags: tagsMap.get(p.id) ?? [],
    }));
    if (data.sort === "calls_desc") {
      rows = rows.sort((a, b) => b.callsToday - a.callsToday);
    }
    return { rows, total: count ?? rows.length };
  });

export const adminGetUserDetail = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) => z.object({ userId: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const userId = data.userId;
    const since = new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);
    const [profile, sub, instances, keys, usage, recentLogs, note, audit, authUser] =
      await Promise.all([
        supabaseAdmin.from("profiles").select("*").eq("id", userId).maybeSingle(),
        supabaseAdmin.from("subscriptions").select("*").eq("user_id", userId).maybeSingle(),
        supabaseAdmin
          .from("n8n_instances")
          .select("id,name,base_url,status,last_checked_at")
          .eq("user_id", userId),
        supabaseAdmin
          .from("platform_api_keys")
          .select("id,name,key_prefix,last_used_at,revoked_at,created_at")
          .eq("user_id", userId)
          .order("created_at", { ascending: false }),
        supabaseAdmin
          .from("usage_daily")
          .select("day, mcp_calls")
          .eq("user_id", userId)
          .gte("day", since)
          .order("day", { ascending: true }),
        supabaseAdmin
          .from("mcp_call_logs")
          .select("id, tool_name, status, latency_ms, created_at, error_message")
          .eq("user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabaseAdmin
          .from("admin_user_notes")
          .select("note, tags, updated_at, updated_by")
          .eq("user_id", userId)
          .maybeSingle(),
        supabaseAdmin
          .from("admin_audit_logs")
          .select("id, action, summary, changes, created_at, actor_id")
          .eq("target_user_id", userId)
          .order("created_at", { ascending: false })
          .limit(50),
        supabaseAdmin.auth.admin.getUserById(userId),
      ]);

    return {
      profile: profile.data,
      subscription: sub.data,
      instances: instances.data ?? [],
      apiKeys: keys.data ?? [],
      usage: usage.data ?? [],
      recentLogs: recentLogs.data ?? [],
      note: note.data,
      audit: audit.data ?? [],
      bannedUntil: authUser.data?.user?.banned_until ?? null,
      isAdmin: false,
    };
  });