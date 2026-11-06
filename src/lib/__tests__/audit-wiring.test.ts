import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOOLS } from "../mcp-tool-definitions";

// --- Part 1: the four audit tools are advertised and unique -----------------

const AUDIT_TOOL_NAMES = [
  "get_workflow_history",
  "rollback_workflow",
  "get_audit_statistics",
  "detect_suspicious_activity",
];

describe("audit tool advertisement", () => {
  const names = TOOLS.map((t) => t.name);

  it("advertises every audit tool through TOOLS", () => {
    for (const name of AUDIT_TOOL_NAMES) {
      expect(names, `${name} missing from TOOLS`).toContain(name);
    }
  });

  it("keeps tool names unique after adding the audit tools", () => {
    expect(new Set(names).size).toBe(names.length);
  });

  it("requires auditLogId on rollback_workflow", () => {
    const rollback = TOOLS.find((t) => t.name === "rollback_workflow");
    const schema = rollback?.inputSchema as { required?: string[] };
    expect(schema.required).toContain("auditLogId");
  });
});

describe("mutation audit outcome gating", () => {
  it("records only operations that actually mutated workflow state", async () => {
    const { shouldRecordMutationAudit } = await import("../mcp.server");

    expect(shouldRecordMutationAudit("fix_workflow_errors", { success: true })).toBe(false);
    expect(
      shouldRecordMutationAudit("deploy_and_test_workflow", {
        success: false,
        results: { activation: { success: false } },
      }),
    ).toBe(true);
    expect(
      shouldRecordMutationAudit("deploy_and_test_workflow", {
        success: true,
        results: { activation: { success: true }, test: { success: true } },
      }),
    ).toBe(true);
    expect(shouldRecordMutationAudit("update_partial_workflow", { success: false })).toBe(false);
  });
});

// --- Part 2: dispatchTool audit hook + read/rollback routing ----------------

const mocks = vi.hoisted(() => ({
  recordWorkflowAudit: vi.fn(async () => undefined),
  calculateChanges: vi.fn(() => []),
  getWorkflowHistory: vi.fn(async () => [{ id: "a1" }]),
  getAuditStatistics: vi.fn(async () => ({ total: 0, byOperation: {}, byDay: {} })),
  detectSuspiciousActivity: vi.fn(async () => []),
  markRolledBack: vi.fn(async (_userId: string, _auditLogId: string) => true),
  releaseRollbackClaim: vi.fn(async (_userId: string, _auditLogId: string) => undefined),
  getRollbackSnapshotForUser: vi.fn(),
  safeFetchPublicUrl: vi.fn(),
  loadTrustedWorkflowPreview: vi.fn(async () => ({
    id: "preview-1",
    user_id: "u1",
    instance_id: "inst-1",
    tool_name: "preview_workflow_diff",
    status: "ok",
    created_at: new Date().toISOString(),
    workflow_id: "wf-1",
    metadata: {
      workflowId: "wf-1",
      operations: [
        {
          type: "updateNode",
          nodeId: "manual",
          changes: { parameters: { note: "reviewed" } },
        },
      ],
    },
  })),
  confirmationTokens: new Map<string, string>(),
}));

vi.mock("../workflow-agent/confirmation.server", () => {
  class ConfirmationRequiredError extends Error {
    readonly code = "confirmation_required";
    constructor(
      public readonly token: string,
      public readonly expiresAt: string,
      public readonly summary: string,
    ) {
      super(`${summary} requires confirmation.`);
    }
  }
  return {
    ConfirmationRequiredError,
    createConfirmationService: () => ({
      requireOrConsume: vi.fn(
        async (input: {
          userId: string;
          action: string;
          scope: unknown;
          confirmationToken?: string;
        }) => {
          const key = `${input.userId}:${input.action}:${JSON.stringify(input.scope)}`;
          const issued = mocks.confirmationTokens.get(key);
          if (input.confirmationToken && input.confirmationToken === issued) {
            mocks.confirmationTokens.delete(key);
            return;
          }
          const token = `mcp_confirm_${mocks.confirmationTokens.size + 1}`;
          mocks.confirmationTokens.set(key, token);
          throw new ConfirmationRequiredError(token, "2026-07-10T00:05:00.000Z", input.action);
        },
      ),
    }),
  };
});

