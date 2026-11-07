// Post-write concurrency verification of n8n workflow writes
// (src/lib/mcp/write-verification.server.ts) and its wiring into
// update_partial_workflow, rollback_workflow and update_workflow.
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CONCURRENT_WRITE_DETECTED_MESSAGE } from "@/lib/workflow-agent/action-conflict";
import { sanitizedToolErrorMessage } from "../mcp-tool-errors";

const mocks = vi.hoisted(() => ({
  recordWorkflowAudit: vi.fn(async (_entry: Record<string, unknown>) => undefined),
  getRollbackSnapshotForUser: vi.fn(),
  markAuditRolledBack: vi.fn(async () => true),
  releaseAuditRollbackClaim: vi.fn(async () => undefined),
  safeFetchPublicUrl: vi.fn(),
  loadTrustedWorkflowPreview: vi.fn(),
  logWarn: vi.fn(),
  captureMessage: vi.fn(() => "sentry-event"),
}));

vi.mock("../audit.server", () => ({
  recordWorkflowAudit: mocks.recordWorkflowAudit,
  calculateChanges: vi.fn(() => []),
  getWorkflowHistory: vi.fn(async () => []),
  getAuditStatistics: vi.fn(async () => ({})),
  detectSuspiciousActivity: vi.fn(async () => []),
  getRollbackSnapshotForUser: mocks.getRollbackSnapshotForUser,
  markAuditRolledBack: mocks.markAuditRolledBack,
  releaseAuditRollbackClaim: mocks.releaseAuditRollbackClaim,
}));

vi.mock("../ssrf-guard.server", () => ({ safeFetchPublicUrl: mocks.safeFetchPublicUrl }));

vi.mock("../workflow-agent/trusted-preview.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workflow-agent/trusted-preview.server")>()),
  loadTrustedWorkflowPreview: mocks.loadTrustedWorkflowPreview,
}));

vi.mock("@/lib/logger.server", () => ({
  getRequestId: () => "request-1",
  log: { info: vi.fn(), warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(() => "sentry-event"),
  captureMessage: mocks.captureMessage,
}));

const inst = { id: "inst-1", name: "n8n", base_url: "https://n8n.example.com", api_key: "k" };
const caller = { user_id: "u1", key_id: "k1", request_id: "req-1", confirmationVerified: true };

const trigger = {
  id: "manual",
  name: "Manual Trigger",
  type: "n8n-nodes-base.manualTrigger",
  typeVersion: 1,
  position: [0, 0],
  parameters: {},
};

function workflow(overrides: Record<string, unknown> = {}) {
  return {
    id: "wf-1",
    name: "Invoices",
    versionId: "v-base",
    updatedAt: "2026-11-06T10:00:00.000Z",
    nodes: [trigger],
    connections: {},
    settings: {},
    ...overrides,
  };
}

type Reply = Record<string, unknown> | Error;

/**
 * Serve n8n requests in order: each GET/PUT takes the next reply queued for
 * its method. An Error reply becomes a failed HTTP response.
 */
function serveN8n(replies: { GET: Reply[]; PUT: Reply[] }) {
  const queues = { GET: [...replies.GET], PUT: [...replies.PUT] };
  mocks.safeFetchPublicUrl.mockImplementation(async (_url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase() as "GET" | "PUT";
    const reply = queues[method]?.shift();
    if (!reply || reply instanceof Error) {
      return { ok: false, status: 503, text: async () => "unavailable" };
    }
    return { ok: true, status: 200, text: async () => JSON.stringify(reply) };
  });
}

function n8nMethods(): string[] {
  return mocks.safeFetchPublicUrl.mock.calls.map(([, init]) =>
    String((init as RequestInit | undefined)?.method ?? "GET").toUpperCase(),
  );
}

function auditParams(): Record<string, unknown> {
  const entry = mocks.recordWorkflowAudit.mock.calls.at(-1)?.[0] as
    { toolParams?: Record<string, unknown> } | undefined;
  return entry?.toolParams ?? {};
}

async function loadDispatch() {
  return (await import("../mcp.server")).dispatchTool;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mocks.safeFetchPublicUrl.mockReset();
});

