import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type {
  SupportAgentPresence,
  SupportQueue,
  SupportTicket,
  TicketPriority,
  TicketStatus,
} from "./types";

type DbResult = { data: unknown; error: { message?: string } | null };

interface QueryBuilder extends PromiseLike<DbResult> {
  select(columns?: string): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  is(column: string, value: null): QueryBuilder;
  in(column: string, values: readonly unknown[]): QueryBuilder;
  not(column: string, operator: string, value: unknown): QueryBuilder;
  lte(column: string, value: unknown): QueryBuilder;
  gte(column: string, value: unknown): QueryBuilder;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder;
  limit(count: number): QueryBuilder;
  maybeSingle(): Promise<DbResult>;
}

interface SupportDatabase {
  from(table: string): QueryBuilder;
  rpc(name: string, args?: Record<string, unknown>): Promise<DbResult>;
}

const db = supabaseAdmin as unknown as SupportDatabase;

type TicketRow = {
  id: string;
  user_id: string;
  title?: string;
  description?: string;
  category?: SupportTicket["category"];
  priority?: TicketPriority;
  status?: TicketStatus;
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

function databaseError(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
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
    attachments: Array.isArray(row.attachments) ? row.attachments : [],
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

async function mutation(name: string, args: Record<string, unknown>) {
  const { data, error } = await db.rpc(name, args);
  if (error) databaseError(error, `Unable to execute ${name}`);
  return data;
}

async function ticketMutation(name: string, args: Record<string, unknown>): Promise<SupportTicket> {
  return mapTicket((await mutation(name, args)) as TicketRow);
}

export async function heartbeatAndAssignTickets(agentId: string, maxAssignments = 10) {
  const boundedLimit = Math.max(1, Math.min(25, Math.trunc(maxAssignments)));
  const heartbeat = await db.rpc("support_agent_heartbeat", { _agent_id: agentId });
  if (heartbeat.error) databaseError(heartbeat.error, "Unable to update agent heartbeat");

  const { data, error } = await db
    .from("support_tickets")
    .select("id")
    .eq("status", "open")
    .is("assigned_to", null)
    .order("created_at", { ascending: true })
    .limit(boundedLimit);
  if (error) databaseError(error, "Unable to load unassigned tickets");

  let assignedCount = 0;
  for (const row of (Array.isArray(data) ? data : []).slice(0, boundedLimit) as {
    id: string;
  }[]) {
    const assigned = await db.rpc("support_assign_ticket", { _ticket_id: row.id });
    if (assigned.error) databaseError(assigned.error, "Unable to assign support ticket");
    if (assigned.data) assignedCount += 1;
  }

  return { presence: heartbeat.data, assignedCount };
}

export async function listAdminAgents(): Promise<SupportAgentPresence[]> {
  const { data, error } = await db
    .from("support_agent_presence")
    .select("*")
    .order("last_heartbeat_at", { ascending: false });
  if (error) databaseError(error, "Unable to list support agents");
  return ((Array.isArray(data) ? data : []) as Record<string, unknown>[]).map((row) => ({
    agentId: String(row.agent_id),
    status: row.status as SupportAgentPresence["status"],
    lastHeartbeatAt: String(row.last_heartbeat_at),
    lastAssignedAt: row.last_assigned_at ? String(row.last_assigned_at) : null,
    updatedAt: String(row.updated_at),
  }));
}

export async function listAdminTickets(
  queue: SupportQueue,
  agentId: string,
  now = new Date(),
): Promise<SupportTicket[]> {
  let query = db.from("support_tickets").select("*").order("last_reply_at", { ascending: false });

  switch (queue) {
    case "unassigned":
      query = query.is("assigned_to", null).eq("status", "open");
      break;
    case "mine":
      query = query.eq("assigned_to", agentId).in("status", ["open", "in_progress"]);
      break;
    case "waiting_user":
      query = query.eq("status", "waiting_user");
      break;
    case "sla_due": {
      const dueBefore = new Date(now.getTime() + 30 * 60 * 1000);
      query = query
        .is("first_responded_at", null)
        .is("sla_breached_at", null)
        .not("status", "in", "(resolved,closed)")
        .gte("first_response_due_at", now.toISOString())
        .lte("first_response_due_at", dueBefore.toISOString());
      break;
    }
    case "sla_breached":
      query = query.not("sla_breached_at", "is", null);
      break;
    case "closed":
      query = query.in("status", ["resolved", "closed"]);
      break;
  }

  const { data, error } = await query;
  if (error) databaseError(error, "Unable to list admin support tickets");
  return ((Array.isArray(data) ? data : []) as TicketRow[]).map(mapTicket);
}

export async function getAdminTicket(ticketId: string) {
  const ticketResult = await db
    .from("support_tickets")
    .select("*")
    .eq("id", ticketId)
    .maybeSingle();
  if (ticketResult.error || !ticketResult.data) {
    databaseError(ticketResult.error, "Support ticket not found");
  }

  const load = async (table: string, orderColumn: string) => {
    const result = await db
      .from(table)
      .select("*")
      .eq("ticket_id", ticketId)
      .order(orderColumn, { ascending: true });
    if (result.error) databaseError(result.error, `Unable to load ${table}`);
    return Array.isArray(result.data) ? result.data : [];
  };

  const [replies, tags, internalNotes, events] = await Promise.all([
    load("support_ticket_replies", "created_at"),
    load("support_ticket_tags", "created_at"),
    load("support_ticket_internal_notes", "created_at"),
    load("support_ticket_events", "created_at"),
  ]);

  return {
    ticket: mapTicket(ticketResult.data as TicketRow),
    replies,
    tags,
    internalNotes,
    events,
  };
}

export function transferSupportTicket(
  ticketId: string,
  actorId: string,
  assignedTo: string | null,
) {
  return ticketMutation("support_admin_transfer_ticket", {
    _actor_id: actorId,
    _assigned_to: assignedTo,
    _ticket_id: ticketId,
  });
}

export function updateSupportTicketStatus(ticketId: string, actorId: string, status: TicketStatus) {
  return ticketMutation("support_admin_set_status", {
    _actor_id: actorId,
    _status: status,
    _ticket_id: ticketId,
  });
}

export function updateSupportTicketPriority(
  ticketId: string,
  actorId: string,
  priority: TicketPriority,
) {
  return ticketMutation("support_admin_set_priority", {
    _actor_id: actorId,
    _priority: priority,
    _ticket_id: ticketId,
  });
}

export function addSupportTicketTag(ticketId: string, actorId: string, tag: string) {
  return mutation("support_admin_add_tag", {
    _actor_id: actorId,
    _tag: tag,
    _ticket_id: ticketId,
  });
}

export function removeSupportTicketTag(ticketId: string, actorId: string, tag: string) {
  return mutation("support_admin_remove_tag", {
    _actor_id: actorId,
    _tag: tag,
    _ticket_id: ticketId,
  });
}

export function addSupportInternalNote(ticketId: string, actorId: string, body: string) {
  return mutation("support_admin_add_note", {
    _actor_id: actorId,
    _body: body,
    _ticket_id: ticketId,
  });
}

export function updateSupportInternalNote(
  ticketId: string,
  noteId: string,
  actorId: string,
  body: string,
) {
  return mutation("support_admin_update_note", {
    _actor_id: actorId,
    _body: body,
    _note_id: noteId,
    _ticket_id: ticketId,
  });
}
