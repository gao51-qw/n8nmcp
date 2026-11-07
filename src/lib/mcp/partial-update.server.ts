// preview_workflow_diff and update_partial_workflow: trusted-preview partial
// workflow updates with staleness, policy and validation gates (server-only).
import { optionalPolicy, requireOperations, requireWorkflow } from "@/lib/workflow-agent";
import {
  PREVIEW_STALE_MESSAGE,
  WorkflowActionConflictError,
} from "@/lib/workflow-agent/action-conflict";
import {
  assertTrustedWorkflowPreview,
  loadTrustedWorkflowPreview,
} from "@/lib/workflow-agent/trusted-preview.server";
import { optionalNumberArray, requireNonEmptyString, strId } from "./args";
import { workflowFingerprint } from "./fingerprint";
import { n8n } from "./n8n-client.server";
import {
  workflowDiffService,
  workflowOperationPolicyService,
  workflowValidationService,
} from "./services.server";
import type { N8nInstance, ToolContext } from "./types";
import { attachConcurrencyResult, putWorkflowAndVerify } from "./write-verification.server";

/**
 * Non-enumerable key on update_partial_workflow results that carries the
 * workflow read before the update, so the audit hook can use it as the
 * before-snapshot without a second GET.
 */
export const PARTIAL_UPDATE_AUDIT_BEFORE = Symbol("partialUpdateAuditBefore");

export async function previewWorkflowDiff(
  inst: N8nInstance,
  args: Record<string, unknown>,
): Promise<unknown> {
  const workflowId = requireNonEmptyString(args.workflowId, "workflowId");
  const operations = requireOperations(args.operations);
  const policy = optionalPolicy(args.policy, args.confirm, undefined);
  workflowOperationPolicyService.assertToolAllowed("preview_workflow_diff", policy);

  const current = requireWorkflow(
    await n8n(inst, `/api/v1/workflows/${encodeURIComponent(workflowId)}`),
  );
  const { workflow, diff } = workflowDiffService.applyOperations(current, operations);
  const validation = await workflowValidationService.validateWorkflow(workflow);

  return {
    success: true,
    workflowId,
    baseVersionId: strId(current.versionId) ?? undefined,
    baseFingerprint: workflowFingerprint(current),
    diff,
    validation,
  };
}

export async function updatePartialWorkflow(
  inst: N8nInstance,
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<unknown> {
  const workflowId = requireNonEmptyString(args.workflowId, "workflowId");
  const requestedOperations = requireOperations(args.operations);
  const sourcePreviewCallId = requireNonEmptyString(
    args.sourcePreviewCallId,
    "sourcePreviewCallId",
  );
  const userId = context?.user_id;
  if (!userId) throw new Error("Authentication required for partial workflow updates");
  const operationIndexes = optionalNumberArray(
    args.sourcePreviewOperationIndexes,
    "sourcePreviewOperationIndexes",
  );
  const preview = await loadTrustedWorkflowPreview(userId, sourcePreviewCallId);
  const trustedPreview = assertTrustedWorkflowPreview({
    preview,
    userId,
    workflowId,
    operations: requestedOperations,
    operationIndexes,
    // The preview row stores the MCP session it was recorded under (never the
    // per-request id), so compare it with the caller's session of the same kind.
    sessionId: context?.session_id,
    // The update runs on `inst`; refuse a preview computed on another instance.
    instanceId: inst.id,
  });
  const operations = requireOperations(trustedPreview.operations);
  const policy = optionalPolicy(args.policy, args.confirm, context?.policy);
  workflowOperationPolicyService.assertToolAllowed("update_partial_workflow", policy);
  workflowOperationPolicyService.assertOperationsAllowed(operations, policy);

  const current = requireWorkflow(
    await n8n(inst, `/api/v1/workflows/${encodeURIComponent(workflowId)}`),
  );
  const currentVersionId = strId(current.versionId);
  const currentFingerprint = workflowFingerprint(current);
  const expectedVersionId = trustedPreview.baseVersionId;
  const expectedFingerprint = trustedPreview.baseFingerprint;
  if (
    (expectedVersionId && expectedVersionId !== currentVersionId) ||
    (expectedFingerprint && expectedFingerprint !== currentFingerprint)
  ) {
    // An expected outcome (the workflow changed in n8n after the preview),
    // not a fault: a typed conflict, so the gateway skips Sentry.
    throw new WorkflowActionConflictError("preview_stale", PREVIEW_STALE_MESSAGE);
  }
  workflowOperationPolicyService.assertOperationsAllowed(operations, policy, current);

  const { workflow, diff } = workflowDiffService.applyOperations(current, operations);
  const validation = await workflowValidationService.validateWorkflow(workflow);

  if (!validation.ok) {
    const blocked = {
      success: false,
      workflowId,
      diff,
      validation,
      message: "Validation failed; workflow was not updated.",
    };
    Object.defineProperty(blocked, PARTIAL_UPDATE_AUDIT_BEFORE, { value: current });
    return blocked;
  }

  const { toWorkflowUpdatePayload } = await import("@/lib/workflow-graph");
  // `current` is the last read before the PUT (the staleness check above). The
  // n8n Public API cannot make the PUT conditional on it, so the write is
  // verified with one re-read: a concurrent save is flagged, not prevented.
  const { written: updated, concurrency } = await putWorkflowAndVerify(
    inst,
    workflowId,
    toWorkflowUpdatePayload(workflow),
    current,
    "update_partial_workflow",
  );

  const result = {
    success: true,
    workflow: updated,
    diff,
    validation,
    resolvedPolicy: policy,
  };
  Object.defineProperty(result, PARTIAL_UPDATE_AUDIT_BEFORE, { value: current });
  return attachConcurrencyResult(result, concurrency);
}