describe("assessWriteConcurrency", () => {
  async function assess(
    input: Parameters<typeof import("../mcp/write-verification.server").assessWriteConcurrency>[0],
  ) {
    const { assessWriteConcurrency } = await import("../mcp/write-verification.server");
    return assessWriteConcurrency(input);
  }

  const sent = { name: "Invoices", nodes: [trigger], connections: {}, settings: {} };

  it("reports a clean write when the re-read matches the PUT response", async () => {
    const written = workflow({ versionId: "v-ours", updatedAt: "2026-11-06T10:00:05.000Z" });
    const result = await assess({
      base: workflow(),
      sent,
      written,
      reread: { ok: true, workflow: written },
    });
    expect(result).toMatchObject({ status: "clean", signal: null, signals: [] });
    expect(result.writtenVersionId).toBe("v-ours");
    expect(result.rereadVersionId).toBe("v-ours");
  });

  it("proves a later save from a changed versionId", async () => {
    const result = await assess({
      base: workflow(),
      sent,
      written: workflow({ versionId: "v-ours" }),
      reread: { ok: true, workflow: workflow({ versionId: "v-theirs" }) },
    });
    expect(result).toMatchObject({
      status: "concurrent_write_after",
      signal: "versionId",
      writtenVersionId: "v-ours",
      rereadVersionId: "v-theirs",
    });
  });

  it("falls back to updatedAt, then content, when n8n omits versionId", async () => {
    const byTime = await assess({
      base: {},
      sent,
      written: { ...sent, updatedAt: "2026-11-06T10:00:05.000Z" },
      reread: { ok: true, workflow: { ...sent, updatedAt: "2026-11-06T10:00:09.000Z" } },
    });
    expect(byTime).toMatchObject({ status: "concurrent_write_after", signal: "updatedAt" });

    const byContent = await assess({
      base: {},
      sent,
      written: { ...sent },
      reread: { ok: true, workflow: { ...sent, name: "Renamed in n8n" } },
    });
    expect(byContent).toMatchObject({ status: "concurrent_write_after", signal: "content" });
  });

  it("ignores n8n normalisation of ids, positions and settings", async () => {
    const written = workflow({
      versionId: "v-ours",
      nodes: [{ ...trigger, id: "generated", position: [10, 10], webhookId: "w" }],
      settings: { executionOrder: "v1" },
    });
    const result = await assess({
      base: workflow(),
      sent,
      written,
      reread: { ok: true, workflow: written },
    });
    expect(result.status).toBe("clean");
  });

  it("suspects a save between our read and our PUT from a preserved field that changed", async () => {
    const result = await assess({
      base: workflow({ description: "old" }),
      sent,
      written: workflow({ versionId: "v-ours", description: "edited in n8n meanwhile" }),
      reread: {
        ok: true,
        workflow: workflow({ versionId: "v-ours", description: "edited in n8n meanwhile" }),
      },
    });
    expect(result).toMatchObject({
      status: "concurrent_write_suspected",
      signal: "preserved_fields",
      driftedFields: ["description"],
    });
  });

  it("does not suspect a preserved field that n8n cleared", async () => {
    const result = await assess({
      base: workflow({ description: "old", pinData: { a: [] } }),
      sent,
      written: workflow({ versionId: "v-ours", description: null, pinData: {} }),
      reread: { ok: true, workflow: workflow({ versionId: "v-ours" }) },
    });
    expect(result.status).toBe("clean");
  });

  it("suspects a save while n8n built the PUT response when its content differs from what we sent", async () => {
    const written = workflow({
      versionId: "v-other",
      nodes: [trigger, { ...trigger, id: "x", name: "Added by someone" }],
    });
    const result = await assess({
      base: workflow(),
      sent,
      written,
      reread: { ok: true, workflow: written },
    });
    expect(result).toMatchObject({
      status: "concurrent_write_suspected",
      signal: "response_content",
    });
  });

  it("marks the write unverified when the re-read fails", async () => {
    const result = await assess({
      base: workflow(),
      sent,
      written: workflow({ versionId: "v-ours" }),
      reread: { ok: false },
    });
    expect(result).toMatchObject({
      status: "unverified",
      signal: "reread_failed",
      rereadVersionId: null,
    });
  });

  it("marks the write unverified when neither side carries a usable signal", async () => {
    const result = await assess({
      base: {},
      sent,
      written: { id: "wf-1" },
      reread: { ok: true, workflow: { id: "wf-1" } },
    });
    expect(result).toMatchObject({ status: "unverified", signal: "no_version_signal" });
  });

  it("uses a fixed message the tool-error sanitizer lets through", () => {
    expect(sanitizedToolErrorMessage(CONCURRENT_WRITE_DETECTED_MESSAGE)).toBe(
      CONCURRENT_WRITE_DETECTED_MESSAGE,
    );
  });
});

