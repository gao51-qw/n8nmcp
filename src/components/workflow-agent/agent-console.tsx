"use client";

import { useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock3,
  Diff,
  FileClock,
  Gauge,
  GitBranch,
  History,
  Play,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { WorkflowOperation } from "@/lib/workflow-agent";

export type AgentEnvironment = "development" | "staging" | "production";
export type AgentMode = "read-only" | "write-enabled";
export type RollbackStatus = "available" | "rolled-back";
export type ToolCallStatus = "complete" | "pending" | "blocked";
export type DiffOperation = "add" | "update" | "remove";
export type ValidationSeverity = "error" | "warning" | "pass";
export type AuditLevel = "info" | "decision" | "warning";
/**
 * Post-write concurrency verdict recorded on a workflow write's audit row
 * (tool_params.concurrencyAfterWrite.status). Clean writes carry none.
 */
export type AuditConcurrencyStatus =
  "concurrent_write_after" | "concurrent_write_suspected" | "unverified";

export interface QuotaSnapshot {
  plan: string;
  used: number;
  limit: number;
  resetAt: string;
  rateRemaining: number;
  rateLimit: number;
  window: string;
}

export interface ToolCallEvent {
  id: string;
  label: string;
  tool: string;
  status: ToolCallStatus;
  durationMs: number;
  timestamp: string;
}

export interface DiffEntry {
  id: string;
  operation: DiffOperation;
  target: string;
  before?: string;
  after?: string;
}

export interface ValidationResult {
  id: string;
  severity: ValidationSeverity;
  scope: string;
  message: string;
}

export interface AuditEntry {
  id: string;
  level: AuditLevel;
  actor: string;
  message: string;
  timestamp: string;
  concurrency?: AuditConcurrencyStatus;
}

export interface WorkflowAgentConsoleData {
  workflowName: string;
  workflowId: string;
  /** The n8n instance MCP tools act on (the user's default), when there is one. */
  instanceName?: string;
  selectedEnvironment: AgentEnvironment;
  mode: AgentMode;
  rollbackStatus: RollbackStatus;
  quota: QuotaSnapshot;
  templateHits?: Array<{
    id: string;
    name: string;
    confidence?: number;
    source: string;
  }>;
  policy?: {
    status: "confirmed" | "required" | "blocked" | "read-only";
    summary: string;
  };
  deployment?: {
    status: "not-run" | "testing" | "passed" | "failed" | "blocked";
    summary: string;
  };
  pendingUpdate?: {
    previewCallId: string;
    workflowId: string;
    createdAt: string;
    expiresAt: string;
    baseVersionId?: string;
    baseFingerprint: string;
    operations: Array<{
      index: number;
      operation: WorkflowOperation;
      summary: DiffEntry;
    }>;
  };
  rollbackCandidate?: {
    auditLogId: string;
    workflowId: string;
    workflowName?: string;
    createdAt: string;
  };
  agentPlan?: Array<{
    tool: string;
    status: "complete" | "blocked" | "pending";
  }>;
  toolCalls: ToolCallEvent[];
  diff: DiffEntry[];
  validation: ValidationResult[];
  auditLog: AuditEntry[];
}

export type WorkflowAgentActionState = {
  status: "idle" | "confirming" | "pending" | "success" | "error";
  message?: string;
};

export type WorkflowAgentConsoleProps = {
  data: WorkflowAgentConsoleData;
  actionState?: WorkflowAgentActionState;
  onApply?: (input: { previewCallId: string; selectedOperationIndexes: number[] }) => Promise<void>;
  onRollback?: (input: { auditLogId: string; reason: string }) => Promise<void>;
};

export const workflowAgentConsoleFixture: WorkflowAgentConsoleData = {
  workflowName: "Invoice enrichment workflow",
  workflowId: "wf_8f23_agent_draft",
  selectedEnvironment: "staging",
  mode: "write-enabled",
  rollbackStatus: "available",
  quota: {
    plan: "Team",
    used: 738,
    limit: 1000,
    resetAt: "2026-07-07 00:00 UTC",
    rateRemaining: 42,
    rateLimit: 60,
    window: "60 seconds",
  },
  toolCalls: [
    {
      id: "call-1",
      label: "Template search",
      tool: "search_templates",
      status: "complete",
      durationMs: 184,
      timestamp: "16:38:02",
    },
    {
      id: "call-2",
      label: "Node schema lookup",
      tool: "get_node",
      status: "complete",
      durationMs: 91,
      timestamp: "16:38:06",
    },
    {
      id: "call-3",
      label: "Diff preview",
      tool: "preview_workflow_diff",
      status: "complete",
      durationMs: 243,
      timestamp: "16:38:11",
    },
    {
      id: "call-4",
      label: "Workflow validation",
      tool: "validate_workflow",
      status: "blocked",
      durationMs: 318,
      timestamp: "16:38:13",
    },
  ],
  diff: [
    {
      id: "diff-1",
      operation: "update",
      target: "HTTP Request / Fetch invoice metadata",
      before: "GET without explicit auth mode",
      after: "GET with header auth and retry policy",
    },
    {
      id: "diff-2",
      operation: "add",
      target: "IF / Vendor threshold branch",
      after: "Routes invoices over $2,500 to finance approval",
    },
    {
      id: "diff-3",
      operation: "remove",
      target: "Connection / stale webhook retry branch",
      before: "Unreachable edge from old webhook trigger",
    },
  ],
  validation: [
    {
      id: "val-1",
      severity: "pass",
      scope: "Webhook trigger",
      message: "Method, path, response mode and response behavior are explicit.",
    },
    {
      id: "val-2",
      severity: "warning",
      scope: "HTTP Request",
      message: "Header auth is configured, but credential binding needs production review.",
    },
    {
      id: "val-3",
      severity: "error",
      scope: "IF / Vendor threshold branch",
      message: "False branch is not connected to a terminal notification node.",
    },
  ],
  auditLog: [
    {
      id: "audit-1",
      level: "info",
      actor: "agent",
      message: "Selected invoice template as the closest local match.",
      timestamp: "16:37:58",
    },
    {
      id: "audit-2",
      level: "decision",
      actor: "agent",
      message: "Used partial update operations instead of full workflow replacement.",
      timestamp: "16:38:10",
    },
    {
      id: "audit-3",
      level: "warning",
      actor: "validator",
      message: "Deployment held because validation returned one blocking error.",
      timestamp: "16:38:14",
    },
  ],
};

function statusBadgeClass(status: ToolCallStatus) {
  if (status === "complete") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "blocked") return "border-destructive/30 bg-destructive/10 text-destructive";
  return "border-amber-200 bg-amber-50 text-amber-700";
}

