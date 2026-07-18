import type { Json } from "@/integrations/supabase/types";

const MAX_METADATA_BYTES = 64 * 1024;
const SENSITIVE_KEY_PARTS = [
  "apikey",
  "api_key",
  "authorization",
  "cookie",
  "credential",
  "password",
  "secret",
  "sessiontoken",
  "token",
];

const AGENT_PLAN_TOOLS = new Set([
  "search_templates",
  "get_template",
  "search_nodes",
  "get_node",
  "validate_node",
  "preview_workflow_diff",
  "update_partial_workflow",
  "validate_workflow",
  "deploy_and_test_workflow",
  "fix_workflow_errors",
  "rollback_workflow",
]);

const WORKFLOW_ARGUMENT_TOOLS = new Set([
  "preview_workflow_diff",
  "update_partial_workflow",
  "deploy_and_test_workflow",
  "fix_workflow_errors",
]);

export type WorkflowAgentCallMetadata = Record<string, Json>;

export function toolBusinessOutcome(output: unknown): {
  success: boolean | null;
  errorMessage?: string;
} {
  const result = asRecord(output);
  if (result.success === false) {
    return {
      success: false,
      errorMessage: stringValue(result.message) ?? "Tool reported a business failure",
    };
  }
  if (result.success === true) return { success: true };
  return { success: null };
}

export function buildWorkflowAgentCallMetadata(
  name: string,
  args: Record<string, unknown>,
  output: unknown,
): WorkflowAgentCallMetadata {
  const result = asRecord(output);
  let metadata: Record<string, unknown> = {};

  if (name === "search_templates") {
    metadata = {
      query: stringValue(args.query),
      templateHits: templateHits(result.templates, "search_templates"),
    };
  } else if (name === "get_template") {
    const id = stringValue(result.id ?? args.id);
    const templateName = stringValue(result.name);
    metadata = {
      templateHits: id && templateName ? [{ id, name: templateName, source: "get_template" }] : [],
    };
  } else if (name === "preview_workflow_diff" || name === "update_partial_workflow") {
    metadata = {
      workflowId: stringValue(args.workflowId ?? result.workflowId),
      operations: Array.isArray(args.operations) ? args.operations : [],
      sourcePreviewCallId: stringValue(args.sourcePreviewCallId),
      diff: result.diff,
      validation: result.validation,
      baseVersionId: stringValue(result.baseVersionId),
      baseFingerprint: stringValue(result.baseFingerprint),
      resolvedPolicy: result.resolvedPolicy,
    };
  } else if (name === "rollback_workflow") {
    metadata = {
      workflowId: stringValue(result.workflow_id ?? result.workflowId),
      auditLogId: stringValue(args.auditLogId),
      businessSuccess: result.success === true,
    };
  } else if (name === "fix_workflow_errors") {
    metadata = {
      workflowId: stringValue(args.workflowId ?? result.workflowId ?? result.workflow_id),
      businessSuccess: result.success === true,
      mutationApplied: false,
      operations: Array.isArray(result.operations) ? result.operations : [],
      recommendations: Array.isArray(result.recommendations) ? result.recommendations : [],
      validation: result.validation,
      nextAction: stringValue(result.nextAction),
    };
  } else if (name === "deploy_and_test_workflow") {
    const results = asRecord(result.results);
    const test = asRecord(results.test);
    const activation = asRecord(results.activation);
    metadata = {
      workflowId: stringValue(args.workflowId ?? result.workflowId ?? result.workflow_id),
      workflowFingerprint: stringValue(result.workflowFingerprint),
      businessSuccess: result.success === true,
      mutationApplied: activation.success === true,
      validation: result.validation ?? results.validation,
      smokeTest: {
        success: test.success === true,
        error: stringValue(test.error),
      },
      activation: {
        success: activation.success === true,
        error: stringValue(activation.error),
      },
    };
  } else {
    return {};
  }

  const sanitized = sanitize(metadata) as WorkflowAgentCallMetadata;
  return JSON.stringify(sanitized).length > MAX_METADATA_BYTES ? { _truncated: true } : sanitized;
}

export function deriveAgentPlan(
  events: Array<{
    tool_name: string | null;
    status: string;
    created_at: string;
    metadata?: unknown;
  }>,
): Array<{ tool: string; status: "complete" | "blocked" | "pending" }> {
  return [...events]
    .filter((event): event is typeof event & { tool_name: string } =>
      Boolean(event.tool_name && AGENT_PLAN_TOOLS.has(event.tool_name)),
    )
    .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    .map((event) => ({
      tool: event.tool_name,
      status:
        asRecord(event.metadata).businessSuccess === false
          ? "blocked"
          : event.status === "ok"
            ? "complete"
            : event.status === "error" || event.status === "rate_limited"
              ? "blocked"
              : "pending",
    }));
}

export function workflowIdFromCall(
  name: string,
  args: Record<string, unknown>,
  output: unknown,
): string | null {
  const result = asRecord(output);
  if (WORKFLOW_ARGUMENT_TOOLS.has(name)) {
    return stringValue(args.workflowId ?? result.workflowId ?? result.workflow_id);
  }
  if (name === "rollback_workflow") {
    return stringValue(result.workflow_id ?? result.workflowId);
  }
  return null;
}

function templateHits(value: unknown, source: string): Json[] {
  if (!Array.isArray(value)) return [];

  return value.flatMap((candidate) => {
    const record = asRecord(candidate);
    const id = stringValue(record.id ?? record.templateId);
    const name = stringValue(record.name ?? record.templateName);
    if (!id || !name) return [];
    return [
      {
        id,
        name,
        ...(typeof record.confidence === "number" ? { confidence: record.confidence } : {}),
        source,
      },
    ];
  });
}

function sanitize(value: unknown, key = ""): Json {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (normalizedKey && SENSITIVE_KEY_PARTS.some((sensitive) => normalizedKey.includes(sensitive))) {
    return "[REDACTED]";
  }
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : String(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (typeof value !== "object") return String(value);

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .map(([entryKey, item]) => [entryKey, sanitize(item, entryKey)]),
  );
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
