import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Tables } from "@/integrations/supabase/types";
import { TIER_LABELS, tierLimit, tierOf } from "@/lib/tiers";
import { deriveAgentPlan } from "@/lib/workflow-agent/call-metadata.server";
import type { WorkflowOperation } from "@/lib/workflow-agent";
import type {
  AuditEntry,
  AuditLevel,
  DiffEntry,
  DiffOperation,
  ToolCallEvent,
  ToolCallStatus,
  ValidationResult,
  WorkflowAgentConsoleData,
} from "@/components/workflow-agent/agent-console";

type McpCallLogRow = Pick<
  Tables<"mcp_call_logs">,
  "id" | "tool_name" | "status" | "latency_ms" | "created_at"
> &
  Partial<
    Pick<Tables<"mcp_call_logs">, "error_message" | "workflow_id" | "session_id" | "metadata">
  >;

type AuditChange = {
  field: string;
  before: unknown;
  after: unknown;
  type: "added" | "removed" | "modified";
};

type WorkflowAuditConsoleRow = Pick<
  Tables<"workflow_audit_log">,
  | "id"
  | "workflow_id"
  | "operation"
  | "tool_name"
  | "ai_reasoning"
  | "is_rolled_back"
  | "created_at"
  | "snapshot_before"
  | "snapshot_after"
  | "tool_params"
> & {
  workflow_name?: string | null;
  changes: Tables<"workflow_audit_log">["changes"] | AuditChange[] | null;
};

type ConsoleInstanceRow = Pick<Tables<"n8n_instances">, "id" | "name" | "status">;

type ConsoleSubscriptionRow = Pick<
  Tables<"subscriptions">,
  "tier" | "status" | "current_period_end"
>;

type ConsoleUsageRow = Pick<Tables<"usage_daily">, "mcp_calls">;

export type BuildWorkflowAgentConsoleInput = {
  now?: Date;
  workflowId?: string;
  instance?: ConsoleInstanceRow | null;
  subscription?: ConsoleSubscriptionRow | null;
  usageToday?: ConsoleUsageRow | null;
  callLogs: McpCallLogRow[];
  auditRows: WorkflowAuditConsoleRow[];
};

const TOOL_LABELS: Record<string, string> = {
  search_templates: "Template search",
  get_template: "Template load",
  search_nodes: "Node knowledge search",
  get_node: "Node schema lookup",
  validate_node: "Node validation",
  preview_workflow_diff: "Diff preview",
  update_partial_workflow: "Partial workflow update",
  validate_workflow: "Workflow validation",
  deploy_and_test_workflow: "Deploy/test",
  fix_workflow_errors: "Workflow repair",
  rollback_workflow: "Rollback",
};

const DESTRUCTIVE_TOOLS = new Set([
  "delete_workflow",
  "update_workflow",
  "update_partial_workflow",
  "apply_workflow_patch",
  "safe_apply_workflow_patch",
  "fix_workflow_errors",
  "deploy_and_test_workflow",
  "rollback_workflow",
]);

export async function loadWorkflowAgentConsoleData(
  userId: string,
  options: { workflowId?: string } = {},
): Promise<WorkflowAgentConsoleData> {
  let auditQuery = supabaseAdmin
    .from("workflow_audit_log")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (options.workflowId) {
    auditQuery = auditQuery.eq("workflow_id", options.workflowId);
  }

  const today = new Date().toISOString().slice(0, 10);
  const [instance, subscription, usageToday, callLogs, auditRows] = await Promise.all([
    supabaseAdmin
      .from("n8n_instances")
      .select("id,name,status")
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("subscriptions")
      .select("tier,status,current_period_end")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("usage_daily")
      .select("mcp_calls")
      .eq("user_id", userId)
      .eq("day", today)
      .maybeSingle(),
    supabaseAdmin
      .from("mcp_call_logs")
      .select(
        "id,tool_name,status,latency_ms,created_at,error_message,workflow_id,session_id,metadata",
      )
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(0, 49),
    auditQuery.range(0, 49),
  ]);

  for (const result of [instance, subscription, usageToday, callLogs, auditRows]) {
    if (result.error) {
      throw new Error(result.error.message ?? "Failed to load agent console data");
    }
  }

  return buildWorkflowAgentConsoleData({
    workflowId: options.workflowId,
    instance: instance.data,
    subscription: subscription.data,
    usageToday: usageToday.data,
    callLogs: callLogs.data ?? [],
    auditRows: auditRows.data ?? [],
  });
}