const CONCURRENCY_BADGES: Record<
  AuditConcurrencyStatus,
  { label: string; detail: string; className: string }
> = {
  concurrent_write_after: {
    label: "Concurrent edit detected",
    detail: "n8n saved another edit right after this change. Review the workflow in n8n.",
    className: "border-destructive/30 bg-destructive/10 text-destructive",
  },
  concurrent_write_suspected: {
    label: "Concurrent edit suspected",
    detail: "Another edit may have been saved around this change. Review the workflow in n8n.",
    className: "border-amber-200 bg-amber-50 text-amber-700",
  },
  unverified: {
    label: "Write not verified",
    detail: "The post-write check could not read the workflow back from n8n.",
    className: "border-border bg-muted text-muted-foreground",
  },
};

function validationIcon(severity: ValidationSeverity) {
  if (severity === "error") return <AlertCircle className="h-4 w-4 text-destructive" />;
  if (severity === "warning") return <ShieldAlert className="h-4 w-4 text-amber-600" />;
  return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
}

function diffClass(operation: DiffOperation) {
  if (operation === "add") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (operation === "remove") return "border-destructive/30 bg-destructive/10 text-destructive";
  return "border-sky-200 bg-sky-50 text-sky-700";
}

function formatPercent(value: number, limit: number) {
  if (limit <= 0) return 0;
  return Math.min(100, Math.round((value / limit) * 100));
}

