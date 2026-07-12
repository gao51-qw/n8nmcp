// Workflow audit log (server-only).
// Records before/after snapshots of every workflow mutation the MCP gateway
// performs, and powers the audit read/rollback tools. Writes go through the
// service-role `supabaseAdmin` client (bypasses RLS); reads are additionally
// constrained by RLS for the dashboard. Ported from the legacy apps/api
// AuditService, with rollback/lookup now scoped by user_id (fixes an IDOR).
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger.server";

export type WorkflowAuditOperation = "create" | "update" | "delete" | "activate" | "deactivate";

export type AuditChange = {
  field: string;
  before: unknown;
  after: unknown;
  type: "added" | "removed" | "modified";
};

export type WorkflowAuditEntry = {
  userId: string;
  workflowId: string;
  operation: WorkflowAuditOperation;
  instanceId?: string | null;
  snapshotBefore?: unknown;
  snapshotAfter?: unknown;
  changes?: AuditChange[];
  aiReasoning?: string | null;
  toolName?: string | null;
  toolParams?: unknown;
  ipAddress?: string | null;
  userAgent?: string | null;
  sessionId?: string | null;
};

export type WorkflowAuditRow = {
  id: string;
  user_id: string;
  instance_id: string | null;
  workflow_id: string;
  operation: WorkflowAuditOperation;
  snapshot_before: unknown;
  snapshot_after: unknown;
  changes: AuditChange[] | null;
  ai_reasoning: string | null;
  tool_name: string | null;
  tool_params: unknown;
  ip_address: string | null;
  user_agent: string | null;
  session_id: string | null;
  is_rolled_back: boolean;
  created_at: string;
};

export type AuditQueryOptions = {
  userId: string;
  workflowId?: string;
  operation?: WorkflowAuditOperation;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
};

// `workflow_audit_log` is not in the generated Supabase types yet, so we access
// it through a narrow structural interface and cast, mirroring
// src/lib/support/tickets.server.ts.
type DbResult<T = unknown> = { data: T; error: { message?: string } | null };

interface QueryBuilder extends PromiseLike<DbResult> {
  select(columns?: string): QueryBuilder;
  insert(values: unknown): QueryBuilder;
  update(values: unknown): QueryBuilder;
  eq(column: string, value: unknown): QueryBuilder;
  order(column: string, options?: { ascending?: boolean }): QueryBuilder;
  gte(column: string, value: unknown): QueryBuilder;
  lte(column: string, value: unknown): QueryBuilder;
  range(from: number, to: number): QueryBuilder;
  maybeSingle(): Promise<DbResult>;
  single(): Promise<DbResult>;
}

interface AuditDatabase {
  from(table: string): QueryBuilder;
}

const db = supabaseAdmin as unknown as AuditDatabase;
const TABLE = "workflow_audit_log";

// Defensive ceiling so a pathological workflow/tool payload cannot create a
// multi-megabyte audit row. Oversized JSON is replaced with a truncation marker.
const MAX_JSON_BYTES = 256 * 1024;
function capJson(value: unknown): unknown {
  if (value == null) return value;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length > MAX_JSON_BYTES) {
      return { _truncated: true, bytes: serialized.length };
    }
  } catch {
    return { _unserializable: true };
  }
  return value;
}

const SENSITIVE_PARAM_KEYS = [
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "password",
  "secret",
  "session",
  "token",
];

function sanitizeToolParams(params: unknown): unknown {
  if (params == null) return params;

  try {
    return JSON.parse(
      JSON.stringify(params, (key, value) => {
        const normalizedKey = key.toLowerCase();
        if (SENSITIVE_PARAM_KEYS.some((sensitive) => normalizedKey.includes(sensitive))) {
          return "[REDACTED]";
        }
        return value;
      }),
    ) as unknown;
  } catch {
    return { _unserializable: true };
  }
}

/**
 * Shallow field-level diff between two workflow snapshots. Mirrors the legacy
 * AuditService.calculateChanges: unchanged fields are skipped; a field present
 * only in `after` is "added", only in `before` is "removed", otherwise
 * "modified". Returns [] when either snapshot is missing.
 */
export function calculateChanges(before: unknown, after: unknown): AuditChange[] {
  if (!before || !after || typeof before !== "object" || typeof after !== "object") {
    return [];
  }
  const b = before as Record<string, unknown>;
  const a = after as Record<string, unknown>;
  const changes: AuditChange[] = [];
  for (const field of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (JSON.stringify(b[field]) === JSON.stringify(a[field])) continue;
    changes.push({
      field,
      before: b[field],
      after: a[field],
      type: !b[field] ? "added" : !a[field] ? "removed" : "modified",
    });
  }
  return changes;
}

/**
 * Insert one audit row. Best-effort: a logging failure is swallowed and warned
 * so it can never block the workflow mutation that triggered it.
 */
