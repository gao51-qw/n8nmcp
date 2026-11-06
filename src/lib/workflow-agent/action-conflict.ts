// Structured, fail-closed conflicts raised by workflow-agent mutations when the
// state a preview or audit entry was recorded against no longer holds. The
// message is fixed text (never derived from upstream responses), so callers may
// show and persist it; the code lets the dashboard map it to an HTTP status.

export type WorkflowActionConflictCode =
  "instance_mismatch" | "rollback_conflict" | "rollback_unverifiable" | "already_rolled_back";

export class WorkflowActionConflictError extends Error {
  constructor(
    public readonly code: WorkflowActionConflictCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowActionConflictError";
  }
}

export const PREVIEW_INSTANCE_MISMATCH_MESSAGE =
  "The n8n instance changed since this workflow preview was recorded; re-run preview_workflow_diff on the current instance before applying.";

export const AUDIT_INSTANCE_MISMATCH_MESSAGE =
  "The n8n instance changed since this audit entry was recorded; rollback was not applied.";

export const ROLLBACK_CONFLICT_MESSAGE =
  "The workflow changed since the audited change; rollback was not applied. Re-send with force: true to overwrite the newer edits.";

export const ROLLBACK_UNVERIFIABLE_MESSAGE =
  "The audit entry does not record the workflow state after the change, so newer edits cannot be ruled out; rollback was not applied. Re-send with force: true to overwrite the current workflow.";

export const ALREADY_ROLLED_BACK_MESSAGE =
  "This change has already been rolled back; rollback was not applied.";

/**
 * Fail closed unless the recorded instance is exactly the instance the action
 * would run on. A null/missing recorded id (e.g. the instance was deleted and
 * the foreign key set to null) is treated as a mismatch.
 */
export function assertSameInstance(
  recordedInstanceId: string | null | undefined,
  currentInstanceId: string,
  message: string,
): void {
  if (!recordedInstanceId || recordedInstanceId !== currentInstanceId) {
    throw new WorkflowActionConflictError("instance_mismatch", message);
  }
}