vi.mock("../audit.server", () => ({
  recordWorkflowAudit: mocks.recordWorkflowAudit,
  calculateChanges: mocks.calculateChanges,
  getWorkflowHistory: mocks.getWorkflowHistory,
  getAuditStatistics: mocks.getAuditStatistics,
  detectSuspiciousActivity: mocks.detectSuspiciousActivity,
  getRollbackSnapshotForUser: mocks.getRollbackSnapshotForUser,
  markAuditRolledBack: (userId: string, auditLogId: string) =>
    mocks.markRolledBack(userId, auditLogId),
  releaseAuditRollbackClaim: (userId: string, auditLogId: string) =>
    mocks.releaseRollbackClaim(userId, auditLogId),
}));

// The audited mutation produced the live "Before" workflow returned by the
// default n8n GET mock below, so a rollback of a1 passes the concurrency check.
function auditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "a1",
    instance_id: "inst-1",
    workflow_id: "wf-1",
    snapshot_before: {
      id: "wf-1",
      name: "Old",
      nodes: [
        {
          id: "manual",
          name: "Manual Trigger",
          type: "n8n-nodes-base.manualTrigger",
          typeVersion: 1,
          position: [0, 0],
          parameters: {},
        },
      ],
      connections: {},
    },
    snapshot_after: {
      id: "wf-1",
      name: "Before",
      active: false,
      nodes: [],
      connections: {},
      settings: {},
    },
    is_rolled_back: false,
    ...overrides,
  };
}

vi.mock("../ssrf-guard.server", () => ({
  safeFetchPublicUrl: mocks.safeFetchPublicUrl,
}));

vi.mock("../workflow-agent/trusted-preview.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workflow-agent/trusted-preview.server")>()),
  loadTrustedWorkflowPreview: mocks.loadTrustedWorkflowPreview,
}));

const inst = { id: "inst-1", name: "n8n", base_url: "https://n8n.example.com", api_key: "k" };
const caller = { user_id: "u1", key_id: "k1", ip: "1.2.3.4", ua: "agent", request_id: "req-1" };

// n8n GET returns the "before" workflow; PATCH/POST returns the "after".
function n8nResponse(_url: string, init?: { method?: string }) {
  const method = (init?.method ?? "GET").toUpperCase();
  // GET returns the full workflow (as n8n does) so update_workflow can build its PUT body.
  const body =
    method === "GET"
      ? { id: "wf-1", name: "Before", active: false, nodes: [], connections: {}, settings: {} }
      : { id: "wf-1", name: "New" };
  return Promise.resolve({ ok: true, status: 200, text: async () => JSON.stringify(body) });
}

async function getDispatch() {
  return (await import("../mcp.server")).dispatchTool;
}

