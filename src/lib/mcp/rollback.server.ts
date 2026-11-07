// rollback_workflow: read-only precheck and the claimed, audited restore (server-only).
import type { CallerCtx } from "@/lib/mcp-upstream.server";
import {
  calculateChanges,
  getRollbackSnapshotForUser,
  markAuditRolledBack,
  recordWorkflowAudit,
  releaseAuditRollbackClaim,
} from "@/lib/audit.server";
import {
  ALREADY_ROLLED_BACK_MESSAGE,
  AUDIT_INSTANCE_MISMATCH_MESSAGE,
  ROLLBACK_CONFLICT_MESSAGE,
  ROLLBACK_UNVERIFIABLE_MESSAGE,
  WorkflowActionConflictError,
  assertSameInstance,
} from "@/lib/workflow-agent/action-conflict";
import { requireWorkflow, type WorkflowLike } from "@/lib/workflow-agent";
import { asObj, strId } from "./args";
import { workflowContentFingerprint } from "./fingerprint";
import { n8n } from "./n8n-client.server";
import { workflowValidationService } from "./services.server";
import type { N8nInstance } from "./types";
import {
  attachConcurrencyResult,
  concurrencyAuditParams,
  verifyWorkflowWrite,
} from "./write-verification.server";

type RollbackAuditRow = Awaited<ReturnType<typeof getRollbackSnapshotForUser>>;

/** Conflict codes the read-only rollback precheck can report. */
export type RollbackPrecheckConflict = Extract<
  WorkflowActionConflictError["code"],
  "instance_mismatch" | "rollback_conflict" | "rollback_unverifiable"
>;

/** Result of the read-only rollback precheck (see assessRollback). */
export type RollbackAssessment =
  | { ok: true; workflowId: string; concurrency: AuditedStateComparison["status"] }
  | { ok: false; conflict: RollbackPrecheckConflict; message: string };

/**
 * Reads the live workflow and compares it with the audited snapshot_after.
 * The live workflow is required: it is both the concurrency baseline and the
 * rollback's own before-snapshot, so an unreadable workflow fails closed.
 */
async function readRollbackBaseline(
  inst: N8nInstance,
  auditRow: RollbackAuditRow,
): Promise<{ current: WorkflowLike; concurrency: AuditedStateComparison }> {
  const current = requireWorkflow(
    await n8n(inst, `/api/v1/workflows/${encodeURIComponent(auditRow.workflow_id)}`),
  );
  return { current, concurrency: compareWithAuditedState(current, auditRow.snapshot_after) };
}

/** The conflict a non-forced rollback must refuse with, if any. */
function rollbackConcurrencyConflict(
  concurrency: AuditedStateComparison,
): WorkflowActionConflictError | null {
  if (concurrency.status === "changed") {
    return new WorkflowActionConflictError("rollback_conflict", ROLLBACK_CONFLICT_MESSAGE);
  }
  if (concurrency.status === "unverifiable") {
    return new WorkflowActionConflictError("rollback_unverifiable", ROLLBACK_UNVERIFIABLE_MESSAGE);
  }
  return null;
}

/**
 * Read-only rollback precheck: loads the audit row, verifies it was recorded
 * on `inst`, reads the live workflow and compares it with the audited
 * snapshot_after (versionId, else content fingerprint). Never writes, claims
 * or consumes anything, so callers can run it before asking for confirmation.
 * Reports every conflict regardless of `force`; the caller decides whether a
 * forced rollback may proceed (instance_mismatch never can). Other failures
 * (audit row missing or already rolled back, n8n unreachable) are thrown.
 */
export async function assessRollback(
  inst: N8nInstance,
  userId: string,
  auditLogId: string,
): Promise<RollbackAssessment> {
  return (await precheckRollback(inst, userId, auditLogId)).assessment;
}

/** assessRollback plus the audit row it loaded (null on instance_mismatch). */
export type RollbackPrecheck =
  | { auditRow: null; assessment: Extract<RollbackAssessment, { ok: false }> }
  | { auditRow: RollbackAuditRow; assessment: RollbackAssessment };

