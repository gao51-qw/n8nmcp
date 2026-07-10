import { describe, expect, it } from "vitest";

import {
  buildWorkflowAgentCallMetadata,
  deriveAgentPlan,
  workflowIdFromCall,
} from "../call-metadata.server";

describe("workflow agent call metadata", () => {
  it("keeps trusted preview fields and recursively redacts sensitive keys", () => {
    const metadata = buildWorkflowAgentCallMetadata(
      "preview_workflow_diff",
      {
        workflowId: "wf-1",
        operations: [
          {
            type: "updateNode",
            nodeId: "http",
            changes: {
              authorization: "Bearer secret",
              method: "GET",
              nested: { apiKey: "n8n-secret" },
            },
          },
        ],
      },
      {
        baseVersionId: "v1",
        baseFingerprint: "abc",
        diff: { changedNodes: ["HTTP Request"] },
        validation: { ok: true, errors: [], warnings: [] },
      },
    );

    expect(metadata).toMatchObject({
      workflowId: "wf-1",
      operations: [
        {
          nodeId: "http",
          changes: {
            authorization: "[REDACTED]",
            method: "GET",
            nested: { apiKey: "[REDACTED]" },
          },
        },
      ],
      baseVersionId: "v1",
      baseFingerprint: "abc",
      validation: { ok: true },
    });
    expect(JSON.stringify(metadata)).not.toContain("secret");
  });

  it("extracts safe template hits from search results", () => {
    const metadata = buildWorkflowAgentCallMetadata(
      "search_templates",
      { query: "invoice" },
      {
        templates: [
          { id: 9, name: "Invoice enrichment", confidence: 0.91, workflow: { secret: "drop" } },
        ],
      },
    );

    expect(metadata).toEqual({
      query: "invoice",
      templateHits: [
        { id: "9", name: "Invoice enrichment", confidence: 0.91, source: "search_templates" },
      ],
    });
  });

  it("returns a truncation marker instead of oversized operation metadata", () => {
    const metadata = buildWorkflowAgentCallMetadata(
      "preview_workflow_diff",
      { workflowId: "wf-large", operations: [{ type: "addNode", node: { data: "x".repeat(70_000) } }] },
      { validation: { ok: true } },
    );

    expect(metadata).toEqual({ _truncated: true });
  });

  it("derives an ordered plan from actual agent tool calls", () => {
    const plan = deriveAgentPlan([
      { tool_name: "preview_workflow_diff", status: "ok", created_at: "2026-07-10T00:00:02Z" },
      { tool_name: "search_templates", status: "ok", created_at: "2026-07-10T00:00:01Z" },
      { tool_name: "update_partial_workflow", status: "error", created_at: "2026-07-10T00:00:03Z" },
      { tool_name: "list_workflows", status: "ok", created_at: "2026-07-10T00:00:00Z" },
    ]);

    expect(plan).toEqual([
      { tool: "search_templates", status: "complete" },
      { tool: "preview_workflow_diff", status: "complete" },
      { tool: "update_partial_workflow", status: "blocked" },
    ]);
  });

  it("derives workflow ids only from workflow-scoped calls", () => {
    expect(workflowIdFromCall("preview_workflow_diff", { workflowId: "wf-1" }, {})).toBe("wf-1");
    expect(workflowIdFromCall("rollback_workflow", {}, { workflow_id: "wf-2" })).toBe("wf-2");
    expect(workflowIdFromCall("search_templates", { id: "not-a-workflow" }, {})).toBeNull();
  });
});