async function issueRollbackConfirmationToken(
  dispatchTool: Awaited<ReturnType<typeof getDispatch>>,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    await dispatchTool("rollback_workflow", args, inst, caller);
  } catch (error) {
    const match = String((error as Error).message).match(/confirmationToken": "([^"]+)"/);
    return match?.[1] ?? "";
  }
  return "";
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.confirmationTokens.clear();
  mocks.safeFetchPublicUrl.mockImplementation(n8nResponse);
  mocks.getRollbackSnapshotForUser.mockImplementation(async () => auditRow());
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("dispatchTool audit hook", () => {
  it("records an update mutation with a before snapshot and correlation context", async () => {
    const dispatchTool = await getDispatch();

    await dispatchTool("update_workflow", { id: "wf-1", name: "New", confirm: true }, inst, caller);

    expect(mocks.recordWorkflowAudit).toHaveBeenCalledTimes(1);
    expect(mocks.recordWorkflowAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        workflowId: "wf-1",
        operation: "update",
        toolName: "update_workflow",
        snapshotBefore: expect.objectContaining({ name: "Before" }),
        snapshotAfter: expect.objectContaining({ name: "New" }),
        ipAddress: "1.2.3.4",
        sessionId: "req-1",
      }),
    );
  });

  it("does not audit a read-only tool", async () => {
    const dispatchTool = await getDispatch();
    await dispatchTool("get_workflow", { id: "wf-1" }, inst, caller);
    expect(mocks.recordWorkflowAudit).not.toHaveBeenCalled();
  });

  it("records partial workflow updates with post-confirmation before snapshot and agent metadata", async () => {
    const dispatchTool = await getDispatch();
    const operations = [
      {
        type: "updateNode",
        nodeId: "manual",
        changes: { parameters: { note: "reviewed" } },
      },
    ];
    const args = {
      workflowId: "wf-1",
      operations,
      sourcePreviewCallId: "preview-1",
      policy: { environment: "production" },
      template: { id: "tpl-1", name: "Invoice enrichment", confidence: 0.9 },
    };

    mocks.safeFetchPublicUrl
      .mockResolvedValueOnce(
        Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              id: "wf-1",
              name: "Before",
              active: false,
              nodes: [
                {
                  id: "manual",
                  name: "Manual",
                  type: "n8n-nodes-base.manualTrigger",
                  parameters: {},
                },
              ],
              connections: {},
            }),
        }),
      )
      .mockResolvedValueOnce(
        Promise.resolve({
          ok: true,
          status: 200,
          text: async () =>
            JSON.stringify({
              id: "wf-1",
              name: "After",
              nodes: [
                {
                  id: "manual",
                  name: "Manual",
                  type: "n8n-nodes-base.manualTrigger",
                  parameters: { note: "reviewed" },
                },
              ],
              connections: {},
            }),
        }),
      );

    let confirmationToken = "";
    try {
      await dispatchTool("update_partial_workflow", args, inst, caller);
    } catch (error) {
      confirmationToken =
        String((error as Error).message).match(/confirmationToken": "([^"]+)"/)?.[1] ?? "";
    }
    expect(confirmationToken).toMatch(/^mcp_confirm_/);
    expect(mocks.safeFetchPublicUrl).not.toHaveBeenCalled();

    const result = await dispatchTool(
      "update_partial_workflow",
      { ...args, confirm: true, confirmationToken },
      inst,
      caller,
    );

    expect(result.output).toMatchObject({
      success: true,
      diff: { changedNodes: ["manual"] },
      validation: { ok: true },
    });
    expect(mocks.recordWorkflowAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "update_partial_workflow",
        workflowId: "wf-1",
        snapshotBefore: expect.objectContaining({ name: "Before" }),
        snapshotAfter: expect.objectContaining({ name: "After" }),
        toolParams: expect.objectContaining({
          policy: { environment: "production" },
          template: { id: "tpl-1", name: "Invoice enrichment", confidence: 0.9 },
          diff: expect.objectContaining({ changedNodes: ["manual"] }),
          validation: expect.objectContaining({ ok: true }),
        }),
      }),
    );
  });
});

