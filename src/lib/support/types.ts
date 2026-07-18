export type TicketSource = "ticket_form" | "live_chat";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus = "open" | "in_progress" | "waiting_user" | "resolved" | "closed";
export type SupportQueue =
  "unassigned" | "mine" | "waiting_user" | "sla_due" | "sla_breached" | "closed";
export type SupportPresenceStatus = "online" | "away";

export type TicketAttachment = {
  path: string;
  name: string;
  size: number;
  type?: string;
  expiresAt: string;
};

export type SupportTicket = {
  id: string;
  userId: string;
  title: string;
  description: string;
  category: "bug" | "feature_request" | "billing" | "account" | "other";
  priority: TicketPriority;
  status: TicketStatus;
  source: TicketSource;
  assignedTo: string | null;
  attachments: TicketAttachment[];
  firstResponseDueAt: string | null;
  firstRespondedAt: string | null;
  resolvedDueAt: string | null;
  slaBreachedAt: string | null;
  sentryEventId: string | null;
  mcpRequestId: string | null;
  createdAt: string;
  updatedAt: string;
  lastReplyAt: string;
};

export type SupportAgentPresence = {
  agentId: string;
  status: SupportPresenceStatus;
  lastHeartbeatAt: string;
  lastAssignedAt: string | null;
  updatedAt: string;
};
