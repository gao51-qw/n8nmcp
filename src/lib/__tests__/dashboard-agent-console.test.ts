import { describe, expect, it } from "vitest";

import { buildWorkflowAgentConsoleData } from "../dashboard-agent-console";

describe("buildWorkflowAgentConsoleData", () => {
  it("builds trusted pending update, rollback candidate, and deterministic plan", () => {
    const data = buildWorkflowAgentConsoleData({
      now: new Date("2026-07-09T10:10:00.000Z"),
      workflowId: "wf-1",
      callLogs: [
        {
          id: "template-1",
          tool_name: "search_templates",
          status: "ok",
          latency_ms: 10,
          created_at: "2026-07-09T10:00:00.000Z",
          workflow_id: "wf-1",
          session_id: "session-1",
          metadata: {},
        },
        {
          id: "preview-2",
          tool_name: "preview_workflow_diff",
          status: "ok",
          latency_ms: 20,
          created_at: "2026-07-09T10:05:00.000Z",
          workflow_id: "wf-1",
          session_id: "session-1",
          metadata: {
            workflowId: "wf-1",
            baseVersionId: "v2",
            baseFingerprint: "fingerprint-2",
            operations: [{ type: "updateNode", nodeId: "http", changes: { method: "POST" } }],
            diff: { changedNodes: ["HTTP Request"] },
          },
        },
      ],
      auditRows: [
        {
          id: "audit-latest",
          workflow_id: "wf-1",
          workflow_name: "Invoice workflow",
          operation: "update",
          tool_name: "update_partial_workflow",
          ai_reasoning: null,
          is_rolled_back: false,
          created_at: "2026-07-09T10:06:00.000Z",
          snapshot_before: { id: "wf-1" },
          snapshot_after: { id: "wf-1" },
          changes: [],
          tool_params: {},
        },
      ],
    });

    expect(data.pendingUpdate).toMatchObject({
      previewCallId: "preview-2",
      workflowId: "wf-1",
      baseVersionId: "v2",
      operations: [{ index: 0, operation: { type: "updateNode", nodeId: "http" } }],
    });
    expect(data.rollbackCandidate).toMatchObject({
      auditLogId: "audit-latest",
      workflowId: "wf-1",
    });
    expect(data.agentPlan?.map((step) => step.tool)).toEqual([
      "search_templates",
      "preview_workflow_diff",
    ]);
  });

  it("supersedes an applied preview without disabling an unrelated rollback candidate", () => {
    const data = buildWorkflowAgentConsoleData({
      now: new Date("2026-07-09T10:10:00.000Z"),
      workflowId: "wf-1",
      callLogs: [
        {
          id: "preview-1",
          tool_name: "preview_workflow_diff",
          status: "ok",
          latency_ms: 20,
          created_at: "2026-07-09T10:05:00.000Z",
          workflow_id: "wf-1",
          session_id: "session-1",
          metadata: {
            workflowId: "wf-1",
            baseFingerprint: "fingerprint-1",
            operations: [{ type: "cleanStaleConnections" }],
          },
        },
        {
          id: "apply-1",
          tool_name: "update_partial_workflow",
          status: "ok",
          latency_ms: 30,
          created_at: "2026-07-09T10:06:00.000Z",
          workflow_id: "wf-1",
          session_id: "session-1",
          metadata: { sourcePreviewCallId: "preview-1" },
        },
      ],
      auditRows: [
        {
          id: "audit-current",
          workflow_id: "wf-1",
          operation: "update",
          tool_name: "update_partial_workflow",
          ai_reasoning: null,
          is_rolled_back: false,
          created_at: "2026-07-09T10:07:00.000Z",
          snapshot_before: { id: "wf-1" },
          snapshot_after: { id: "wf-1" },
          changes: [],
          tool_params: {},
        },
        {
          id: "audit-other",
          workflow_id: "wf-2",
          operation: "update",
          tool_name: "update_partial_workflow",
          ai_reasoning: null,
          is_rolled_back: true,
          created_at: "2026-07-09T10:08:00.000Z",
          snapshot_before: { id: "wf-2" },
          snapshot_after: { id: "wf-2" },
          changes: [],
          tool_params: {},
        },
      ],
    });

    expect(data.pendingUpdate).toBeUndefined();
    expect(data.rollbackCandidate).toMatchObject({ auditLogId: "audit-current" });
  });

  it("maps real MCP call, audit, validation, diff, policy and deploy records", () => {
    const data = buildWorkflowAgentConsoleData({
      now: new Date("2026-07-09T10:00:05.000Z"),
      workflowId: "wf-1",
      instance: { id: "inst-1", name: "Primary", status: "connected" },
      subscription: { tier: "pro", status: "active", current_period_end: "2026-08-01T00:00:00Z" },
      usageToday: { mcp_calls: 42 },
      callLogs: [
        {
          id: "call-1",
          tool_name: "search_templates",
          status: "ok",
          latency_ms: 120,
          created_at: "2026-07-09T10:00:01.000Z",
        },
        {
          id: "call-2",
          tool_name: "update_partial_workflow",
          status: "ok",
          latency_ms: 340,
          created_at: "2026-07-09T10:00:03.000Z",
        },
        {
          id: "call-3",
          tool_name: "deploy_and_test_workflow",
          status: "error",
          latency_ms: 500,
          created_at: "2026-07-09T10:00:04.000Z",
        },
      ],
      auditRows: [
        {
          id: "audit-1",
          workflow_id: "wf-1",
          workflow_name: null,
          operation: "update",
          tool_name: "update_partial_workflow",
          ai_reasoning: "Use partial update for invoice workflow.",
          is_rolled_back: false,
          created_at: "2026-07-09T10:00:03.500Z",
          snapshot_before: { id: "wf-1", name: "Invoice v1" },
          snapshot_after: { id: "wf-1", name: "Invoice v2" },
          changes: [{ field: "nodes", before: 3, after: 4, type: "modified" }],
          tool_params: {
            confirm: true,
            policy: { environment: "production" },
            template: { id: "tpl-9", name: "Invoice enrichment", confidence: 0.91 },
            diff: {
              changedNodes: ["HTTP Request"],
              addedNodes: ["IF"],
              removedNodes: [],
              changedConnections: [{ source: "Webhook", target: "HTTP Request", change: "added" }],
            },
            validation: {
              ok: false,
              errors: [{ nodeName: "IF", message: "False branch is not connected." }],
              warnings: [{ nodeName: "HTTP Request", message: "Credential binding needs review." }],
            },
          },
        },
        {
          id: "audit-2",
          workflow_id: "wf-1",
          operation: "update",
          tool_name: "deploy_and_test_workflow",
          ai_reasoning: null,
          is_rolled_back: true,
          created_at: "2026-07-09T10:00:04.500Z",
          snapshot_before: { id: "wf-1", name: "Invoice v2" },
          snapshot_after: { id: "wf-1", name: "Invoice v2" },
          changes: [],
          tool_params: {
            results: {
              validation: { passed: true, errors: [], warnings: [] },
              test: { success: false, error: "Smoke test failed" },
            },
          },
        },
      ],
    });

    expect(data.workflowName).toBe("Invoice v2");
    expect(data.workflowId).toBe("wf-1");
    expect(data.quota).toMatchObject({ plan: "Pro", used: 42, rateLimit: 60 });
    expect(data.toolCalls.map((call) => call.tool)).toEqual([
      "search_templates",
      "update_partial_workflow",
      "deploy_and_test_workflow",
    ]);
    expect(data.toolCalls.at(2)).toMatchObject({ status: "blocked" });
    expect(data.templateHits).toEqual([
      {
        id: "tpl-9",
        name: "Invoice enrichment",
        confidence: 0.91,
        source: "audit:update_partial_workflow",
      },
    ]);
    expect(data.validation).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: "error", scope: "IF" }),
        expect.objectContaining({ severity: "warning", scope: "HTTP Request" }),
      ]),
    );
    expect(data.diff).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ operation: "update", target: "Node / HTTP Request" }),
        expect.objectContaining({ operation: "add", target: "Node / IF" }),
      ]),
    );
    expect(data.policy).toMatchObject({
      status: "confirmed",
      summary: expect.stringContaining("production"),
    });
    expect(data.deployment).toMatchObject({
      status: "failed",
      summary: expect.stringContaining("Smoke test failed"),
    });
    expect(data.rollbackStatus).toBe("rolled-back");
    expect(data.auditLog.map((entry) => entry.actor)).toContain("update_partial_workflow");
  });

  it("returns an empty real-data state instead of fixture content", () => {
    const data = buildWorkflowAgentConsoleData({
      now: new Date("2026-07-09T10:00:00.000Z"),
      callLogs: [],
      auditRows: [],
      usageToday: null,
      subscription: null,
      instance: null,
    });

    expect(data.workflowName).toBe("No workflow selected");
    expect(data.workflowId).toBe("No audit workflow yet");
    expect(data.toolCalls).toEqual([]);
    expect(data.diff).toEqual([]);
    expect(data.validation).toEqual([]);
    expect(data.auditLog).toEqual([]);
  });

  it("treats a structured business failure as blocked even if transport status is ok", () => {
    const data = buildWorkflowAgentConsoleData({
      now: new Date("2026-07-09T10:00:05.000Z"),
      workflowId: "wf-1",
      callLogs: [
        {
          id: "deploy-failed",
          tool_name: "deploy_and_test_workflow",
          status: "ok",
          latency_ms: 50,
          created_at: "2026-07-09T10:00:04.000Z",
          workflow_id: "wf-1",
          metadata: {
            businessSuccess: false,
            results: {
              validation: { passed: false, errors: ["Missing URL"] },
              test: { success: false, skipped: true, error: "Validation failed" },
            },
          },
        },
      ],
      auditRows: [],
    });

    expect(data.toolCalls[0]).toMatchObject({ status: "blocked" });
    expect(data.deployment).toMatchObject({
      status: "blocked",
      summary: expect.stringContaining("Missing URL"),
    });
  });
});
