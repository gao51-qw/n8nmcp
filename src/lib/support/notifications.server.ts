import { createHmac } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger.server";

type DbResult = { data: unknown; error: { message?: string } | null };

interface SupportDatabase {
  rpc(name: string, args: Record<string, unknown>): Promise<DbResult>;
}

type OutboxRow = {
  id: string;
  ticket_id: string;
  channel: "resend" | "n8n";
  event_type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  status: "processing";
  attempt_count: number;
  lease_token: string;
};

type N8nSupportEvent = {
  eventType: "ticket.created" | "ticket.urgent" | "sla.due_soon" | "sla.breached";
  ticketId: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: string;
  assignedTo: string | null;
  firstResponseDueAt: string | null;
  requestId: string;
};

export type SupportOutboxCounts = {
  claimed: number;
  sent: number;
  failed: number;
};

const db = supabaseAdmin as unknown as SupportDatabase;
const DELIVERY_TIMEOUT_MS = 10_000;

class DeliveryHttpError extends Error {
  constructor(
    provider: string,
    readonly status: number,
  ) {
    super(`${provider} returned HTTP ${status}`);
    this.name = "DeliveryHttpError";
  }
}

function databaseError(error: { message?: string } | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid support notification ${name}`);
  }
  return value;
}

function nullableString(value: unknown, name: string): string | null {
  if (value === null) return null;
  return requiredString(value, name);
}

function safeN8nEvent(payload: Record<string, unknown>): N8nSupportEvent {
  const eventType = requiredString(payload.eventType, "eventType");
  if (!["ticket.created", "ticket.urgent", "sla.due_soon", "sla.breached"].includes(eventType)) {
    throw new Error("Invalid support notification eventType");
  }
  const priority = requiredString(payload.priority, "priority");
  if (!["low", "normal", "high", "urgent"].includes(priority)) {
    throw new Error("Invalid support notification priority");
  }

  return {
    eventType: eventType as N8nSupportEvent["eventType"],
    ticketId: requiredString(payload.ticketId, "ticketId"),
    priority: priority as N8nSupportEvent["priority"],
    status: requiredString(payload.status, "status"),
    assignedTo: nullableString(payload.assignedTo, "assignedTo"),
    firstResponseDueAt: nullableString(payload.firstResponseDueAt, "firstResponseDueAt"),
    requestId: requiredString(payload.requestId, "requestId"),
  };
}

async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DELIVERY_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function sendN8n(row: OutboxRow): Promise<void> {
  const url = process.env.SUPPORT_N8N_WEBHOOK_URL;
  const secret = process.env.SUPPORT_N8N_WEBHOOK_SECRET;
  if (!url || !secret) throw new Error("n8n support webhook is not configured");

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const body = JSON.stringify(safeN8nEvent(row.payload));
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  const response = await fetchWithTimeout(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-support-timestamp": timestamp,
      "x-support-signature": signature,
      "Idempotency-Key": row.idempotency_key,
    },
    body,
  });
  if (!response.ok) throw new DeliveryHttpError("n8n", response.status);
}

async function sendResend(row: OutboxRow): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) throw new Error("RESEND_API_KEY is not configured");
  const from = process.env.SUPPORT_EMAIL_FROM;
  if (!from) throw new Error("SUPPORT_EMAIL_FROM is not configured");

  const recipientEmail = requiredString(row.payload.recipientEmail, "recipientEmail");
  const ticketId = requiredString(row.payload.ticketId, "ticketId");
  const response = await fetchWithTimeout("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Idempotency-Key": row.idempotency_key,
    },
    body: JSON.stringify({
      from,
      to: [recipientEmail],
      subject: `Support ticket ${ticketId} received`,
      html: `<p>Your support ticket <strong>${ticketId}</strong> has been received.</p>`,
    }),
  });
  if (!response.ok) throw new DeliveryHttpError("Resend", response.status);
}

async function complete(row: OutboxRow): Promise<void> {
  const result = await db.rpc("support_complete_notification_outbox", {
    _id: row.id,
    _lease_token: row.lease_token,
  });
  if (result.error || result.data !== true) {
    databaseError(result.error, "Unable to complete support notification");
  }
}

async function fail(row: OutboxRow, error: unknown, terminal: boolean): Promise<void> {
  const message = error instanceof Error ? error.message : "Support notification failed";
  const result = await db.rpc("support_fail_notification_outbox", {
    _id: row.id,
    _lease_token: row.lease_token,
    _error: message.slice(0, 500),
    _http_status: error instanceof DeliveryHttpError ? error.status : null,
    _terminal: terminal,
  });
  if (result.error || result.data !== true) {
    databaseError(result.error, "Unable to fail support notification");
  }
  log.warn("support.notification.failed", {
    requestId: typeof row.payload.requestId === "string" ? row.payload.requestId : undefined,
    ticketId: row.ticket_id,
    channel: row.channel,
    attemptCount: row.attempt_count + 1,
    terminal,
    errorType: error instanceof Error ? error.name : typeof error,
  });
}

// Permanent failures that retrying will never resolve: missing configuration,
// an unroutable channel, or a payload that fails strict validation. Transient
// failures (network errors, non-2xx HTTP responses) are retried until the
// outbox attempt cap is reached.
const TERMINAL_ERROR_MESSAGES = new Set([
  "n8n support webhook is not configured",
  "RESEND_API_KEY is not configured",
  "SUPPORT_EMAIL_FROM is not configured",
  "Unsupported support notification channel",
]);

function isTerminalError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error instanceof DeliveryHttpError) {
    return error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status);
  }
  return (
    TERMINAL_ERROR_MESSAGES.has(error.message) ||
    error.message.startsWith("Invalid support notification ")
  );
}

export async function processSupportNotificationOutbox(limit = 25): Promise<SupportOutboxCounts> {
  const boundedLimit = Math.max(1, Math.min(25, Math.trunc(limit)));
  const claimed = await db.rpc("support_claim_notification_outbox", {
    _limit: boundedLimit,
  });
  if (claimed.error) databaseError(claimed.error, "Unable to claim support notifications");
  const rows = (Array.isArray(claimed.data) ? claimed.data : []) as OutboxRow[];
  const counts: SupportOutboxCounts = { claimed: rows.length, sent: 0, failed: 0 };

  for (const row of rows) {
    try {
      if (row.channel === "resend") await sendResend(row);
      else if (row.channel === "n8n") await sendN8n(row);
      else throw new Error("Unsupported support notification channel");
      await complete(row);
      counts.sent += 1;
    } catch (error) {
      const terminal = isTerminalError(error);
      counts.failed += 1;
      try {
        await fail(row, error, terminal);
      } catch (persistenceError) {
        log.error("support.notification.fail_state_update_failed", {
          requestId: typeof row.payload.requestId === "string" ? row.payload.requestId : undefined,
          ticketId: row.ticket_id,
          channel: row.channel,
          attemptCount: row.attempt_count + 1,
          terminal,
          deliveryErrorType: error instanceof Error ? error.name : typeof error,
          persistenceErrorType:
            persistenceError instanceof Error ? persistenceError.name : typeof persistenceError,
        });
      }
    }
  }

  return counts;
}