describe("update_partial_workflow post-write verification", () => {
  const operations = [{ type: "cleanStaleConnections" }];
  const args = { workflowId: "wf-1", operations, sourcePreviewCallId: "preview-1" };

  beforeEach(() => {
    mocks.loadTrustedWorkflowPreview.mockResolvedValue({
      id: "preview-1",
      user_id: "u1",
      instance_id: "inst-1",
      tool_name: "preview_workflow_diff",
      status: "ok",
      created_at: new Date().toISOString(),
      workflow_id: "wf-1",
      session_id: "req-1",
      metadata: { workflowId: "wf-1", operations, baseVersionId: "v-base" },
    });
  });

  it("does not flag a write nobody raced, and records the clean check", async () => {
    const written = workflow({ versionId: "v-ours" });
    serveN8n({ GET: [workflow(), written], PUT: [written] });
    const dispatchTool = await loadDispatch();

    const { output } = await dispatchTool("update_partial_workflow", args, inst, caller);

    // Pre-read, PUT, then exactly one verification read.
    expect(n8nMethods()).toEqual(["GET", "PUT", "GET"]);
    expect(output).toMatchObject({ success: true });
    expect(output).not.toHaveProperty("concurrent_write_detected");
    expect(JSON.parse(JSON.stringify(output))).not.toHaveProperty("concurrency_after_write");
    expect(auditParams().concurrencyAfterWrite).toMatchObject({
      status: "clean",
      writtenVersionId: "v-ours",
      rereadVersionId: "v-ours",
    });
    expect(mocks.logWarn).not.toHaveBeenCalled();
    expect(mocks.captureMessage).not.toHaveBeenCalled();
  });

  it("flags a save that landed after the PUT in the output, the audit row, the log and Sentry", async () => {
    serveN8n({
      GET: [workflow(), workflow({ versionId: "v-theirs" })],
      PUT: [workflow({ versionId: "v-ours" })],
    });
    const dispatchTool = await loadDispatch();

    const { output } = await dispatchTool("update_partial_workflow", args, inst, caller);

    expect(output).toMatchObject({
      success: true,
      concurrent_write_detected: true,
      concurrent_write_message: CONCURRENT_WRITE_DETECTED_MESSAGE,
      concurrency_after_write: { status: "concurrent_write_after", signal: "versionId" },
    });
    expect(auditParams().concurrencyAfterWrite).toMatchObject({
      status: "concurrent_write_after",
      signal: "versionId",
      writtenVersionId: "v-ours",
      rereadVersionId: "v-theirs",
    });
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "workflow.concurrent_write_detected",
      expect.objectContaining({
        tool: "update_partial_workflow",
        workflow_id: "wf-1",
        status: "concurrent_write_after",
      }),
    );
    expect(mocks.captureMessage).toHaveBeenCalledWith(
      "n8n workflow concurrent write detected",
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ concurrency_status: "concurrent_write_after" }),
      }),
    );
    // No workflow content reaches the log or Sentry.
    const logged = JSON.stringify([mocks.logWarn.mock.calls, mocks.captureMessage.mock.calls]);
    expect(logged).not.toContain("Manual Trigger");
    expect(logged).not.toContain("Invoices");
  });

  it("flags a suspected save between the pre-read and the PUT", async () => {
    const written = workflow({ versionId: "v-ours", description: "set in n8n meanwhile" });
    serveN8n({ GET: [workflow({ description: null }), written], PUT: [written] });
    const dispatchTool = await loadDispatch();

    const { output } = await dispatchTool("update_partial_workflow", args, inst, caller);

    expect(output).toMatchObject({
      concurrent_write_detected: true,
      concurrency_after_write: {
        status: "concurrent_write_suspected",
        signal: "preserved_fields",
      },
    });
    expect(auditParams().concurrencyAfterWrite).toMatchObject({
      status: "concurrent_write_suspected",
      driftedFields: ["description"],
    });
  });

  it("keeps the completed write when the verification read fails, marking it unverified", async () => {
    serveN8n({
      GET: [workflow(), new Error("n8n unavailable")],
      PUT: [workflow({ versionId: "v-ours" })],
    });
    const dispatchTool = await loadDispatch();

    const { output } = await dispatchTool("update_partial_workflow", args, inst, caller);

    expect(n8nMethods()).toEqual(["GET", "PUT", "GET"]);
    expect(output).toMatchObject({ success: true, workflow: { versionId: "v-ours" } });
    expect(output).not.toHaveProperty("concurrent_write_detected");
    expect(auditParams().concurrencyAfterWrite).toMatchObject({
      status: "unverified",
      signal: "reread_failed",
    });
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "workflow.write_verification_failed",
      expect.objectContaining({ tool: "update_partial_workflow", workflow_id: "wf-1" }),
    );
    expect(mocks.captureMessage).not.toHaveBeenCalled();
  });
});

