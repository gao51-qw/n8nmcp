import { describe, expect, it, vi } from "vitest";

import { WorkflowRepairPipeline } from "../repair-pipeline.server";

const workflow = {
  id: "wf-1",
  active: false,
  versionId: "v1",
  nodes: [
    {
      id: "HTTP",
      name: "HTTP",
      type: "n8n-nodes-base.httpRequest",
      parameters: { options: {} },
    },
  ],
  connections: {},
};

function harness(overrides: Record<string, unknown> = {}) {
  const events: string[] = [];
  const dependencies = {
    loadWorkflow: vi.fn(async () => workflow),
    loadFailedExecutions: vi.fn(async () => [{ error: "Request timed out", node: "HTTP" }]),
    validateProposal: vi.fn(async () => ({ ok: true, errors: [], warnings: [] })),
    savePreview: vi.fn(async () => "preview-1"),
    confirmation: {
      requireOrConsume: vi.fn(async () => events.push("confirm")),
    },
    applyPartialUpdate: vi.fn(async () => {
      events.push("apply");
      return { workflow: { ...workflow, versionId: "v2" }, auditLogId: "audit-1" };
    }),
    smokeTest: vi.fn(async () => {
      events.push("test");
      return { success: true };
    }),
    rollback: vi.fn(async () => {
      events.push("rollback");
      return { success: true };
    }),
    ...overrides,
  };
  return { pipeline: new WorkflowRepairPipeline(dependencies as never), dependencies, events };
}

describe("WorkflowRepairPipeline", () => {
  it("converts timeout evidence into a trusted nested updateNode preview", async () => {
    const { pipeline, dependencies } = harness();

    const proposal = await pipeline.propose({ userId: "u1", workflowId: "wf-1" });

    expect(proposal.operations).toEqual([
      {
        type: "updateNode",
        nodeId: "HTTP",
        changes: { parameters: { options: { timeout: 30_000 } } },
      },
    ]);
    expect(proposal.previewCallId).toBe("preview-1");
    expect(dependencies.savePreview).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "u1",
        workflowId: "wf-1",
        operations: proposal.operations,
      }),
    );
    expect(JSON.stringify(proposal)).not.toContain("_fixApplied");
  });

  it("keeps authentication and endpoint failures advisory", async () => {
    const { pipeline } = harness({
      loadFailedExecutions: vi.fn(async () => [
        { error: "Unauthorized API key", node: "HTTP" },
        { error: "Endpoint returned 404", node: "HTTP" },
      ]),
    });

    const proposal = await pipeline.propose({ userId: "u1", workflowId: "wf-1" });

    expect(proposal.operations).toEqual([]);
    expect(proposal.recommendations).toHaveLength(2);
  });

  it("confirms trusted operations before applying and retains a passing repair", async () => {
    const { pipeline, events } = harness();

    const result = await pipeline.apply({
      userId: "u1",
      workflowId: "wf-1",
      sourcePreviewCallId: "preview-1",
      operations: [
        {
          type: "updateNode",
          nodeId: "HTTP",
          changes: { parameters: { options: { timeout: 30_000 } } },
        },
      ],
      testData: { url: "https://example.test" },
      confirmationToken: "token-1",
    });

    expect(result).toMatchObject({ success: true, retained: true, rolledBack: false });
    expect(events).toEqual(["confirm", "apply", "test"]);
  });

  it("rolls back when the post-apply smoke test fails", async () => {
    const { pipeline, dependencies, events } = harness({
      smokeTest: vi.fn(async () => {
        events.push("test");
        return { success: false, error: "timeout" };
      }),
    });

    const result = await pipeline.apply({
      userId: "u1",
      workflowId: "wf-1",
      sourcePreviewCallId: "preview-1",
      operations: [{ type: "cleanStaleConnections" }],
      testData: {},
    });

    expect(result).toMatchObject({ success: false, retained: false, rolledBack: true });
    expect(dependencies.rollback).toHaveBeenCalledWith(
      expect.objectContaining({ workflowId: "wf-1", auditLogId: "audit-1" }),
    );
    expect(events).toEqual(["confirm", "apply", "test", "rollback"]);
  });

  it("returns a high-severity result when rollback also fails", async () => {
    const { pipeline } = harness({
      smokeTest: vi.fn(async () => ({ success: false, error: "failed" })),
      rollback: vi.fn(async () => ({ success: false, error: "conflict" })),
    });

    const result = await pipeline.apply({
      userId: "u1",
      workflowId: "wf-1",
      sourcePreviewCallId: "preview-1",
      operations: [{ type: "cleanStaleConnections" }],
      testData: {},
    });

    expect(result).toMatchObject({ success: false, rolledBack: false, severity: "high" });
  });
});