export async function precheckRollback(
  inst: N8nInstance,
  userId: string,
  auditLogId: string,
): Promise<RollbackPrecheck> {
  const auditRow = await getRollbackSnapshotForUser(userId, auditLogId);
  try {
    assertSameInstance(auditRow.instance_id, inst.id, AUDIT_INSTANCE_MISMATCH_MESSAGE);
  } catch (error) {
    if (!(error instanceof WorkflowActionConflictError)) throw error;
    return {
      auditRow: null,
      assessment: { ok: false, conflict: "instance_mismatch", message: error.message },
    };
  }
  const { concurrency } = await readRollbackBaseline(inst, auditRow);
  const conflict = rollbackConcurrencyConflict(concurrency);
  const assessment: RollbackAssessment = conflict
    ? {
        ok: false,
        conflict: conflict.code as RollbackPrecheckConflict,
        message: conflict.message,
      }
    : { ok: true, workflowId: auditRow.workflow_id, concurrency: concurrency.status };
  return { auditRow, assessment };
}

/** The caller and the validated rollback_workflow arguments. */
export function rollbackRequest(
  args: Record<string, unknown>,
  caller?: CallerCtx,
): { userId: string; auditLogId: string; force: boolean } {
  const userId = caller?.user_id;
  if (!userId) throw new Error("Authentication required");
  const auditLogId = String(args.auditLogId ?? "");
  if (!auditLogId) throw new Error("auditLogId is required");
  return { userId, auditLogId, force: args.force === true };
}

/**
 * Throws the precheck's conflict unless the rollback may proceed: a changed or
 * unverifiable workflow only with `force`, an instance mismatch never.
 */
export function assertRollbackAllowed(
  precheck: RollbackPrecheck,
  force: boolean,
): asserts precheck is Extract<RollbackPrecheck, { auditRow: RollbackAuditRow }> {
  if (!precheck.auditRow) {
    // instance_mismatch is never overridable by force.
    const { conflict, message } = precheck.assessment;
    throw new WorkflowActionConflictError(conflict, message);
  }
  const { assessment } = precheck;
  if (!assessment.ok && !force) {
    throw new WorkflowActionConflictError(assessment.conflict, assessment.message);
  }
}

/**
 * Roll a workflow back to a prior audited snapshot. Fails closed unless the
 * audit row was recorded on the instance the rollback runs on and the workflow
 * is unchanged since the audited mutation (unless `force: true`). Claims the
 * audit row (owner-scoped compare-and-set) before re-applying snapshot_before
 * to n8n, releases the claim if the final check or the restore fails, and
 * records the rollback itself as a new audit row.
 *
 * `precheck` is the read-only precheck dispatchTool already ran before asking
 * for confirmation; without it the precheck runs here.
 */
