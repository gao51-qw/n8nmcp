import { describe, expect, it, vi } from "vitest";

import { ConfirmationRequiredError } from "../confirmation.server";
import {
  DashboardAgentActionError,
  executeDashboardAgentAction,
  type DashboardAgentActionDependencies,
} from "../dashboard-actions.server";

function dependencies(
  overrides: Partial<DashboardAgentActionDependencies> = {},
): DashboardAgentActionDependencies {
  return {
    now: () => new Date("2026-07-10T00:10:00.000Z"),
    loadPreview: vi.fn(async () => ({
      id: "preview-1",
      user_id: "user-1",
      tool_name: "preview_workflow_diff",
      status: "ok",
      created_at: "2026-07-10T00:05:00.000Z",
      workflow_id: "wf-1",
      metadata: {
        workflowId: "wf-1",
        baseVersionId: "v1",
        baseFingerprint: "fingerprint-1",
        operations: [
          { type: "updateNode", nodeId: "http", changes: { method: "GET" } },
          { type: "cleanStaleConnections" },
        ],
      },
    })),
    getInstance: vi.fn(async () => ({
      id: "instance-1",
      name: "Primary",
      base_url: "https://n8n.example.com",
      api_key: "secret",
    })),
    dispatch: vi.fn(async () => ({
      output: { success: true, workflowId: "wf-1" },
      upstream: false,
      category: "local" as const,
      needsInstance: false,
    })),
    recordCall: vi.fn(async () => undefined),
    checkQuota: vi.fn(async () => undefined),
    confirmation: { requireOrConsume: vi.fn(async () => undefined) },
    ...overrides,
  };
}

describe("dashboard workflow agent actions", () => {
  it("reloads a trusted preview and dispatches only selected operation indexes", async () => {
    const deps = dependencies();

    await executeDashboardAgentAction(
      "user-1",
      {
        action: "apply",
        previewCallId: "preview-1",
        selectedOperationIndexes: [1],
        confirmationToken: "mcp_confirm_valid",
      },
      { requestId: "request-1", ip: "203.0.113.1", userAgent: "test" },
      deps,
    );

    expect(deps.loadPreview).toHaveBeenCalledWith("user-1", "preview-1");
    expect(deps.dispatch).toHaveBeenCalledWith(
      "update_partial_workflow",
      expect.objectContaining({
        workflowId: "wf-1",
        operations: [{ type: "cleanStaleConnections" }],
        expectedVersionId: "v1",
        expectedFingerprint: "fingerprint-1",
        sourcePreviewCallId: "preview-1",
        sourcePreviewOperationIndexes: [1],
      }),
      expect.objectContaining({ id: "instance-1" }),
      expect.objectContaining({ user_id: "user-1", confirmationVerified: true }),
    );
  });

  it("does not accept duplicate or unknown operation indexes", async () => {
    const deps = dependencies();

    for (const selectedOperationIndexes of [[0, 0], [2]]) {
      await expect(
        executeDashboardAgentAction(
          "user-1",
          { action: "apply", previewCallId: "preview-1", selectedOperationIndexes },
          { requestId: "request-1" },
          deps,
        ),
      ).rejects.toMatchObject({ status: 422, code: "invalid_operation_selection" });
    }
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it("rejects stale previews before confirmation or mutation", async () => {
    const deps = dependencies({
      loadPreview: vi.fn(async () => ({
        id: "preview-old",
        user_id: "user-1",
        tool_name: "preview_workflow_diff",
        status: "ok",
        created_at: "2026-07-09T23:00:00.000Z",
        workflow_id: "wf-1",
        metadata: { workflowId: "wf-1", operations: [{ type: "cleanStaleConnections" }] },
      })),
    });

    await expect(
      executeDashboardAgentAction(
        "user-1",
        { action: "apply", previewCallId: "preview-old", selectedOperationIndexes: [0] },
        { requestId: "request-1" },
        deps,
      ),
    ).rejects.toMatchObject({ status: 409, code: "stale_preview" });
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it("propagates a structured durable confirmation challenge", async () => {
    const challenge = new ConfirmationRequiredError(
      "mcp_confirm_new",
      "2026-07-10T00:15:00.000Z",
      "Apply workflow preview",
    );
    const deps = dependencies({
      confirmation: { requireOrConsume: vi.fn(async () => Promise.reject(challenge)) },
    });

    await expect(
      executeDashboardAgentAction(
        "user-1",
        { action: "apply", previewCallId: "preview-1", selectedOperationIndexes: [0] },
        { requestId: "request-1" },
        deps,
      ),
    ).rejects.toBe(challenge);
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it("dispatches confirmed rollback by audit id through the safe rollback tool", async () => {
    const deps = dependencies();

    await executeDashboardAgentAction(
      "user-1",
      {
        action: "rollback",
        auditLogId: "audit-1",
        reason: "Undo failed production change",
        confirmationToken: "mcp_confirm_valid",
      },
      { requestId: "request-2" },
      deps,
    );

    expect(deps.dispatch).toHaveBeenCalledWith(
      "rollback_workflow",
      expect.objectContaining({ auditLogId: "audit-1", reason: "Undo failed production change" }),
      expect.objectContaining({ id: "instance-1" }),
      expect.objectContaining({ user_id: "user-1", confirmationVerified: true }),
    );
  });

  it("fails closed on quota denial", async () => {
    const quotaError = new DashboardAgentActionError(429, "quota_exceeded", "Quota exceeded");
    const deps = dependencies({ checkQuota: vi.fn(async () => Promise.reject(quotaError)) });

    await expect(
      executeDashboardAgentAction(
        "user-1",
        { action: "rollback", auditLogId: "audit-1" },
        { requestId: "request-2" },
        deps,
      ),
    ).rejects.toBe(quotaError);
    expect(deps.dispatch).not.toHaveBeenCalled();
  });
});