export function WorkflowAgentConsole({
  data,
  actionState = { status: "idle" },
  onApply,
  onRollback,
}: WorkflowAgentConsoleProps) {
  // A page-local lock on Apply/Rollback. The server decides what may run
  // (instance present, confirmation token); this only guards against stray clicks.
  const [mode, setMode] = useState<AgentMode>(data.mode);
  const [selectedOperations, setSelectedOperations] = useState<number[]>(
    () => data.pendingUpdate?.operations.map(({ index }) => index) ?? [],
  );
  const [localPending, setLocalPending] = useState(false);

  const validationSummary = useMemo(
    () =>
      data.validation.reduce(
        (summary, item) => ({ ...summary, [item.severity]: summary[item.severity] + 1 }),
        { error: 0, warning: 0, pass: 0 } satisfies Record<ValidationSeverity, number>,
      ),
    [data.validation],
  );
  const quotaPercent = formatPercent(data.quota.used, data.quota.limit);
  const ratePercent = formatPercent(data.quota.rateRemaining, data.quota.rateLimit);
  const isReadOnly = mode === "read-only";
  const hasValidationErrors = validationSummary.error > 0;
  const actionPending = localPending || actionState.status === "pending";
  const rollbackDisabled =
    isReadOnly || data.rollbackStatus === "rolled-back" || !data.rollbackCandidate || actionPending;
  const applyDisabled =
    isReadOnly ||
    hasValidationErrors ||
    !data.pendingUpdate ||
    selectedOperations.length === 0 ||
    actionPending;

  async function applyUpdate() {
    if (!data.pendingUpdate || !onApply || applyDisabled) return;
    setLocalPending(true);
    try {
      await onApply({
        previewCallId: data.pendingUpdate.previewCallId,
        selectedOperationIndexes: [...selectedOperations].sort((a, b) => a - b),
      });
    } finally {
      setLocalPending(false);
    }
  }

  async function rollback() {
    if (!data.rollbackCandidate || !onRollback || rollbackDisabled) return;
    setLocalPending(true);
    try {
      await onRollback({
        auditLogId: data.rollbackCandidate.auditLogId,
        reason: "Restore the last audited workflow snapshot from the Agent Console.",
      });
    } finally {
      setLocalPending(false);
    }
  }

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <Bot className="h-4 w-4" aria-hidden="true" />
            Workflow Agent Console
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-foreground">
            {data.workflowName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">{data.workflowId}</p>
        </div>

        <div className="grid gap-3 sm:grid-cols-[minmax(13rem,1fr)_auto_auto] sm:items-end">
          <div className="space-y-2">
            <p className="text-sm font-medium">Target instance</p>
            {/* Actions always run on the instance marked "Active for MCP" under
                Instances; there is no separate environment to choose here. */}
            <div
              className="flex h-9 items-center gap-2 rounded-md border border-border px-3 text-sm"
              data-testid="workflow-agent-target"
            >
              <span className="truncate">{data.instanceName ?? "No n8n instance connected"}</span>
              <Badge variant="outline" className="capitalize">
                {data.selectedEnvironment}
              </Badge>
            </div>
          </div>

          <div className="flex h-9 items-center gap-3 rounded-md border border-border px-3">
            <Switch
              id="workflow-agent-write-mode"
              checked={mode === "write-enabled"}
              onCheckedChange={(checked) => setMode(checked ? "write-enabled" : "read-only")}
              aria-label="Lock or unlock write actions on this page"
            />
            <Label htmlFor="workflow-agent-write-mode" className="whitespace-nowrap text-sm">
              {mode === "write-enabled"
                ? "Write actions unlocked (this page)"
                : "Write actions locked (this page)"}
            </Label>
          </div>

          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={rollbackDisabled}
              onClick={() => void rollback()}
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              Rollback
            </Button>
            <Button type="button" disabled={applyDisabled} onClick={() => void applyUpdate()}>
              <Play className="h-4 w-4" aria-hidden="true" />
              Apply update
            </Button>
          </div>
        </div>
      </div>

      <div className="mt-5 grid gap-4 lg:grid-cols-[1fr_22rem]">
        <div className="grid gap-4">
          <Card className="rounded-lg shadow-sm">
            <CardHeader className="flex-row items-center justify-between gap-4 p-4">
              <div>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Diff className="h-4 w-4" aria-hidden="true" />
                  Workflow diff preview
                </CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Preview only. No workflow is modified until apply succeeds.
                </p>
              </div>
              <Badge variant="outline" className="whitespace-nowrap">
                {data.selectedEnvironment}
              </Badge>
            </CardHeader>
            <CardContent className="p-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-24 pl-4">Operation</TableHead>
                    <TableHead>Target</TableHead>
                    <TableHead>Before</TableHead>
                    <TableHead className="pr-4">After</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(
                    data.pendingUpdate?.operations.map(({ index, summary }) => ({
                      ...summary,
                      operationIndex: index,
                    })) ?? data.diff.map((entry) => ({ ...entry, operationIndex: undefined }))
                  ).map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="pl-4">
                        {typeof entry.operationIndex === "number" ? (
                          <input
                            type="checkbox"
                            data-operation-index={entry.operationIndex}
                            aria-label={`Select ${entry.target}`}
                            checked={selectedOperations.includes(entry.operationIndex)}
                            onChange={() =>
                              setSelectedOperations((current) =>
                                current.includes(entry.operationIndex as number)
                                  ? current.filter((index) => index !== entry.operationIndex)
                                  : [...current, entry.operationIndex as number],
                              )
                            }
                            className="mr-2 h-4 w-4 align-middle"
                          />
                        ) : null}
                        <span
                          className={cn(
                            "inline-flex rounded-md border px-2 py-1 text-xs font-medium capitalize",
                            diffClass(entry.operation),
                          )}
                        >
                          {entry.operation}
                        </span>
                      </TableCell>
                      <TableCell className="font-medium">{entry.target}</TableCell>
                      <TableCell className="text-muted-foreground">{entry.before ?? "-"}</TableCell>
                      <TableCell className="pr-4 text-muted-foreground">
                        {entry.after ?? "-"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="rounded-lg shadow-sm">
              <CardHeader className="p-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Activity className="h-4 w-4" aria-hidden="true" />
                  Tool-call timeline
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 px-4 pb-4">
                {data.toolCalls.map((call) => (
                  <div key={call.id} className="grid grid-cols-[1rem_1fr_auto] gap-3">
                    <div className="mt-1 flex flex-col items-center">
                      <span className="h-2.5 w-2.5 rounded-full bg-primary" />
                      <span className="mt-1 h-full w-px bg-border" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">{call.label}</p>
                        <span
                          className={cn(
                            "rounded-md border px-2 py-0.5 text-xs font-medium capitalize",
                            statusBadgeClass(call.status),
                          )}
                        >
                          {call.status}
                        </span>
                      </div>
                      <p className="mt-1 font-mono text-xs text-muted-foreground">{call.tool}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <div>{call.timestamp}</div>
                      <div>{call.durationMs}ms</div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="rounded-lg shadow-sm">
              <CardHeader className="p-4">
                <CardTitle className="flex items-center gap-2 text-base">
                  <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                  Validation results
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 px-4 pb-4">
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded-md border border-emerald-200 bg-emerald-50 p-2 text-emerald-700">
                    <div className="text-lg font-semibold">{validationSummary.pass}</div>
                    Pass
                  </div>
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-700">
                    <div className="text-lg font-semibold">{validationSummary.warning}</div>
                    Warnings
                  </div>
                  <div className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-destructive">
                    <div className="text-lg font-semibold">{validationSummary.error}</div>
                    Errors
                  </div>
                </div>
                {data.validation.map((result) => (
                  <div key={result.id} className="flex gap-3 rounded-md border border-border p-3">
                    <div className="mt-0.5">{validationIcon(result.severity)}</div>
                    <div>
                      <div className="text-sm font-medium">{result.scope}</div>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        {result.message}
                      </p>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </div>

        <aside className="grid content-start gap-4">
          <Card className="rounded-lg shadow-sm">
            <CardHeader className="p-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <ShieldCheck className="h-4 w-4" aria-hidden="true" />
                Policy and deploy status
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4 text-sm">
              <div className="rounded-md border border-border p-3">
                <div className="text-xs font-medium uppercase text-muted-foreground">Policy</div>
                <p className="mt-2 leading-6">
                  {data.policy?.summary ?? "No policy or confirmation record yet."}
                </p>
                <Badge variant="outline" className="mt-2 capitalize">
                  {data.policy?.status ?? "read-only"}
                </Badge>
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="text-xs font-medium uppercase text-muted-foreground">
                  Deploy/test
                </div>
                <p className="mt-2 leading-6">
                  {data.deployment?.summary ?? "No deploy or test run recorded yet."}
                </p>
                <Badge variant="outline" className="mt-2 capitalize">
                  {data.deployment?.status ?? "not-run"}
                </Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-sm">
            <CardHeader className="p-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <FileClock className="h-4 w-4" aria-hidden="true" />
                Template hits
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4">
              {(data.templateHits ?? []).length > 0 ? (
                data.templateHits?.map((hit) => (
                  <div key={hit.id} className="rounded-md border border-border p-3">
                    <div className="text-sm font-medium">{hit.name}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {hit.source}
                      {typeof hit.confidence === "number"
                        ? ` - ${Math.round(hit.confidence * 100)}% match`
                        : ""}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No template hit recorded yet.</p>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-sm">
            <CardHeader className="p-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <Gauge className="h-4 w-4" aria-hidden="true" />
                Quota and rate limits
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 px-4 pb-4">
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">{data.quota.plan} quota</span>
                  <span className="text-muted-foreground">
                    {data.quota.used}/{data.quota.limit}
                  </span>
                </div>
                <Progress value={quotaPercent} className="mt-2" />
              </div>
              <div>
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium">Rate remaining</span>
                  <span className="text-muted-foreground">
                    {data.quota.rateRemaining}/{data.quota.rateLimit}
                  </span>
                </div>
                <Progress value={ratePercent} className="mt-2" />
              </div>
              <div className="grid gap-2 text-sm text-muted-foreground">
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4" aria-hidden="true" />
                  Window: {data.quota.window}
                </div>
                <div className="flex items-center gap-2">
                  <FileClock className="h-4 w-4" aria-hidden="true" />
                  Reset: {data.quota.resetAt}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-sm">
            <CardHeader className="p-4">
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" aria-hidden="true" />
                AI reasoning and audit log
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 px-4 pb-4">
              {data.auditLog.map((entry) => (
                <div key={entry.id} className="rounded-md border border-border p-3">
                  <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1 font-medium uppercase">
                      <GitBranch className="h-3.5 w-3.5" aria-hidden="true" />
                      {entry.level}
                    </span>
                    <span>{entry.timestamp}</span>
                  </div>
                  {entry.concurrency ? (
                    <div className="mt-2 space-y-1" data-testid="audit-concurrency-warning">
                      <Badge
                        variant="outline"
                        className={cn(
                          "inline-flex items-center gap-1",
                          CONCURRENCY_BADGES[entry.concurrency].className,
                        )}
                      >
                        <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                        {CONCURRENCY_BADGES[entry.concurrency].label}
                      </Badge>
                      <p className="text-xs text-muted-foreground">
                        {CONCURRENCY_BADGES[entry.concurrency].detail}
                      </p>
                    </div>
                  ) : null}
                  <p className="mt-2 text-sm leading-6">{entry.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Actor: {entry.actor}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>
      {actionState.message ? (
        <p className="mt-3 text-sm text-muted-foreground" role="status">
          {actionState.message}
        </p>
      ) : null}
    </main>
  );
}