export function buildWorkflowAgentConsoleData(
  input: BuildWorkflowAgentConsoleInput,
): WorkflowAgentConsoleData {
  const now = input.now ?? new Date();
  const workflowRow =
    input.auditRows.find((row) => row.workflow_id === input.workflowId) ?? input.auditRows[0];
  const workflowId = input.workflowId ?? workflowRow?.workflow_id ?? "No audit workflow yet";
  const workflowName =
    workflowNameFromRow(workflowRow) ??
    (input.instance ? `${input.instance.name} workflow activity` : "No workflow selected");

  const tier = tierOf(input.subscription?.tier);
  const limit = tierLimit(tier);
  const used = input.usageToday?.mcp_calls ?? 0;
  const rateLimit = 60;
  const recentCalls = input.callLogs.filter((row) => {
    const timestamp = new Date(row.created_at).getTime();
    return Number.isFinite(timestamp) && now.getTime() - timestamp <= 10_000;
  }).length;

  const sortedCalls = [...input.callLogs].sort(compareCreatedAscending);
  const sortedAudit = [...input.auditRows].sort(compareCreatedDescending);
  const pendingUpdate = findPendingUpdate(input.callLogs, workflowId, now);
  const rollbackCandidate = findRollbackCandidate(sortedAudit, workflowId);

  return {
    workflowName,
    workflowId,
    selectedEnvironment: "production",
    mode: input.instance ? "write-enabled" : "read-only",
    rollbackStatus: input.auditRows.some((row) => row.is_rolled_back) ? "rolled-back" : "available",
    quota: {
      plan: TIER_LABELS[tier],
      used,
      limit: Number.isFinite(limit) ? limit : 1_000_000,
      resetAt: input.subscription?.current_period_end ?? nextUtcMidnight(now),
      rateRemaining: Math.max(0, rateLimit - recentCalls),
      rateLimit,
      window: "10 seconds",
    },
    templateHits: extractTemplateHits(sortedAudit),
    policy: summarizePolicy(sortedAudit),
    deployment: summarizeDeployment(sortedAudit, sortedCalls),
    pendingUpdate,
    rollbackCandidate,
    agentPlan: deriveAgentPlan(sortedCalls),
    toolCalls: sortedCalls.map(mapToolCall),
    diff: extractDiff(sortedAudit),
    validation: extractValidation(sortedAudit),
    auditLog: sortedAudit.map(mapAuditEntry),
  };
}

function findPendingUpdate(
  rows: McpCallLogRow[],
  workflowId: string,
  now: Date,
): WorkflowAgentConsoleData["pendingUpdate"] {
  const appliedPreviewIds = new Set(
    rows
      .filter((row) => row.tool_name === "update_partial_workflow" && row.status === "ok")
      .map((row) => stringOrNull(asRecord(row.metadata).sourcePreviewCallId))
      .filter((id): id is string => Boolean(id)),
  );
  const preview = [...rows].sort(compareCreatedDescending).find((row) => {
    if (
      row.tool_name !== "preview_workflow_diff" ||
      row.status !== "ok" ||
      appliedPreviewIds.has(row.id)
    ) {
      return false;
    }
    const metadata = asRecord(row.metadata);
    const scopedWorkflowId = stringOrNull(metadata.workflowId ?? row.workflow_id);
    const createdAt = new Date(row.created_at).getTime();
    return (
      scopedWorkflowId === workflowId &&
      Number.isFinite(createdAt) &&
      now.getTime() - createdAt >= 0 &&
      now.getTime() - createdAt <= 30 * 60_000
    );
  });
  if (!preview) return undefined;

  const metadata = asRecord(preview.metadata);
  const operations = Array.isArray(metadata.operations) ? metadata.operations : [];
  const fingerprint = stringOrNull(metadata.baseFingerprint);
  if (!fingerprint || operations.length === 0) return undefined;
  const createdAt = new Date(preview.created_at);
  const diff = asRecord(metadata.diff);

  return {
    previewCallId: preview.id,
    workflowId,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + 30 * 60_000).toISOString(),
    baseVersionId: stringOrNull(metadata.baseVersionId) ?? undefined,
    baseFingerprint: fingerprint,
    operations: operations.map((operation, index) => ({
      index,
      operation: operation as WorkflowOperation,
      summary: summarizePreviewOperation(operation, index, diff),
    })),
  };
}

function findRollbackCandidate(
  rows: WorkflowAuditConsoleRow[],
  workflowId: string,
): WorkflowAgentConsoleData["rollbackCandidate"] {
  const row = rows.find(
    (candidate) =>
      candidate.workflow_id === workflowId &&
      !candidate.is_rolled_back &&
      isRecord(candidate.snapshot_before),
  );
  if (!row) return undefined;
  return {
    auditLogId: row.id,
    workflowId: row.workflow_id,
    workflowName: workflowNameFromRow(row) ?? undefined,
    createdAt: row.created_at,
  };
}