describe("rollback_workflow post-write verification", () => {
  beforeEach(() => {
    mocks.getRollbackSnapshotForUser.mockResolvedValue({
      id: "a1",
      instance_id: "inst-1",
      workflow_id: "wf-1",
      snapshot_before: { id: "wf-1", name: "Old", nodes: [trigger], connections: {} },
      snapshot_after: workflow({ versionId: "v-audited" }),
      is_rolled_back: false,
    });
  });

  it("records a save after the restore on the rollback's audit row and in its output", async () => {
    const live = workflow({ versionId: "v-audited" });
    serveN8n({
      // Precheck read, final pre-PUT read, then the verification read.
      GET: [live, live, workflow({ name: "Old", versionId: "v-theirs" })],
      PUT: [workflow({ name: "Old", versionId: "v-restored" })],
    });
    const dispatchTool = await loadDispatch();

    const { output } = await dispatchTool("rollback_workflow", { auditLogId: "a1" }, inst, caller);

    expect(n8nMethods()).toEqual(["GET", "GET", "PUT", "GET"]);
    expect(output).toMatchObject({
      success: true,
      concurrent_write_detected: true,
      concurrent_write_message: CONCURRENT_WRITE_DETECTED_MESSAGE,
      concurrency_after_write: { status: "concurrent_write_after", signal: "versionId" },
    });
    expect(mocks.recordWorkflowAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        toolName: "rollback_workflow",
        toolParams: expect.objectContaining({
          concurrencyCheck: "unchanged",
          concurrencyAfterWrite: expect.objectContaining({
            status: "concurrent_write_after",
            writtenVersionId: "v-restored",
            rereadVersionId: "v-theirs",
          }),
        }),
      }),
    );
    // The restore stands: the claim is not released.
    expect(mocks.releaseAuditRollbackClaim).not.toHaveBeenCalled();
  });

  it("completes the rollback when the verification read fails", async () => {
    const live = workflow({ versionId: "v-audited" });
    serveN8n({
      GET: [live, live, new Error("n8n unavailable")],
      PUT: [workflow({ name: "Old", versionId: "v-restored" })],
    });
    const dispatchTool = await loadDispatch();

    const { output } = await dispatchTool("rollback_workflow", { auditLogId: "a1" }, inst, caller);

    expect(output).toMatchObject({ success: true });
    expect(output).not.toHaveProperty("concurrent_write_detected");
    expect(auditParams().concurrencyAfterWrite).toMatchObject({ status: "unverified" });
    expect(mocks.releaseAuditRollbackClaim).not.toHaveBeenCalled();
  });
});

describe("update_workflow post-write verification", () => {
  it("flags a later save and keeps the flag fields out of the audit snapshot", async () => {
    serveN8n({
      // Audit before-snapshot read, the tool's own read, then the verification read.
      GET: [workflow(), workflow(), workflow({ name: "Renamed", versionId: "v-theirs" })],
      PUT: [workflow({ name: "Renamed", versionId: "v-ours" })],
    });
    const dispatchTool = await loadDispatch();

    const { output } = await dispatchTool(
      "update_workflow",
      { id: "wf-1", name: "Renamed", confirm: true },
      inst,
      caller,
    );

    expect(n8nMethods()).toEqual(["GET", "GET", "PUT", "GET"]);
    expect(output).toMatchObject({ versionId: "v-ours", concurrent_write_detected: true });
    const entry = mocks.recordWorkflowAudit.mock.calls.at(-1)?.[0] as {
      snapshotAfter: Record<string, unknown>;
      toolParams: Record<string, unknown>;
    };
    expect(entry.snapshotAfter).not.toHaveProperty("concurrent_write_detected");
    expect(entry.snapshotAfter).toMatchObject({ versionId: "v-ours" });
    expect(entry.toolParams.concurrencyAfterWrite).toMatchObject({
      status: "concurrent_write_after",
    });
  });

  it("does not let caller arguments claim a concurrency verdict", async () => {
    const written = workflow({ name: "Renamed", versionId: "v-ours" });
    serveN8n({ GET: [workflow(), workflow(), written], PUT: [written] });
    const dispatchTool = await loadDispatch();

    await dispatchTool(
      "update_workflow",
      {
        id: "wf-1",
        name: "Renamed",
        confirm: true,
        concurrencyAfterWrite: { status: "concurrent_write_after" },
      },
      inst,
      caller,
    );

    expect(auditParams().concurrencyAfterWrite).toMatchObject({ status: "clean" });
  });
});