describe("dispatchTool audit read/rollback routing", () => {
  it("routes get_workflow_history to the audit module scoped by the caller's user id", async () => {
    const dispatchTool = await getDispatch();

    const result = await dispatchTool("get_workflow_history", { workflowId: "wf-1" }, null, caller);

    expect(mocks.getWorkflowHistory).toHaveBeenCalledWith("u1", "wf-1", 20);
    expect(result).toMatchObject({ needsInstance: false, output: { workflow_id: "wf-1" } });
  });

  it("rejects audit reads with no authenticated user", async () => {
    const dispatchTool = await getDispatch();
    await expect(
      dispatchTool("get_workflow_history", { workflowId: "wf-1" }, null, {}),
    ).rejects.toThrow(/auth/i);
  });

  it("flags rollback as needing an instance when none is configured", async () => {
    const dispatchTool = await getDispatch();
    const result = await dispatchTool("rollback_workflow", { auditLogId: "a1" }, null, caller);
    expect(result.needsInstance).toBe(true);
    expect(mocks.markRolledBack).not.toHaveBeenCalled();
  });

  it("requires a confirmation token before rolling back a workflow", async () => {
    const dispatchTool = await getDispatch();

    await expect(
      dispatchTool("rollback_workflow", { auditLogId: "a1" }, inst, caller),
    ).rejects.toThrow(/requires confirmation/);

    expect(mocks.markRolledBack).not.toHaveBeenCalled();
    expect(mocks.safeFetchPublicUrl).not.toHaveBeenCalled();
  });

  it("rejects rollback when confirm true is supplied without the issued token", async () => {
    const dispatchTool = await getDispatch();

    await expect(
      dispatchTool("rollback_workflow", { auditLogId: "a1", confirm: true }, inst, caller),
    ).rejects.toThrow(/confirmation token/);

    expect(mocks.markRolledBack).not.toHaveBeenCalled();
    expect(mocks.safeFetchPublicUrl).not.toHaveBeenCalled();
  });

  it("re-applies the prior snapshot and records the rollback as a new audit row", async () => {
    const dispatchTool = await getDispatch();
    const confirmationToken = await issueRollbackConfirmationToken(dispatchTool, {
      auditLogId: "a1",
    });
    expect(confirmationToken).toMatch(/^mcp_confirm_/);
    expect(mocks.markRolledBack).not.toHaveBeenCalled();

    const result = await dispatchTool(
      "rollback_workflow",
      { auditLogId: "a1", confirm: true, confirmationToken },
      inst,
      caller,
    );

    expect(mocks.markRolledBack).toHaveBeenCalledWith("u1", "a1");
    // PATCH back to n8n happened, and the rollback itself was audited.
    expect(mocks.recordWorkflowAudit).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "wf-1", toolName: "rollback_workflow" }),
    );
    expect(result).toMatchObject({ output: { success: true, workflow_id: "wf-1" } });
  });
});