function summarizePreviewOperation(
  operation: unknown,
  index: number,
  diff: Record<string, unknown>,
): DiffEntry {
  const record = asRecord(operation);
  const type = stringOrNull(record.type) ?? "update";
  const target =
    stringOrNull(record.nodeId) ??
    stringOrNull(record.nodeName) ??
    stringOrNull(record.source) ??
    toStringArray(diff.changedNodes)[index] ??
    `Operation ${index + 1}`;
  return {
    id: `preview-operation-${index}`,
    operation: type.toLowerCase().includes("remove")
      ? "remove"
      : type.toLowerCase().includes("add")
        ? "add"
        : "update",
    target,
  };
}

function mapToolCall(row: McpCallLogRow): ToolCallEvent {
  const tool = row.tool_name ?? "unknown";
  return {
    id: row.id,
    label: TOOL_LABELS[tool] ?? humanizeToolName(tool),
    tool,
    status: mapToolStatus(row.status, row.metadata),
    durationMs: row.latency_ms ?? 0,
    timestamp: formatTime(row.created_at),
  };
}

function mapToolStatus(status: string, metadata?: unknown): ToolCallStatus {
  if (asRecord(metadata).businessSuccess === false) return "blocked";
  if (status === "ok") return "complete";
  if (status === "rate_limited" || status === "error") return "blocked";
  return "pending";
}

function mapAuditEntry(row: WorkflowAuditConsoleRow): AuditEntry {
  const tool = row.tool_name ?? row.operation;
  const level: AuditLevel = row.is_rolled_back
    ? "warning"
    : DESTRUCTIVE_TOOLS.has(tool)
      ? "decision"
      : "info";
  return {
    id: row.id,
    level,
    actor: tool,
    message:
      row.ai_reasoning ??
      `${humanizeToolName(tool)} recorded ${row.operation} for workflow ${row.workflow_id}.`,
    timestamp: formatTime(row.created_at),
  };
}

function extractDiff(rows: WorkflowAuditConsoleRow[]): DiffEntry[] {
  const row = rows.find((candidate) => {
    const params = asRecord(candidate.tool_params);
    return isRecord(params.diff) || auditChanges(candidate.changes).length > 0;
  });
  if (!row) return [];

  const params = asRecord(row.tool_params);
  const diff = asRecord(params.diff);
  const entries: DiffEntry[] = [];

  for (const node of toStringArray(diff.changedNodes)) {
    entries.push({ id: `diff-update-${node}`, operation: "update", target: `Node / ${node}` });
  }
  for (const node of toStringArray(diff.addedNodes)) {
    entries.push({ id: `diff-add-${node}`, operation: "add", target: `Node / ${node}` });
  }
  for (const node of toStringArray(diff.removedNodes)) {
    entries.push({ id: `diff-remove-${node}`, operation: "remove", target: `Node / ${node}` });
  }
  if (Array.isArray(diff.changedConnections)) {
    for (const [index, connection] of diff.changedConnections.entries()) {
      const record = asRecord(connection);
      const change = String(record.change ?? "updated");
      entries.push({
        id: `diff-connection-${index}`,
        operation: operationFromChange(change),
        target: `Connection / ${String(record.source ?? "unknown")}${
          record.target ? ` -> ${String(record.target)}` : ""
        }`,
        after: change,
      });
    }
  }

  if (entries.length > 0) return entries;

  return auditChanges(row.changes).map((change, index) => ({
    id: `change-${row.id}-${index}`,
    operation: change.type === "added" ? "add" : change.type === "removed" ? "remove" : "update",
    target: change.field,
    before: stringifySummary(change.before),
    after: stringifySummary(change.after),
  }));
}

function auditChanges(value: unknown): AuditChange[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const change = asRecord(item);
    const field = stringOrNull(change.field);
    const type = change.type;
    if (!field || (type !== "added" && type !== "removed" && type !== "modified")) return [];
    return [{ field, type, before: change.before, after: change.after }];
  });
}

function extractValidation(rows: WorkflowAuditConsoleRow[]): ValidationResult[] {
  const row = rows.find((candidate) => isRecord(asRecord(candidate.tool_params).validation));
  if (!row) return [];

  const validation = asRecord(asRecord(row.tool_params).validation);
  const results: ValidationResult[] = [];

  for (const [index, issue] of toRecordArray(validation.errors).entries()) {
    results.push({
      id: `validation-error-${index}`,
      severity: "error",
      scope: issueScope(issue),
      message: String(issue.message ?? issue.error ?? "Validation error"),
    });
  }
  for (const [index, issue] of toRecordArray(validation.warnings).entries()) {
    results.push({
      id: `validation-warning-${index}`,
      severity: "warning",
      scope: issueScope(issue),
      message: String(issue.message ?? issue.warning ?? "Validation warning"),
    });
  }

  if (results.length === 0 && (validation.ok === true || validation.passed === true)) {
    results.push({
      id: "validation-pass",
      severity: "pass",
      scope: "Workflow",
      message: "Workflow validation passed.",
    });
  }

  return results;
}