export async function handleRollback(
  args: Record<string, unknown>,
  inst: N8nInstance,
  caller?: CallerCtx,
  precheck?: RollbackPrecheck,
): Promise<unknown> {
  const { userId, auditLogId, force } = rollbackRequest(args, caller);

  // Fail fast with the shared read-only precheck (same checks the dashboard
  // runs before confirmation): no validation or claim for a doomed rollback.
  const checked = precheck ?? (await precheckRollback(inst, userId, auditLogId));
  assertRollbackAllowed(checked, force);
  const { auditRow } = checked;

  const snap = asObj(auditRow.snapshot_before);
  const workflowId = auditRow.workflow_id;
  const snapshotWorkflowId = strId(snap.id);
  if (snapshotWorkflowId && snapshotWorkflowId !== workflowId) {
    throw new Error("Rollback snapshot workflow id does not match the audit record");
  }

  const validation = await workflowValidationService.validateWorkflow(
    requireWorkflow({ ...snap, id: workflowId }),
  );
  if (!validation.ok) {
    return {
      success: false,
      workflow_id: workflowId,
      rolled_back_from: auditLogId,
      validation,
      message: "Rollback snapshot failed validation; workflow was not restored.",
    };
  }

  // Compare-and-set claim: only one rollback of this audit row may write to n8n.
  if (!(await markAuditRolledBack(userId, auditLogId))) {
    throw new WorkflowActionConflictError("already_rolled_back", ALREADY_ROLLED_BACK_MESSAGE);
  }

  let before: WorkflowLike;
  let concurrency: AuditedStateComparison;
  let restored: unknown;
  const payload = {
    name: snap.name,
    nodes: snap.nodes,
    connections: snap.connections,
    settings: snap.settings ?? {},
  };
  try {
    // Re-read the live workflow immediately before the PUT, after validation
    // and the claim, so the check-to-write window is as small as possible.
    // The n8n public API has no conditional PUT (no If-Match / expected
    // versionId), so this narrows but cannot close the race with an edit made
    // in n8n between this read and the PUT; the post-write verification below
    // detects and flags what it can of that race.
    ({ current: before, concurrency } = await readRollbackBaseline(inst, auditRow));
    const conflict = force ? null : rollbackConcurrencyConflict(concurrency);
    if (conflict) throw conflict;
    restored = await n8n(inst, `/api/v1/workflows/${encodeURIComponent(workflowId)}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    });
  } catch (error) {
    await releaseAuditRollbackClaim(userId, auditLogId);
    throw error;
  }

  // The restore is written: from here on nothing may release the claim or
  // fail the rollback. One re-read checks for a save around the PUT.
  const afterWrite = await verifyWorkflowWrite(
    inst,
    workflowId,
    payload,
    before,
    restored,
    "rollback_workflow",
  );

  const forced = force && concurrency.status !== "unchanged";
  await recordWorkflowAudit({
    userId,
    instanceId: inst.id,
    workflowId,
    operation: "update",
    snapshotBefore: before,
    snapshotAfter: restored,
    changes: calculateChanges(before, restored),
    aiReasoning: typeof args.reason === "string" ? args.reason : "rollback",
    toolName: "rollback_workflow",
    toolParams: {
      auditLogId,
      ...(force ? { force: true } : {}),
      concurrencyCheck: concurrency.status,
      concurrencySignal: concurrency.signal,
      concurrencyAfterWrite: concurrencyAuditParams(afterWrite),
    },
    ipAddress: caller?.ip ?? null,
    userAgent: caller?.ua ?? null,
    sessionId: caller?.request_id ?? null,
  });

  return attachConcurrencyResult(
    {
      success: true,
      workflow_id: workflowId,
      rolled_back_from: auditLogId,
      validation,
      workflow: restored,
      ...(forced
        ? { forced: true, overwrote_newer_changes: concurrency.status === "changed" }
        : {}),
    },
    afterWrite,
  );
}

type AuditedStateComparison = {
  /** unchanged: matches snapshot_after; changed: newer edits; unverifiable: no usable baseline. */
  status: "unchanged" | "changed" | "unverifiable";
  signal: "versionId" | "content" | null;
};

/**
 * Optimistic concurrency check for rollback: is the live workflow still the
 * state the audited mutation produced (its snapshot_after)? n8n assigns a new
 * versionId on every save, so a versionId on both sides is the authoritative
 * signal. Without one, fall back to a fingerprint of the editable content
 * (name, nodes, connections, settings). A missing or truncated snapshot_after
 * cannot rule out newer edits and is reported as unverifiable.
 */
function compareWithAuditedState(
  current: WorkflowLike,
  snapshotAfter: unknown,
): AuditedStateComparison {
  const after = asObj(snapshotAfter);
  const afterVersionId = strId(after.versionId);
  const currentVersionId = strId(current.versionId);
  if (afterVersionId && currentVersionId) {
    return {
      status: afterVersionId === currentVersionId ? "unchanged" : "changed",
      signal: "versionId",
    };
  }
  if (!Array.isArray(after.nodes)) return { status: "unverifiable", signal: null };
  return {
    status:
      workflowContentFingerprint(after as WorkflowLike) === workflowContentFingerprint(current)
        ? "unchanged"
        : "changed",
    signal: "content",
  };
}
