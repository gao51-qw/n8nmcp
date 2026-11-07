// --- Workflow audit wiring -------------------------------------------------
// A single, data-driven audit hook lives in dispatchTool. It covers CRUD,
// blueprint and the orchestrated create/fix/deploy tools uniformly, mirroring
// the centralized recordCall() pattern. Read/rollback audit tools are
// intercepted in dispatchTool too because they need the caller's user id
// (rollback also needs an n8n instance to re-apply the snapshot).
import type { CallerCtx } from "@/lib/mcp-upstream.server";
import {
  calculateChanges,
  detectSuspiciousActivity,
  getAuditStatistics,
  getWorkflowHistory,
  recordWorkflowAudit,
  type WorkflowAuditOperation,
} from "@/lib/audit.server";
import { asObj, idOf, strId } from "./args";
import { n8n } from "./n8n-client.server";
import { PARTIAL_UPDATE_AUDIT_BEFORE } from "./partial-update.server";
import type { N8nInstance } from "./types";
import {
  concurrencyAuditParams,
  concurrencyFromResult,
  withoutConcurrencyOutput,
} from "./write-verification.server";

export const AUDIT_READ_TOOLS = new Set<string>([
  "get_workflow_history",
  "get_audit_statistics",
  "detect_suspicious_activity",
]);

export type MutationDescriptor = {
  op: (args: Record<string, unknown>) => WorkflowAuditOperation;
  captureBefore: boolean;
  idFrom: (args: Record<string, unknown>, out: unknown) => string | undefined;
  after: (out: unknown) => unknown;
};

// Workflow-creating orchestrated/blueprint tools all return { workflow: <created> }.
const createFromWorkflowField: MutationDescriptor = {
  op: () => "create",
  captureBefore: false,
  idFrom: (_a, o) => idOf(asObj(o).workflow),
  after: (o) => asObj(o).workflow,
};

export const MUTATION_DESCRIPTORS: Record<string, MutationDescriptor> = {
  create_workflow: {
    op: () => "create",
    captureBefore: false,
    idFrom: (_a, o) => idOf(o),
    after: (o) => o,
  },
  update_workflow: {
    op: () => "update",
    captureBefore: true,
    idFrom: (a) => strId(a.id),
    // The output is the n8n workflow itself; keep flag fields out of the snapshot.
    after: (o) => withoutConcurrencyOutput(o),
  },
  delete_workflow: {
    op: () => "delete",
    captureBefore: true,
    idFrom: (a) => strId(a.id),
    after: () => null,
  },
  activate_workflow: {
    op: (a) => (a.active ? "activate" : "deactivate"),
    captureBefore: true,
    idFrom: (a) => strId(a.id),
    after: (o) => o,
  },
  import_workflow_template: {
    op: () => "create",
    captureBefore: false,
    idFrom: (_a, o) => strId(asObj(o).workflow_id),
    after: (o) => o,
  },
  apply_workflow_patch: {
    op: () => "update",
    captureBefore: true,
    idFrom: (a) => strId(a.id),
    after: (o) => asObj(o).workflow ?? o,
  },
  safe_apply_workflow_patch: {
    op: () => "update",
    captureBefore: true,
    idFrom: (a) => strId(a.id),
    after: (o) => asObj(o).workflow ?? o,
  },
  update_partial_workflow: {
    op: () => "update",
    captureBefore: true,
    idFrom: (a) => strId(a.workflowId),
    after: (o) => asObj(o).workflow ?? o,
  },
  clone_workflow_as_draft: {
    op: () => "create",
    captureBefore: false,
    idFrom: (_a, o) => idOf(asObj(o).draft_workflow),
    after: (o) => asObj(o).draft_workflow,
  },
  safe_apply_workflow_simplification: {
    op: () => "create",
    captureBefore: false,
    idFrom: (_a, o) => idOf(asObj(o).draft_workflow),
    after: (o) => asObj(o).draft_workflow,
  },
  create_workflow_from_blueprint: createFromWorkflowField,
  create_scheduled_workflow: createFromWorkflowField,
  create_webhook_workflow: createFromWorkflowField,
  create_email_workflow: createFromWorkflowField,
  create_ai_chatbot_workflow: createFromWorkflowField,
  deploy_and_test_workflow: {
    op: () => "update",
    captureBefore: true,
    idFrom: (a) => strId(a.workflowId),
    after: (o) => asObj(o).workflow ?? o,
  },
};

