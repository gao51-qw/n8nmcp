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
      instance_id: "instance-1",
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
    releaseQuota: vi.fn(async () => undefined),
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

  it("refuses to apply a preview recorded on a different instance before confirmation", async () => {
    const deps = dependencies({
      getInstance: vi.fn(async () => ({
        id: "instance-2",
        name: "Secondary",
        base_url: "https://other.example.com",
        api_key: "secret",
      })),
    });

    await expect(
      executeDashboardAgentAction(
        "user-1",
        {
          action: "apply",
          previewCallId: "preview-1",
          selectedOperationIndexes: [0],
          confirmationToken: "mcp_confirm_valid",
        },
        { requestId: "request-1" },
        deps,
      ),
    ).rejects.toMatchObject({
      status: 409,
      code: "instance_mismatch",
      message: expect.stringMatching(/instance changed since this workflow preview/),
    });
    expect(deps.confirmation.requireOrConsume).not.toHaveBeenCalled();
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it("treats a preview whose instance was deleted as an instance mismatch", async () => {
    const base = dependencies();
    const preview = await base.loadPreview("user-1", "preview-1");
    const deps = dependencies({
      loadPreview: vi.fn(async () => ({ ...preview!, instance_id: null })),
    });

    await expect(
      executeDashboardAgentAction(
        "user-1",
        { action: "apply", previewCallId: "preview-1", selectedOperationIndexes: [0] },
        { requestId: "request-1" },
        deps,
      ),
    ).rejects.toMatchObject({ status: 409, code: "instance_mismatch" });
    expect(deps.dispatch).not.toHaveBeenCalled();
  });

  it("maps rollback conflicts from the tool to 409 errors and records sanitized text", async () => {
    const { WorkflowActionConflictError, AUDIT_INSTANCE_MISMATCH_MESSAGE } =
      await import("../action-conflict");
    const deps = dependencies({
      dispatch: vi.fn(async () => {
        throw new WorkflowActionConflictError("instance_mismatch", AUDIT_INSTANCE_MISMATCH_MESSAGE);
      }),
    });

    await expect(
      executeDashboardAgentAction(
        "user-1",
        { action: "rollback", auditLogId: "audit-1", confirmationToken: "mcp_confirm_valid" },
        { requestId: "request-2" },
        deps,
      ),
    ).rejects.toMatchObject({
      name: "DashboardAgentActionError",
      status: 409,
      code: "instance_mismatch",
    });
    expect(deps.recordCall).toHaveBeenCalledWith(
      expect.objectContaining({ status: "error", error_message: AUDIT_INSTANCE_MISMATCH_MESSAGE }),
    );
  });

  it("never persists a raw exception message from a failed action", async () => {
    const deps = dependencies({
      dispatch: vi.fn(async () => {
        throw new TypeError("connect ECONNREFUSED 10.0.0.5:5678 Bearer abc.def");
      }),
    });

    await expect(
      executeDashboardAgentAction(
        "user-1",
        { action: "rollback", auditLogId: "audit-1", confirmationToken: "mcp_confirm_valid" },
        { requestId: "request-2" },
        deps,
      ),
    ).rejects.toBeInstanceOf(TypeError);
    expect(deps.recordCall).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "error",
        error_message: "Workflow action failed (TypeError)",
      }),
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
    // Nothing was reserved, so nothing is refunded.
    expect(deps.releaseQuota).not.toHaveBeenCalled();
  });
});

describe("dashboard workflow agent quota reservation", () => {
  const rollback = {
    action: "rollback" as const,
    auditLogId: "audit-1",
    confirmationToken: "mcp_confirm_valid",
  };

  it("reserves before dispatch and charges a dispatched action once", async () => {
    const deps = dependencies();

    await executeDashboardAgentAction("user-1", rollback, { requestId: "request-3" }, deps);

    expect(deps.checkQuota).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(vi.mocked(deps.checkQuota).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(deps.dispatch).mock.invocationCallOrder[0],
    );
    expect(deps.releaseQuota).not.toHaveBeenCalled();
    expect(deps.recordCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: "ok", usage: "reserved" }),
    );
  });

  it("charges ordinary tool errors", async () => {
    const deps = dependencies({
      dispatch: vi.fn(async () => {
        throw new Error("n8n returned 500");
      }),
    });

    await expect(
      executeDashboardAgentAction("user-1", rollback, { requestId: "request-3" }, deps),
    ).rejects.toThrow("n8n returned 500");
    expect(deps.releaseQuota).not.toHaveBeenCalled();
    expect(deps.recordCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: "error", usage: "reserved" }),
    );
  });

  it("refunds the reservation when the tool reports no n8n instance", async () => {
    const deps = dependencies({
      dispatch: vi.fn(async () => ({
        output: null,
        upstream: false,
        category: "management" as const,
        needsInstance: true,
      })),
    });

    await expect(
      executeDashboardAgentAction("user-1", rollback, { requestId: "request-3" }, deps),
    ).rejects.toMatchObject({ status: 404, code: "instance_not_found" });
    expect(deps.releaseQuota).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(deps.recordCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: "error", usage: "none" }),
    );
  });

  it("refunds the reservation when no instance is configured before dispatch", async () => {
    const deps = dependencies({ getInstance: vi.fn(async () => null) });

    await expect(
      executeDashboardAgentAction("user-1", rollback, { requestId: "request-3" }, deps),
    ).rejects.toMatchObject({ status: 404, code: "instance_not_found" });
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(deps.releaseQuota).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(deps.recordCall).not.toHaveBeenCalled();
  });

  it("refunds the reservation for a confirmation round-trip", async () => {
    const challenge = new ConfirmationRequiredError(
      "mcp_confirm_new",
      "2026-07-10T00:15:00.000Z",
      "Rollback workflow",
    );
    const deps = dependencies({
      confirmation: { requireOrConsume: vi.fn(async () => Promise.reject(challenge)) },
    });

    await expect(
      executeDashboardAgentAction(
        "user-1",
        { action: "rollback", auditLogId: "audit-1" },
        { requestId: "request-3" },
        deps,
      ),
    ).rejects.toBe(challenge);
    expect(deps.releaseQuota).toHaveBeenCalledExactlyOnceWith("user-1");
  });

  it("refunds the reservation when the preview is rejected", async () => {
    const deps = dependencies({ loadPreview: vi.fn(async () => null) });

    await expect(
      executeDashboardAgentAction(
        "user-1",
        { action: "apply", previewCallId: "missing", selectedOperationIndexes: [0] },
        { requestId: "request-3" },
        deps,
      ),
    ).rejects.toBeInstanceOf(DashboardAgentActionError);
    expect(deps.dispatch).not.toHaveBeenCalled();
    expect(deps.releaseQuota).toHaveBeenCalledExactlyOnceWith("user-1");
  });

  it("does not let a failed refund mask the original error", async () => {
    const deps = dependencies({
      getInstance: vi.fn(async () => null),
      releaseQuota: vi.fn(async () => Promise.reject(new Error("refund failed"))),
    });

    await expect(
      executeDashboardAgentAction("user-1", rollback, { requestId: "request-3" }, deps),
    ).rejects.toMatchObject({ code: "instance_not_found" });
  });
});
