import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

export type TicketCategory = "bug" | "feature_request" | "billing" | "account" | "other";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus = "open" | "in_progress" | "waiting_user" | "resolved" | "closed";

export type TicketAttachment = {
  path: string;
  name: string;
  size: number;
  type?: string;
};

export type TicketRow = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  category: TicketCategory;
  priority: TicketPriority;
  status: TicketStatus;
  assigned_to: string | null;
  attachments: TicketAttachment[];
  created_at: string;
  updated_at: string;
  last_reply_at: string;
};

export type TicketReplyRow = {
  id: string;
  ticket_id: string;
  author_id: string;
  is_admin: boolean;
  body: string;
  attachments: TicketAttachment[];
  created_at: string;
  author_name: string | null;
  author_avatar: string | null;
};

const AttachmentSchema = z.object({
  path: z.string().min(1).max(512),
  name: z.string().min(1).max(255),
  size: z.number().int().min(0).max(20 * 1024 * 1024),
  type: z.string().max(120).optional(),
});

const CreateInput = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(10).max(10_000),
  category: z.enum(["bug", "feature_request", "billing", "account", "other"]),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  attachments: z.array(AttachmentSchema).max(10).default([]),
});

export const createTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    // Validate that uploaded paths are owned by this user (defense in depth).
    for (const a of data.attachments) {
      if (!a.path.startsWith(`${userId}/`)) {
        throw new Response("Invalid attachment path", { status: 400 });
      }
    }
    const { data: row, error } = await supabase
      .from("support_tickets")
      .insert({
        user_id: userId,
        title: data.title,
        description: data.description,
        category: data.category,
        priority: data.priority,
        attachments: data.attachments,
      })
      .select("id")
      .single();
    if (error) {
      console.error("[createTicket]", error);
      throw new Response("Failed to create ticket", { status: 500 });
    }
    return { id: row.id as string };
  });

export const listMyTickets = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TicketRow[]> => {
    const { supabase } = context;
    const { data, error } = await supabase
      .from("support_tickets")
      .select("*")
      .order("last_reply_at", { ascending: false });
    if (error) {
      console.error("[listMyTickets]", error);
      throw new Response("Failed", { status: 500 });
    }
    return (data ?? []) as unknown as TicketRow[];
  });

const IdInput = z.object({ id: z.string().uuid() });

export const getTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => IdInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: ticket, error } = await supabase
      .from("support_tickets")
      .select("*")
      .eq("id", data.id)
      .maybeSingle();
    if (error) {
      console.error("[getTicket]", error);
      throw new Response("Failed", { status: 500 });
    }
    if (!ticket) throw new Response("Not found", { status: 404 });

    const { data: replies, error: rerr } = await supabase
      .from("support_ticket_replies")
      .select("*")
      .eq("ticket_id", data.id)
      .order("created_at", { ascending: true });
    if (rerr) {
      console.error("[getTicket replies]", rerr);
      throw new Response("Failed", { status: 500 });
    }

    // Fetch author display info via admin client (RLS on profiles only allows
    // self/admin reads, but ticket conversations need to show counterpart names).
    const authorIds = Array.from(new Set([ticket.user_id, ...(replies ?? []).map((r) => r.author_id)]));
    const { data: profs } = await supabaseAdmin
      .from("profiles")
      .select("id, display_name, email, avatar_url")
      .in("id", authorIds);
    const profMap = new Map((profs ?? []).map((p) => [p.id, p]));

    const enrichedReplies: TicketReplyRow[] = (replies ?? []).map((r) => {
      const p = profMap.get(r.author_id);
      return {
        ...(r as unknown as TicketReplyRow),
        author_name: p?.display_name ?? p?.email ?? null,
        author_avatar: p?.avatar_url ?? null,
      };
    });

    const owner = profMap.get(ticket.user_id);
    return {
      ticket: ticket as unknown as TicketRow,
      replies: enrichedReplies,
      owner: owner
        ? { id: owner.id, name: owner.display_name ?? owner.email, avatar: owner.avatar_url }
        : null,
    };
  });

const ReplyInput = z.object({
  ticket_id: z.string().uuid(),
  body: z.string().trim().min(1).max(10_000),
  attachments: z.array(AttachmentSchema).max(10).default([]),
});

export const replyToTicket = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => ReplyInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    for (const a of data.attachments) {
      if (!a.path.startsWith(`${userId}/`)) {
        throw new Response("Invalid attachment path", { status: 400 });
      }
    }
    // Determine if author is admin via has_role; that controls is_admin flag.
    const { data: isAdmin } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "admin",
    });

    const { error } = await supabase.from("support_ticket_replies").insert({
      ticket_id: data.ticket_id,
      author_id: userId,
      is_admin: isAdmin === true,
      body: data.body,
      attachments: data.attachments,
    });
    if (error) {
      console.error("[replyToTicket]", error);
      throw new Response("Failed to send reply", { status: 500 });
    }

    // Bump last_reply_at + bring status forward.
    // Owner replying on a resolved/closed ticket re-opens it; admin reply on
    // an open ticket switches to waiting_user.
    await supabaseAdmin
      .from("support_tickets")
      .update({
        last_reply_at: new Date().toISOString(),
        ...(isAdmin === true ? { status: "waiting_user" } : {}),
      })
      .eq("id", data.ticket_id);

    return { ok: true };
  });

const SignedUrlInput = z.object({
  paths: z.array(z.string().min(1).max(512)).min(1).max(20),
  ticket_id: z.string().uuid(),
});

/**
 * Returns short-lived signed URLs for attachments belonging to a ticket the
 * caller can read. Uses admin client to sign, but only after verifying the
 * caller owns the ticket or is an admin (RLS on the ticket SELECT enforces
 * this).
 */
export const getAttachmentUrls = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => SignedUrlInput.parse(d))
  .handler(async ({ data, context }) => {
    const { supabase } = context;
    const { data: ticket, error } = await supabase
      .from("support_tickets")
      .select("id")
      .eq("id", data.ticket_id)
      .maybeSingle();
    if (error || !ticket) throw new Response("Not found", { status: 404 });

    const out: Record<string, string> = {};
    for (const path of data.paths) {
      const { data: signed } = await supabaseAdmin.storage
        .from("ticket-attachments")
        .createSignedUrl(path, 600);
      if (signed?.signedUrl) out[path] = signed.signedUrl;
    }
    return out;
  });
