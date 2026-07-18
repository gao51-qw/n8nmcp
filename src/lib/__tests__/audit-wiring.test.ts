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
  markRolledBack: vi.fn(async (_userId: string, _auditLogId: string) => ({
    id: "wf-1",
    name: "Old",
    nodes: [],
    connections: {},
  })),
  safeFetchPublicUrl: vi.fn(),
  loadTrustedWorkflowPreview: vi.fn(async () => ({
    id: "preview-1",
    user_id: "u1",
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
  markRolledBack: mocks.markRolledBack,
  getRollbackSnapshotForUser: vi.fn(async () => ({
    id: "a1",
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
    is_rolled_back: false,
  })),
  markAuditRolledBack: vi.fn(async (userId: string, auditLogId: string) => {
    await mocks.markRolledBack(userId, auditLogId);
  }),
}));

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
  const body = method === "GET" ? { id: "wf-1", name: "Before" } : { id: "wf-1", name: "New" };
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
