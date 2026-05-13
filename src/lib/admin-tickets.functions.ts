import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "@/lib/require-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";
import type { TicketRow } from "@/lib/tickets.functions";

const ListInput = z.object({
  status: z.enum(["all", "open", "in_progress", "waiting_user", "resolved", "closed"]).default("all"),
  search: z.string().max(255).optional(),
});

export type AdminTicketRow = TicketRow & {
  user_email: string | null;
  user_name: string | null;
  reply_count: number;
};

export const adminListTickets = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) => ListInput.parse(d))
  .handler(async ({ data }) => {
    let q = supabaseAdmin
      .from("support_tickets")
      .select("*")
      .order("last_reply_at", { ascending: false })
      .limit(500);
    if (data.status !== "all") q = q.eq("status", data.status);
    if (data.search) {
      const term = `%${data.search.replace(/[%,]/g, "")}%`;
      q = q.ilike("title", term);
    }
    const { data: tickets, error } = await q;
    if (error) {
      console.error("[adminListTickets]", error);
      throw new Response("Failed", { status: 500 });
    }
    const ids = (tickets ?? []).map((t) => t.user_id);
    const ticketIds = (tickets ?? []).map((t) => t.id);

    const [{ data: profs }, { data: replies }] = await Promise.all([
      supabaseAdmin.from("profiles").select("id, email, display_name").in("id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]),
      supabaseAdmin
        .from("support_ticket_replies")
        .select("ticket_id")
        .in("ticket_id", ticketIds.length ? ticketIds : ["00000000-0000-0000-0000-000000000000"]),
    ]);
    const profMap = new Map((profs ?? []).map((p) => [p.id, p]));
    const replyCounts = new Map<string, number>();
    for (const r of replies ?? []) {
      replyCounts.set(r.ticket_id, (replyCounts.get(r.ticket_id) ?? 0) + 1);
    }

    const rows: AdminTicketRow[] = (tickets ?? []).map((t) => {
      const p = profMap.get(t.user_id);
      return {
        ...(t as unknown as TicketRow),
        user_email: p?.email ?? null,
        user_name: p?.display_name ?? null,
        reply_count: replyCounts.get(t.id) ?? 0,
      };
    });
    return rows;
  });

const UpdateInput = z.object({
  id: z.string().uuid(),
  status: z.enum(["open", "in_progress", "waiting_user", "resolved", "closed"]).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  assigned_to: z.string().uuid().nullable().optional(),
});

export const adminUpdateTicket = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) => UpdateInput.parse(d))
  .handler(async ({ data }) => {
    const patch: {
      status?: "open" | "in_progress" | "waiting_user" | "resolved" | "closed";
      priority?: "low" | "normal" | "high" | "urgent";
      assigned_to?: string | null;
    } = {};
    if (data.status !== undefined) patch.status = data.status;
    if (data.priority !== undefined) patch.priority = data.priority;
    if (data.assigned_to !== undefined) patch.assigned_to = data.assigned_to;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin.from("support_tickets").update(patch).eq("id", data.id);
    if (error) {
      console.error("[adminUpdateTicket]", error);
      throw new Response("Failed", { status: 500 });
    }
    return { ok: true };
  });

export const adminDeleteTicket = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin.from("support_tickets").delete().eq("id", data.id);
    if (error) throw new Response("Failed", { status: 500 });
    return { ok: true };
  });
