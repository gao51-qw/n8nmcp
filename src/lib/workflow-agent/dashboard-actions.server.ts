import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  assessRollback,
  checkShortWindowQuota,
  dispatchTool,
  effectiveTier,
  getDefaultInstance,
  recordCall,
  releaseDailyQuota,
  reserveDailyQuota,
} from "@/lib/mcp.server";
import {
  buildWorkflowAgentCallMetadata,
  workflowIdFromCall,
} from "@/lib/workflow-agent/call-metadata.server";
import { errorFields } from "@/lib/error-fields.server";
import { log } from "@/lib/logger.server";
import { persistedToolErrorMessage, sanitizedToolErrorMessage } from "@/lib/mcp-tool-errors";
import {
  AuditRollbackError,
  PREVIEW_INSTANCE_MISMATCH_MESSAGE,
  WorkflowActionConflictError,
  assertSameInstance,
} from "@/lib/workflow-agent/action-conflict";
import { createConfirmationService } from "@/lib/workflow-agent/confirmation.server";
import {
  assertTrustedWorkflowPreview,
  loadTrustedWorkflowPreview,
  type TrustedPreviewRow,
} from "@/lib/workflow-agent/trusted-preview.server";

type PreviewRow = TrustedPreviewRow;

type N8nInstance = NonNullable<Awaited<ReturnType<typeof getDefaultInstance>>>;
type Dispatch = typeof dispatchTool;

export type DashboardAgentAction =
  | {
      action: "apply";
      previewCallId: string;
      selectedOperationIndexes: number[];
      confirmationToken?: string;
    }
  | {
      action: "rollback";
      auditLogId: string;
      reason?: string;
      /**
       * Overwrite edits made after the audited change. Needs its own
       * confirmation token and never overrides an instance mismatch.
       */
      force?: boolean;
      confirmationToken?: string;
    };

export type DashboardAgentActionContext = {
  requestId: string;
  ip?: string;
  userAgent?: string;
};

export type DashboardAgentActionDependencies = {
  now: () => Date;
  loadPreview: (userId: string, previewCallId: string) => Promise<PreviewRow | null>;
  getInstance: (userId: string) => Promise<N8nInstance | null>;
  dispatch: Dispatch;
  /** Read-only rollback precheck, run before the confirmation token is consumed. */
  assessRollback: typeof assessRollback;
  recordCall: typeof recordCall;
  /**
   * Applies the short-window throttle and atomically reserves one unit of
   * daily quota; throws when the call may not run (nothing is reserved then).
   */
  checkQuota: (userId: string) => Promise<void>;
  /** Refunds the unit reserved by checkQuota. Must not throw. */
  releaseQuota: (userId: string) => Promise<void>;
  confirmation: {
    requireOrConsume(input: {
      userId: string;
      action: string;
      scope: unknown;
      confirmationToken?: string;
    }): Promise<void>;
  };
};

export class DashboardAgentActionError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DashboardAgentActionError";
  }
}