/** GET a workflow for a before-snapshot. A failed fetch must never block the mutation. */
export async function fetchSnapshotSafe(inst: N8nInstance, id: string): Promise<unknown> {
  try {
    return await n8n(inst, `/api/v1/workflows/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

/** Write the audit row for a completed mutation. Best-effort; never throws into dispatch. */
export async function recordMutationAudit(
  name: string,
  desc: MutationDescriptor,
  args: Record<string, unknown>,
  out: unknown,
  before: unknown,
  inst: N8nInstance,
  caller: CallerCtx,
): Promise<void> {
  const userId = caller.user_id;
  if (!userId) return;
  try {
    const outRecord = asObj(out);
    const auditBefore =
      before ?? (outRecord as Record<PropertyKey, unknown>)[PARTIAL_UPDATE_AUDIT_BEFORE] ?? null;
    const reportedAfter = desc.after(out);
    const deploymentActivated =
      name === "deploy_and_test_workflow"
        ? asObj(asObj(outRecord.results).activation).success === true
        : null;
    const after = deploymentActivated === false ? auditBefore : reportedAfter;
    const workflowId = desc.idFrom(args, out) ?? strId(args.id) ?? strId(args.workflowId);
    if (!workflowId) return;
    await recordWorkflowAudit({
      userId,
      instanceId: inst.id,
      workflowId,
      operation: desc.op(args),
      snapshotBefore: auditBefore,
      snapshotAfter: after,
      changes: auditBefore ? calculateChanges(auditBefore, after) : undefined,
      aiReasoning: typeof args.reasoning === "string" ? args.reasoning : null,
      toolName: name,
      toolParams: auditToolParams(name, args, out),
      ipAddress: caller.ip ?? null,
      userAgent: caller.ua ?? null,
      sessionId: caller.request_id ?? null,
    });
  } catch (e) {
    console.warn("[mcp.audit] hook failed", e);
  }
}

export function shouldRecordMutationAudit(name: string, output: unknown): boolean {
  const result = asObj(output);
  if (name === "deploy_and_test_workflow") {
    return Object.keys(asObj(result.results)).length > 0;
  }
  if (name === "fix_workflow_errors" || result.success === false) return false;
  return true;
}

function auditToolParams(
  name: string,
  args: Record<string, unknown>,
  out: unknown,
): Record<string, unknown> {
  const output = asObj(out);
  const concurrency = concurrencyFromResult(out);
  if (name === "deploy_and_test_workflow") {
    const results = asObj(output.results);
    const test = asObj(results.test);
    const activation = asObj(results.activation);
    return {
      workflowId: strId(args.workflowId),
      workflowFingerprint: strId(output.workflowFingerprint),
      businessSuccess: output.success === true,
      validation: results.validation,
      smokeTest: {
        success: test.success === true,
        error: typeof test.error === "string" ? test.error : null,
      },
      activation: {
        success: activation.success === true,
        error: typeof activation.error === "string" ? activation.error : null,
      },
    };
  }
  return {
    ...args,
    // Set only by the post-write verification, never from caller arguments
    // (undefined is dropped when the row is serialized).
    concurrencyAfterWrite: concurrency ? concurrencyAuditParams(concurrency) : undefined,
    ...(output.diff !== undefined ? { diff: output.diff } : {}),
    ...(output.validation !== undefined ? { validation: output.validation } : {}),
    ...(output.results !== undefined ? { results: output.results } : {}),
    ...(output.resolvedPolicy !== undefined ? { resolvedPolicy: output.resolvedPolicy } : {}),
    ...(name === "fix_workflow_errors" && output.applied !== undefined
      ? { applied: output.applied }
      : {}),
  };
}

export async function handleAuditReadTool(
  name: string,
  args: Record<string, unknown>,
  userId: string | undefined,
): Promise<unknown> {
  if (!userId) throw new Error("Authentication required");
  switch (name) {
    case "get_workflow_history": {
      const workflowId = String(args.workflowId ?? "");
      if (!workflowId) throw new Error("workflowId is required");
      const limit = typeof args.limit === "number" ? args.limit : 20;
      return {
        workflow_id: workflowId,
        history: await getWorkflowHistory(userId, workflowId, limit),
      };
    }
    case "get_audit_statistics": {
      const days = typeof args.days === "number" ? args.days : 30;
      return getAuditStatistics(userId, days);
    }
    case "detect_suspicious_activity": {
      const hours = typeof args.hours === "number" ? args.hours : 24;
      return { findings: await detectSuspiciousActivity(userId, hours) };
    }
    default:
      throw new Error(`Unknown audit tool: ${name}`);
  }
}
