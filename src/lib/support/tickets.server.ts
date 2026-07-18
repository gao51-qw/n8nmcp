import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger.server";
import type { SupportUser } from "./auth.server";
import type { SupportTicket, TicketAttachment } from "./types";
import type { CreateTicketInput, ReplyInput } from "./validation";

type DbResult = { data: unknown; error: { message?: string } | null };

interface QueryBuilder extends PromiseLike<DbResult> {
  select(columns?: string): QueryBuilder;
  insert(values: unknown): QueryBuilder;
  update(values: unknown): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder;
  limit(count: number): QueryBuilder;
  maybeSingle(): Promise<DbResult>;
  single(): Promise<DbResult>;
}

interface SupportDatabase {
  from(table: string): QueryBuilder;
  rpc(name: string, args: Record<string, unknown>): Promise<DbResult>;
  storage: {
    from(bucket: string): {
      createSignedUrl(path: string, expiresIn: number): Promise<DbResult>;
    };
  };
}

const db = supabaseAdmin as unknown as SupportDatabase;

type TicketRow = {
  id: string;
  user_id: string;
  title?: string;
  description?: string;
  category?: SupportTicket["category"];
  priority?: SupportTicket["priority"];
  status?: SupportTicket["status"];
  source?: SupportTicket["source"];
  assigned_to?: string | null;
  attachments?: unknown;
  first_response_due_at?: string | null;
  first_responded_at?: string | null;
  resolved_due_at?: string | null;
  sla_breached_at?: string | null;
  sentry_event_id?: string | null;
  mcp_request_id?: string | null;
  created_at?: string;
  updated_at?: string;
  last_reply_at?: string;
};

export class SupportHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "SupportHttpError";
  }
}

function httpError(status: number, message: string): SupportHttpError {
  return new SupportHttpError(status, message);
}

function databaseError(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

function attachments(value: unknown): TicketAttachment[] {
  return Array.isArray(value) ? (value as TicketAttachment[]) : [];
}

function mapTicket(row: TicketRow): SupportTicket {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title ?? "",
    description: row.description ?? "",
    category: row.category ?? "other",
    priority: row.priority ?? "normal",
    status: row.status ?? "open",
    source: row.source ?? "ticket_form",
    assignedTo: row.assigned_to ?? null,
    attachments: attachments(row.attachments),
    firstResponseDueAt: row.first_response_due_at ?? null,
    firstRespondedAt: row.first_responded_at ?? null,
    resolvedDueAt: row.resolved_due_at ?? null,
    slaBreachedAt: row.sla_breached_at ?? null,
    sentryEventId: row.sentry_event_id ?? null,
    mcpRequestId: row.mcp_request_id ?? null,
    createdAt: row.created_at ?? "",
    updatedAt: row.updated_at ?? "",
    lastReplyAt: row.last_reply_at ?? "",
  };
}

async function isAdmin(userId: string): Promise<boolean> {
  const { data, error } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();
  return !error && (data as { role?: string } | null)?.role === "admin";
}

async function accessibleTicket(userId: string, ticketId: string): Promise<TicketRow> {
  const { data, error } = await db
    .from("support_tickets")
    .select("*")
    .eq("id", ticketId)
    .maybeSingle();
  if (error) databaseError(error, "Unable to load support ticket");
  const ticket = data as TicketRow | null;
  if (!ticket || (ticket.user_id !== userId && !(await isAdmin(userId)))) {
    throw httpError(404, "Ticket not found");
  }
  return ticket;
}

export function assertAttachmentPaths(
  userId: string,
  ticketId: string,
  values: readonly TicketAttachment[],
): void {
  const prefix = `${userId}/${ticketId}/`;
  if (
    values.some((attachment) => {
      const expectedName = sanitizeFilename(attachment.name);
      const suffix = attachment.path.slice(prefix.length);
      return (
        !attachment.path.startsWith(prefix) ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-/i.test(
          suffix,
        ) ||
        suffix.slice(37) !== expectedName
      );
    })
  ) {
    throw httpError(400, "Invalid attachment path");
  }
}

function sanitizeFilename(name: string): string {
  const sanitized = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return sanitized || "attachment";
}

export function normalizeSupportAttachments(
  userId: string,
  ticketId: string,
  values: readonly TicketAttachment[],
  now = new Date(),
): TicketAttachment[] {
  assertAttachmentPaths(userId, ticketId, values);
  const expiresAt = new Date(now);
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 180);
  return values.map((attachment) => ({
    ...attachment,
    expiresAt: expiresAt.toISOString(),
  }));
}