describe("rollback instance binding and concurrency", () => {
  async function confirmedRollback(args: Record<string, unknown> = {}, instance = inst) {
    const dispatchTool = await getDispatch();
    const base = { auditLogId: "a1", ...args };
    let confirmationToken = "";
    try {
      await dispatchTool("rollback_workflow", base, instance, caller);
    } catch (error) {
      confirmationToken =
        String((error as Error).message).match(/confirmationToken": "([^"]+)"/)?.[1] ?? "";
    }
    expect(confirmationToken).toMatch(/^mcp_confirm_/);
    return dispatchTool(
      "rollback_workflow",
      { ...base, confirm: true, confirmationToken },
      instance,
      caller,
    );
  }

  function putCalls() {
    return mocks.safeFetchPublicUrl.mock.calls.filter(
      ([, init]) =>
        String((init as { method?: string } | undefined)?.method).toUpperCase() === "PUT",
    );
  }

  beforeEach(() => {
    mocks.markRolledBack.mockImplementation(async () => true);
  });

  it("refuses a rollback when the audit row was recorded on another instance", async () => {
    mocks.getRollbackSnapshotForUser.mockImplementation(async () =>
      auditRow({ instance_id: "inst-other" }),
    );

    await expect(confirmedRollback()).rejects.toMatchObject({
      name: "WorkflowActionConflictError",
      code: "instance_mismatch",
      message: expect.stringMatching(/instance changed since this audit entry/),
    });
    expect(mocks.safeFetchPublicUrl).not.toHaveBeenCalled();
    expect(mocks.markRolledBack).not.toHaveBeenCalled();
    expect(mocks.recordWorkflowAudit).not.toHaveBeenCalled();
  });

  it("treats a null recorded instance (deleted instance) as a mismatch", async () => {
    mocks.getRollbackSnapshotForUser.mockImplementation(async () =>
      auditRow({ instance_id: null }),
    );

    await expect(confirmedRollback()).rejects.toMatchObject({ code: "instance_mismatch" });
    expect(putCalls()).toHaveLength(0);
  });

  it("refuses to overwrite edits made after the audited change (versionId)", async () => {
    mocks.getRollbackSnapshotForUser.mockImplementation(async () =>
      auditRow({
        snapshot_after: { id: "wf-1", name: "After", versionId: "v-audited", nodes: [] },
      }),
    );
    mocks.safeFetchPublicUrl.mockImplementation((_url: string, init?: { method?: string }) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify(
            (init?.method ?? "GET") === "GET"
              ? { id: "wf-1", name: "After", versionId: "v-newer", nodes: [], connections: {} }
              : { id: "wf-1", name: "Old" },
          ),
      }),
    );

    await expect(confirmedRollback()).rejects.toMatchObject({
      code: "rollback_conflict",
      message: expect.stringMatching(/changed since the audited change/),
    });
    expect(putCalls()).toHaveLength(0);
    expect(mocks.markRolledBack).not.toHaveBeenCalled();
    expect(mocks.recordWorkflowAudit).not.toHaveBeenCalled();
  });

  it("refuses when content differs and no versionId is recorded", async () => {
    mocks.safeFetchPublicUrl.mockImplementation((_url: string, init?: { method?: string }) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify(
            (init?.method ?? "GET") === "GET"
              ? { id: "wf-1", name: "Edited by hand", nodes: [], connections: {}, settings: {} }
              : { id: "wf-1", name: "Old" },
          ),
      }),
    );

    await expect(confirmedRollback()).rejects.toMatchObject({ code: "rollback_conflict" });
    expect(putCalls()).toHaveLength(0);
  });

  it("refuses when the audit row cannot prove the workflow is unchanged", async () => {
    mocks.getRollbackSnapshotForUser.mockImplementation(async () =>
      auditRow({ snapshot_after: { _truncated: true, bytes: 999999 } }),
    );

    await expect(confirmedRollback()).rejects.toMatchObject({ code: "rollback_unverifiable" });
    expect(putCalls()).toHaveLength(0);
  });

  it("overwrites newer edits only with force: true and records that in the audit", async () => {
    mocks.getRollbackSnapshotForUser.mockImplementation(async () =>
      auditRow({ snapshot_after: { id: "wf-1", versionId: "v-audited", nodes: [] } }),
    );
    mocks.safeFetchPublicUrl.mockImplementation((_url: string, init?: { method?: string }) =>
      Promise.resolve({
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify(
            (init?.method ?? "GET") === "GET"
              ? { id: "wf-1", name: "After", versionId: "v-newer", nodes: [], connections: {} }
              : { id: "wf-1", name: "Old", versionId: "v-restored" },
          ),
      }),
    );

    const result = await confirmedRollback({ force: true });

    expect(result.output).toMatchObject({
      success: true,
      forced: true,
      overwrote_newer_changes: true,
    });
    expect(putCalls()).toHaveLength(1);
    expect(mocks.recordWorkflowAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "rollback_workflow",
        instanceId: "inst-1",
        toolParams: expect.objectContaining({
          auditLogId: "a1",
          force: true,
          concurrencyCheck: "changed",
          concurrencySignal: "versionId",
        }),
      }),
    );
  });

  it("does not let a non-forced confirmation token authorize a forced rollback", async () => {
    const dispatchTool = await getDispatch();
    const token = await issueRollbackConfirmationToken(dispatchTool, { auditLogId: "a1" });

    await expect(
      dispatchTool(
        "rollback_workflow",
        { auditLogId: "a1", force: true, confirm: true, confirmationToken: token },
        inst,
        caller,
      ),
    ).rejects.toThrow(/valid confirmation token/);
    expect(putCalls()).toHaveLength(0);
  });

  it("refuses a second rollback of the same audit row once it has been claimed", async () => {
    mocks.markRolledBack.mockImplementation(async () => false);

    await expect(confirmedRollback()).rejects.toMatchObject({ code: "already_rolled_back" });
    expect(putCalls()).toHaveLength(0);
    expect(mocks.recordWorkflowAudit).not.toHaveBeenCalled();
  });

  it("claims the audit row before the PUT and releases it when n8n rejects the restore", async () => {
    mocks.safeFetchPublicUrl.mockImplementation((url: string, init?: { method?: string }) => {
      if ((init?.method ?? "GET") === "PUT") {
        expect(mocks.markRolledBack).toHaveBeenCalledWith("u1", "a1");
        return Promise.resolve({ ok: false, status: 500, text: async () => "boom" });
      }
      return n8nResponse(url, init);
    });

    await expect(confirmedRollback()).rejects.toThrow();
    expect(putCalls()).toHaveLength(1);
    expect(mocks.releaseRollbackClaim).toHaveBeenCalledWith("u1", "a1");
    expect(mocks.recordWorkflowAudit).not.toHaveBeenCalled();
  });
});