function extractTemplateHits(
  rows: WorkflowAuditConsoleRow[],
): WorkflowAgentConsoleData["templateHits"] {
  const hits: NonNullable<WorkflowAgentConsoleData["templateHits"]> = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const params = asRecord(row.tool_params);
    const candidates = [params.template, params.templateHit, params.templateMetadata];
    for (const candidate of candidates) {
      const hit = asRecord(candidate);
      const id = stringOrNull(hit.id ?? hit.templateId);
      const name = stringOrNull(hit.name ?? hit.templateName);
      if (!id || !name || seen.has(id)) continue;
      seen.add(id);
      hits.push({
        id,
        name,
        confidence: typeof hit.confidence === "number" ? hit.confidence : undefined,
        source: `audit:${row.tool_name ?? row.operation}`,
      });
    }
  }

  return hits;
}

function summarizePolicy(rows: WorkflowAuditConsoleRow[]): WorkflowAgentConsoleData["policy"] {
  const explicitRow = rows.find((candidate) => {
    const params = asRecord(candidate.tool_params);
    return isRecord(params.policy) || params.confirm === true;
  });
  const row =
    explicitRow ?? rows.find((candidate) => DESTRUCTIVE_TOOLS.has(candidate.tool_name ?? ""));

  if (!row) {
    return { status: "read-only", summary: "No mutating policy decision recorded yet." };
  }

  const params = asRecord(row.tool_params);
  const policy = asRecord(params.policy);
  const environment = stringOrNull(policy.environment) ?? "unspecified environment";
  const confirmed = params.confirm === true;

  return {
    status: confirmed ? "confirmed" : "required",
    summary: `${humanizeToolName(row.tool_name ?? row.operation)} ${
      confirmed ? "was confirmed" : "requires confirmation"
    } for ${environment}.`,
  };
}

function summarizeDeployment(
  rows: WorkflowAuditConsoleRow[],
  calls: McpCallLogRow[],
): WorkflowAgentConsoleData["deployment"] {
  const audit = rows.find((row) => row.tool_name === "deploy_and_test_workflow");
  const call = calls.find((row) => row.tool_name === "deploy_and_test_workflow");
  const params = asRecord(audit?.tool_params);
  const callMetadata = asRecord(call?.metadata);
  const auditResults = asRecord(params.results);
  const results =
    Object.keys(auditResults).length > 0 ? auditResults : asRecord(callMetadata.results);
  const validation = asRecord(results.validation);
  const test = asRecord(results.test);

  if (validation.passed === false) {
    return {
      status: "blocked",
      summary: firstString(validation.errors) ?? "Deployment blocked by validation.",
    };
  }

  if (test.success === false) {
    return {
      status: "failed",
      summary: stringOrNull(test.error) ?? "Deploy/test failed.",
    };
  }

  if (test.success === true) {
    return {
      status: "passed",
      summary: "Deploy/test completed successfully.",
    };
  }

  if (call?.status === "error") {
    return {
      status: "failed",
      summary: call.error_message ?? "Deploy/test failed.",
    };
  }

  if (callMetadata.businessSuccess === false) {
    return { status: "failed", summary: "Deploy/test reported a business failure." };
  }

  return { status: "not-run", summary: "No deploy or test run recorded yet." };
}

function workflowNameFromRow(row: WorkflowAuditConsoleRow | undefined): string | null {
  if (!row) return null;
  if (row.workflow_name) return row.workflow_name;
  const afterName = stringOrNull(asRecord(row.snapshot_after).name);
  if (afterName) return afterName;
  return stringOrNull(asRecord(row.snapshot_before).name);
}

function compareCreatedAscending(a: { created_at: string }, b: { created_at: string }) {
  return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
}

function compareCreatedDescending(a: { created_at: string }, b: { created_at: string }) {
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
}

function operationFromChange(change: string): DiffOperation {
  if (change.includes("remove")) return "remove";
  if (change.includes("add")) return "add";
  return "update";
}

function humanizeToolName(tool: string): string {
  return tool
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function issueScope(issue: Record<string, unknown>): string {
  return (
    stringOrNull(issue.nodeName) ??
    stringOrNull(issue.scope) ??
    stringOrNull(issue.path) ??
    "Workflow"
  );
}

function nextUtcMidnight(now: Date): string {
  const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  return next.toISOString();
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return value;
  return date.toISOString().slice(11, 19);
}

function firstString(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  return value.find((item): item is string => typeof item === "string") ?? null;
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function stringifySummary(value: unknown): string {
  if (value == null) return "-";
  if (typeof value === "string") return value;
  try {
    const text = JSON.stringify(value);
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
  } catch {
    return String(value);
  }
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && item.length > 0)
    : [];
}

function toRecordArray(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length) : [];
}

function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