export async function recordWorkflowAudit(entry: WorkflowAuditEntry): Promise<void> {
  try {
    const { error } = await db.from(TABLE).insert({
      user_id: entry.userId,
      instance_id: entry.instanceId ?? null,
      workflow_id: entry.workflowId,
      operation: entry.operation,
      snapshot_before: capJson(entry.snapshotBefore ?? null),
      snapshot_after: capJson(entry.snapshotAfter ?? null),
      changes: entry.changes ?? null,
      ai_reasoning: entry.aiReasoning ?? null,
      tool_name: entry.toolName ?? null,
      tool_params: capJson(sanitizeToolParams(entry.toolParams ?? null)),
      ip_address: entry.ipAddress ?? null,
      user_agent: entry.userAgent ?? null,
      session_id: entry.sessionId ?? null,
    });
    if (error) {
      log.warn("audit.record_failed", {
        workflow_id: entry.workflowId,
        operation: entry.operation,
        err: error.message,
      });
    }
  } catch (e) {
    log.warn("audit.record_failed", {
      workflow_id: entry.workflowId,
      operation: entry.operation,
      err: e instanceof Error ? e.message : "unknown",
    });
  }
}

/** Query audit rows. Always scoped to the requesting user. */
export async function queryWorkflowAudit(options: AuditQueryOptions): Promise<WorkflowAuditRow[]> {
  const limit = options.limit ?? 50;
  const offset = options.offset ?? 0;
  let query = db
    .from(TABLE)
    .select("*")
    .eq("user_id", options.userId)
    .order("created_at", { ascending: false });

  if (options.workflowId) query = query.eq("workflow_id", options.workflowId);
  if (options.operation) query = query.eq("operation", options.operation);
  if (options.startDate) query = query.gte("created_at", options.startDate.toISOString());
  if (options.endDate) query = query.lte("created_at", options.endDate.toISOString());

  const { data, error } = await query.range(offset, offset + limit - 1);
  if (error) throw new Error(`Failed to query audit logs: ${error.message}`);
  return (data as WorkflowAuditRow[] | null) ?? [];
}

/** Convenience: full change history for one workflow, newest first. */
export async function getWorkflowHistory(
  userId: string,
  workflowId: string,
  limit = 20,
): Promise<WorkflowAuditRow[]> {
  return queryWorkflowAudit({ userId, workflowId, limit });
}

/** Fetch a single audit row, scoped to its owner (cross-user access returns null). */
export async function getAuditLogForUser(
  userId: string,
  auditLogId: string,
): Promise<WorkflowAuditRow | null> {
  const { data, error } = await db
    .from(TABLE)
    .select("*")
    .eq("id", auditLogId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load audit log: ${error.message}`);
  return (data as WorkflowAuditRow | null) ?? null;
}

/** Load and validate a rollback candidate without mutating audit state. */
export async function getRollbackSnapshotForUser(
  userId: string,
  auditLogId: string,
): Promise<WorkflowAuditRow> {
  const row = await getAuditLogForUser(userId, auditLogId);
  if (!row) throw new Error("Audit log not found");
  if (row.is_rolled_back) throw new Error("This change has already been rolled back");
  if (!row.snapshot_before) throw new Error("Cannot rollback: no snapshot_before available");

  return row;
}

/** Mark a previously restored audit row after n8n accepted the snapshot. */
export async function markAuditRolledBack(userId: string, auditLogId: string): Promise<void> {
  const { error } = await db
    .from(TABLE)
    .update({ is_rolled_back: true })
    .eq("id", auditLogId)
    .eq("user_id", userId)
    .eq("is_rolled_back", false);
  if (error) throw new Error(`Failed to mark as rolled back: ${error.message}`);
}

/** Operation/day counts over the last `days` for the requesting user. */
export async function getAuditStatistics(userId: string, days = 30) {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await queryWorkflowAudit({ userId, startDate: since, limit: 1000 });

  const byOperation: Record<string, number> = {};
  const byDay: Record<string, number> = {};
  for (const row of rows) {
    byOperation[row.operation] = (byOperation[row.operation] ?? 0) + 1;
    const day = row.created_at.slice(0, 10);
    byDay[day] = (byDay[day] ?? 0) + 1;
  }
  return { total: rows.length, byOperation, byDay };
}

export type SuspiciousFinding = {
  type: "bulk_deletion" | "unusual_hours";
  severity: "high" | "medium";
  count: number;
  description: string;
};

/**
 * Heuristic anomaly detection over recent audit history: a burst of deletions
 * and high activity during 01:00-05:00. Ported from the legacy service.
 */
export async function detectSuspiciousActivity(
  userId: string,
  hours = 24,
): Promise<SuspiciousFinding[]> {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await queryWorkflowAudit({ userId, startDate: since, limit: 1000 });
  const findings: SuspiciousFinding[] = [];

  const deletions = rows.filter((r) => r.operation === "delete");
  if (deletions.length >= 5) {
    const windowMs = 5 * 60 * 1000;
    for (let i = 0; i + 4 < deletions.length; i++) {
      const end = new Date(deletions[i].created_at).getTime();
      const inWindow = deletions.filter((d) => {
        const t = new Date(d.created_at).getTime();
        return t >= end - windowMs && t <= end;
      });
      if (inWindow.length >= 5) {
        findings.push({
          type: "bulk_deletion",
          severity: "high",
          count: inWindow.length,
          description: "5 or more workflow deletions within 5 minutes",
        });
        break;
      }
    }
  }

  const nightOps = rows.filter((r) => {
    const hour = new Date(r.created_at).getHours();
    return hour >= 1 && hour <= 5;
  });
  if (nightOps.length > 10) {
    findings.push({
      type: "unusual_hours",
      severity: "medium",
      count: nightOps.length,
      description: "High activity during unusual hours (01:00-05:00)",
    });
  }

  return findings;
}