export async function createSupportTicket(
  user: SupportUser,
  input: CreateTicketInput,
  requestId: string,
): Promise<SupportTicket> {
  const ticketId = input.ticketId;
  const normalizedAttachments = normalizeSupportAttachments(
    user.userId,
    ticketId,
    input.attachments,
  );
  const { data, error } = await db.rpc("support_create_ticket", {
    _ticket_id: ticketId,
    _user_id: user.userId,
    _user_email: user.email,
    _title: input.title,
    _description: input.description,
    _category: input.category,
    _priority: input.priority,
    _source: input.source,
    _attachments: normalizedAttachments,
    _sentry_event_id: input.sentryEventId ?? null,
    _mcp_request_id: input.mcpRequestId ?? null,
    _request_id: requestId,
  });
  if (error || !data) databaseError(error, "Unable to create support ticket");
  const ticket = mapTicket(data as TicketRow);
  log.info("support.ticket.created", {
    requestId,
    ticketId: ticket.id,
    userId: user.userId,
    source: ticket.source,
  });
  return ticket;
}

export async function listSupportTickets(
  userId: string,
  filters: { status?: SupportTicket["status"]; search?: string } = {},
): Promise<SupportTicket[]> {
  let query = db
    .from("support_tickets")
    .select("*")
    .eq("user_id", userId)
    .order("last_reply_at", { ascending: false });
  if (filters.status) query = query.eq("status", filters.status);
  const { data, error } = await query;
  if (error) databaseError(error, "Unable to list support tickets");
  const rows = (Array.isArray(data) ? data : []) as TicketRow[];
  const needle = filters.search?.toLocaleLowerCase();
  return rows
    .filter((row) =>
      needle
        ? `${row.title ?? ""} ${row.description ?? ""}`.toLocaleLowerCase().includes(needle)
        : true,
    )
    .map(mapTicket);
}

export async function getSupportTicket(userId: string, ticketId: string) {
  const ticket = await accessibleTicket(userId, ticketId);
  const { data, error } = await db
    .from("support_ticket_replies")
    .select("*")
    .eq("ticket_id", ticketId)
    .order("created_at", { ascending: true });
  if (error) databaseError(error, "Unable to load ticket replies");
  return { ticket: mapTicket(ticket), replies: Array.isArray(data) ? data : [] };
}

export async function addSupportReply(
  userId: string,
  ticketId: string,
  input: ReplyInput,
  options: { automated?: boolean } = {},
) {
  const ticket = options.automated
    ? ((await db.from("support_tickets").select("*").eq("id", ticketId).maybeSingle())
        .data as TicketRow | null)
    : await accessibleTicket(userId, ticketId);
  if (!ticket) throw httpError(404, "Ticket not found");
  if (ticket.status === "closed") throw httpError(409, "Closed tickets cannot receive replies");
  const normalizedAttachments = normalizeSupportAttachments(
    ticket.user_id,
    ticketId,
    input.attachments,
  );

  const admin = !options.automated && (await isAdmin(userId));
  if (admin) {
    const { data, error } = await db.rpc("support_admin_add_reply", {
      _ticket_id: ticketId,
      _actor_id: userId,
      _body: input.body,
      _attachments: normalizedAttachments,
    });
    if (error || !data) databaseError(error, "Unable to add support reply");
    return data;
  }

  const { data, error } = await db.rpc("support_add_reply", {
    _ticket_id: ticketId,
    _actor_id: userId,
    _body: input.body,
    _attachments: normalizedAttachments,
    _automated: options.automated === true,
  });
  if (error || !data) databaseError(error, "Unable to add support reply");

  return data;
}

export async function signSupportAttachments(
  userId: string,
  ticketId: string,
  paths: readonly string[],
) {
  const ticket = await accessibleTicket(userId, ticketId);
  const { data, error } = await db
    .from("support_ticket_replies")
    .select("attachments")
    .eq("ticket_id", ticketId);
  if (error) databaseError(error, "Unable to verify ticket attachments");

  const recorded = new Set(attachments(ticket.attachments).map((item) => item.path));
  for (const reply of (Array.isArray(data) ? data : []) as { attachments?: unknown }[]) {
    for (const attachment of attachments(reply.attachments)) recorded.add(attachment.path);
  }
  if (paths.some((path) => !recorded.has(path))) {
    throw httpError(404, "Attachment not found");
  }

  return Promise.all(
    paths.map(async (path) => {
      const signed = await db.storage.from("ticket-attachments").createSignedUrl(path, 600);
      if (signed.error || !signed.data) {
        databaseError(signed.error, "Unable to sign attachment");
      }
      return {
        path,
        signedUrl: (signed.data as { signedUrl: string }).signedUrl,
      };
    }),
  );
}