const defaultDependencies: DashboardAgentActionDependencies = {
  now: () => new Date(),
  async loadPreview(userId, previewCallId) {
    return loadTrustedWorkflowPreview(userId, previewCallId);
  },
  getInstance: getDefaultInstance,
  dispatch: dispatchTool,
  assessRollback,
  recordCall,
  async checkQuota(userId) {
    // One subscription lookup serves both limiters; without a tier,
    // checkShortWindowQuota would query the subscription again.
    const { data: subscription, error } = await supabaseAdmin
      .from("subscriptions")
      .select("tier,status")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load subscription: ${error.message}`);
    const tier = effectiveTier(subscription?.tier, subscription?.status);

    if (!(await checkShortWindowQuota(userId, tier))) {
      throw new DashboardAgentActionError(429, "rate_limited", "Rate limit exceeded");
    }

    const quota = await reserveDailyQuota({ user_id: userId, tier });
    if (!quota.ok) {
      throw new DashboardAgentActionError(
        429,
        "quota_exceeded",
        `Daily quota exceeded (${quota.used}/${quota.limit})`,
      );
    }
  },
  async releaseQuota(userId) {
    await releaseDailyQuota(userId);
  },
  confirmation: createConfirmationService(),
};

/**
 * Tracks the unit reserved by checkQuota for one action. Billing rule (same as
 * the MCP gateway, see reserveDailyQuota in mcp.server.ts): the unit is charged
 * once the tool was dispatched (success or tool error); rejected preconditions
 * (preview, instance, rollback precheck conflict, confirmation round-trip) and
 * a missing n8n instance are refunded.
 */
type QuotaReservation = { charged: boolean };

export async function executeDashboardAgentAction(
  userId: string,
  input: DashboardAgentAction,
  context: DashboardAgentActionContext,
  dependencies: DashboardAgentActionDependencies = defaultDependencies,
): Promise<{ action: DashboardAgentAction["action"]; output: unknown }> {
  await dependencies.checkQuota(userId);
  const reservation: QuotaReservation = { charged: false };
  try {
    return await performAction(userId, input, context, dependencies, reservation);
  } catch (error) {
    // Never let a failed refund mask the original error.
    if (!reservation.charged) await dependencies.releaseQuota(userId).catch(() => undefined);
    throw error;
  }
}

async function performAction(
  userId: string,
  input: DashboardAgentAction,
  context: DashboardAgentActionContext,
  dependencies: DashboardAgentActionDependencies,
  reservation: QuotaReservation,
): Promise<{ action: DashboardAgentAction["action"]; output: unknown }> {
  if (input.action === "apply") {
    const preview = await dependencies.loadPreview(userId, input.previewCallId);
    const trusted = trustedPreview(preview, userId, input, dependencies.now());
    const instance = await requireInstance(userId, dependencies);
    // The preview's diff and base version were computed on one instance; never
    // apply them to a different (or since-deleted) one.
    try {
      assertSameInstance(preview?.instance_id, instance.id, PREVIEW_INSTANCE_MISMATCH_MESSAGE);
    } catch (error) {
      throw toDashboardError(error);
    }
    await dependencies.confirmation.requireOrConsume({
      userId,
      action: "Apply workflow preview",
      scope: {
        previewCallId: input.previewCallId,
        selectedOperationIndexes: trusted.selectedIndexes,
      },
      confirmationToken: input.confirmationToken,
    });

    return dispatchAndRecord(
      userId,
      "apply",
      "update_partial_workflow",
      {
        workflowId: trusted.workflowId,
        operations: trusted.operations,
        expectedVersionId: trusted.baseVersionId,
        expectedFingerprint: trusted.baseFingerprint,
        sourcePreviewCallId: input.previewCallId,
        sourcePreviewOperationIndexes: trusted.selectedIndexes,
        confirm: true,
      },
      instance,
      context,
      dependencies,
      reservation,
    );
  }

  const force = input.force === true;
  const instance = await requireInstance(userId, dependencies);
  // Precheck before the confirmation token is consumed, so a conflicting
  // rollback is reported (and refunded) without spending the user's
  // confirmation. A changed or unverifiable workflow may be overwritten only
  // with force; an instance mismatch never may.
  // A missing or already rolled-back audit row is a precondition failure
  // (404 / 409, refunded), not a server error.
  let assessment: Awaited<ReturnType<typeof assessRollback>>;
  try {
    assessment = await dependencies.assessRollback(instance, userId, input.auditLogId);
  } catch (error) {
    throw toDashboardError(error);
  }
  if (!assessment.ok && (assessment.conflict === "instance_mismatch" || !force)) {
    throw new DashboardAgentActionError(409, assessment.conflict, assessment.message);
  }
  await dependencies.confirmation.requireOrConsume({
    userId,
    action: "Rollback workflow",
    // Same scope as the MCP path: a forced rollback needs its own token, so a
    // non-forced token cannot authorize overwriting newer edits.
    scope: force ? { auditLogId: input.auditLogId, force: true } : { auditLogId: input.auditLogId },
    confirmationToken: input.confirmationToken,
  });
  // rollback_workflow repeats these checks right before its PUT; a conflict
  // raised there (an edit landed after this precheck) is mapped to a 409 in
  // dispatchAndRecord.
  return dispatchAndRecord(
    userId,
    "rollback",
    "rollback_workflow",
    {
      auditLogId: input.auditLogId,
      reason: input.reason,
      ...(force ? { force: true } : {}),
      confirm: true,
    },
    instance,
    context,
    dependencies,
    reservation,
  );
}

async function requireInstance(
  userId: string,
  dependencies: DashboardAgentActionDependencies,
): Promise<N8nInstance> {
  const instance = await dependencies.getInstance(userId);
  if (!instance) {
    throw new DashboardAgentActionError(404, "instance_not_found", "No n8n instance configured");
  }
  return instance;
}

/**
 * Map typed workflow-action errors to dashboard errors with their fixed
 * messages: conflicts (instance mismatch, newer edits, stale preview, claimed
 * rollback) become 409, a missing audit row 404. Anything else is unchanged.
 */
function toDashboardError(error: unknown): unknown {
  if (error instanceof WorkflowActionConflictError) {
    return new DashboardAgentActionError(409, error.code, error.message);
  }
  if (error instanceof AuditRollbackError) {
    return error.code === "not_found"
      ? new DashboardAgentActionError(404, "not_found", error.message)
      : new DashboardAgentActionError(409, "already_rolled_back", error.message);
  }
  return error;
}

const N8N_UNAVAILABLE_MESSAGE =
  "n8n did not complete the request. Check that the instance is reachable and that its API key is still valid, then try again.";

const N8N_FAILURE_PATTERNS = [
  /^n8n (?:MCP )?request failed\b/i,
  /\bUnable to verify target host\b/i,
  /\bfetch failed\b/i,
  /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EHOSTUNREACH)\b/,
];

function isN8nFailure(error: Error): boolean {
  if (error.name === "AbortError" || error.name === "TimeoutError") return true;
  return N8N_FAILURE_PATTERNS.some((pattern) => pattern.test(error.message));
}

/**
 * Errors thrown while the tool ran. Typed conflicts keep their 409/404. A
 * message the MCP gateway would show to its clients (fixed workflow-agent
 * texts, validation feedback) becomes a 422 the console can display, and an
 * n8n transport failure a 502 with fixed guidance: both are expected outcomes
 * of the user's own instance, not faults, so the route does not report them
 * as internal errors. Anything else is unexpected and keeps propagating to the
 * generic 500 (and Sentry).
 */
function toolFailure(error: unknown): unknown {
  const mapped = toDashboardError(error);
  if (mapped instanceof DashboardAgentActionError || !(error instanceof Error)) return mapped;
  const safe = sanitizedToolErrorMessage(error.message);
  if (safe) return new DashboardAgentActionError(422, "tool_rejected", safe);
  if (isN8nFailure(error)) {
    return new DashboardAgentActionError(502, "n8n_unavailable", N8N_UNAVAILABLE_MESSAGE);
  }
  return error;
}

function trustedPreview(
  preview: PreviewRow | null,
  userId: string,
  input: Extract<DashboardAgentAction, { action: "apply" }>,
  now: Date,
) {
  const selectedIndexes = [...input.selectedOperationIndexes];
  const sortedIndexes = [...selectedIndexes].sort((a, b) => a - b);
  const metadata = asRecord(preview?.metadata);
  const workflowId = stringValue(metadata.workflowId ?? preview?.workflow_id);

  try {
    if (!workflowId)
      throw new Error("Workflow preview scope does not match the requested workflow");
    const trusted = assertTrustedWorkflowPreview({
      preview: preview as TrustedPreviewRow | null,
      userId,
      workflowId,
      operations: [],
      operationIndexes: sortedIndexes,
      now,
    });
    return { ...trusted, selectedIndexes: sortedIndexes };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Workflow preview is invalid";
    if (message.includes("not found")) {
      throw new DashboardAgentActionError(404, "preview_not_found", "Workflow preview not found");
    }
    if (message.includes("operation")) {
      throw new DashboardAgentActionError(
        422,
        "invalid_operation_selection",
        "Selected workflow operations are invalid",
      );
    }
    if (message.includes("stale")) {
      throw new DashboardAgentActionError(409, "stale_preview", "Workflow preview is stale");
    }
    throw new DashboardAgentActionError(
      409,
      "preview_mismatch",
      "Workflow preview scope is invalid",
    );
  }
}

async function dispatchAndRecord(
  userId: string,
  action: DashboardAgentAction["action"],
  toolName: "update_partial_workflow" | "rollback_workflow",
  args: Record<string, unknown>,
  instance: N8nInstance,
  context: DashboardAgentActionContext,
  dependencies: DashboardAgentActionDependencies,
  reservation: QuotaReservation,
) {
  const started = Date.now();
  let result: Awaited<ReturnType<Dispatch>>;
  try {
    result = await dependencies.dispatch(toolName, args, instance, {
      user_id: userId,
      source: "dashboard-agent-console",
      request_id: context.requestId,
      ip: context.ip,
      ua: context.userAgent,
      confirmationVerified: true,
    });
  } catch (error) {
    // Ordinary tool errors are billable: the tool was dispatched. The cause is
    // logged here because the response carries only fixed text.
    reservation.charged = true;
    log.warn("agent_console.tool_failed", {
      requestId: context.requestId,
      tool: toolName,
      ...errorFields(error),
    });
    await dependencies.recordCall({
      usage: "reserved",
      user_id: userId,
      instance_id: instance.id,
      tool_name: toolName,
      status: "error",
      latency_ms: Date.now() - started,
      // Persist only sanitized text, never the raw exception message.
      error_message: persistedToolErrorMessage(error, "Workflow action failed"),
      workflow_id: workflowIdFromCall(toolName, args, null),
      session_id: context.requestId,
    });
    throw toolFailure(error);
  }

  if (result.needsInstance) {
    // A configuration error is not billable; executeDashboardAgentAction
    // refunds the reservation when this error propagates.
    await dependencies.recordCall({
      usage: "none",
      user_id: userId,
      instance_id: instance.id,
      tool_name: toolName,
      status: "error",
      latency_ms: Date.now() - started,
      error_message: "no n8n instance configured",
      workflow_id: workflowIdFromCall(toolName, args, null),
      session_id: context.requestId,
    });
    throw new DashboardAgentActionError(404, "instance_not_found", "No n8n instance configured");
  }

  reservation.charged = true;
  await dependencies.recordCall({
    usage: "reserved",
    user_id: userId,
    instance_id: instance.id,
    tool_name: toolName,
    status: "ok",
    latency_ms: Date.now() - started,
    upstream: result.upstream,
    category: result.category,
    workflow_id: workflowIdFromCall(toolName, args, result.output),
    session_id: context.requestId,
    metadata: buildWorkflowAgentCallMetadata(toolName, args, result.output),
  });
  return { action, output: result.output };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
