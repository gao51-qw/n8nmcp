import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  checkDailyQuota,
  checkShortWindowQuota,
  dispatchTool,
  effectiveTier,
  getDefaultInstance,
  recordCall,
} from "@/lib/mcp.server";
import {
  buildWorkflowAgentCallMetadata,
  workflowIdFromCall,
} from "@/lib/workflow-agent/call-metadata.server";
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
  recordCall: typeof recordCall;
  checkQuota: (userId: string) => Promise<void>;
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
  recordCall,
  async checkQuota(userId) {
    if (!(await checkShortWindowQuota(userId))) {
      throw new DashboardAgentActionError(429, "rate_limited", "Rate limit exceeded");
    }

    const { data: subscription, error } = await supabaseAdmin
      .from("subscriptions")
      .select("tier,status")
      .eq("user_id", userId)
      .maybeSingle();
    if (error) throw new Error(`Failed to load subscription: ${error.message}`);

    const quota = await checkDailyQuota({
      user_id: userId,
      key_id: "dashboard-agent-console",
      tier: effectiveTier(subscription?.tier, subscription?.status),
    });
    if (!quota.ok) {
      throw new DashboardAgentActionError(
        429,
        "quota_exceeded",
        `Daily quota exceeded (${quota.used}/${quota.limit})`,
      );
    }
  },
  confirmation: createConfirmationService(),
};

export async function executeDashboardAgentAction(
  userId: string,
  input: DashboardAgentAction,
  context: DashboardAgentActionContext,
  dependencies: DashboardAgentActionDependencies = defaultDependencies,
): Promise<{ action: DashboardAgentAction["action"]; output: unknown }> {
  await dependencies.checkQuota(userId);

  if (input.action === "apply") {
    const preview = await dependencies.loadPreview(userId, input.previewCallId);
    const trusted = trustedPreview(preview, userId, input, dependencies.now());
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
      context,
      dependencies,
    );
  }

  await dependencies.confirmation.requireOrConsume({
    userId,
    action: "Rollback workflow",
    scope: { auditLogId: input.auditLogId },
    confirmationToken: input.confirmationToken,
  });
  return dispatchAndRecord(
    userId,
    "rollback",
    "rollback_workflow",
    {
      auditLogId: input.auditLogId,
      reason: input.reason,
      confirm: true,
    },
    context,
    dependencies,
  );
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
  context: DashboardAgentActionContext,
  dependencies: DashboardAgentActionDependencies,
) {
  const instance = await dependencies.getInstance(userId);
  if (!instance) {
    throw new DashboardAgentActionError(404, "instance_not_found", "No n8n instance configured");
  }

  const started = Date.now();
  try {
    const result = await dependencies.dispatch(toolName, args, instance, {
      user_id: userId,
      source: "dashboard-agent-console",
      request_id: context.requestId,
      ip: context.ip,
      ua: context.userAgent,
      confirmationVerified: true,
    });
    if (result.needsInstance) {
      throw new DashboardAgentActionError(404, "instance_not_found", "No n8n instance configured");
    }

    await dependencies.recordCall({
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
  } catch (error) {
    await dependencies.recordCall({
      user_id: userId,
      instance_id: instance.id,
      tool_name: toolName,
      status: "error",
      latency_ms: Date.now() - started,
      error_message: error instanceof Error ? error.message : "Workflow action failed",
      workflow_id: workflowIdFromCall(toolName, args, null),
      session_id: context.requestId,
    });
    throw error;
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
