import { describe, expect, it } from "vitest";

import { assertTrustedWorkflowPreview } from "../trusted-preview.server";

const operations = [
  { type: "updateNode", nodeId: "n1", changes: { parameters: { path: "v2" } } },
  { type: "cleanStaleConnections" },
  { type: "addConnection", source: "Webhook", target: "Slack" },
];

function preview(overrides: Record<string, unknown> = {}) {
  return {
    id: "preview-1",
    user_id: "user-1",
    tool_name: "preview_workflow_diff",
    status: "ok",
    created_at: "2026-07-13T02:00:00.000Z",
    workflow_id: "wf-1",
    session_id: "session-1",
    metadata: {
      workflowId: "wf-1",
      operations,
      baseVersionId: "version-1",
      baseFingerprint: "fingerprint-1",
    },
    ...overrides,
  };
}

const baseInput = {
  userId: "user-1",
  workflowId: "wf-1",
  operations,
  now: new Date("2026-07-13T02:05:00.000Z"),
  sessionId: "session-1",
};

describe("trusted workflow preview", () => {
  it("returns only trusted preview metadata", () => {
    expect(assertTrustedWorkflowPreview({ ...baseInput, preview: preview() })).toEqual({
      workflowId: "wf-1",
      operations,
      baseVersionId: "version-1",
      baseFingerprint: "fingerprint-1",
    });
  });

  it("derives selected operations from trusted metadata", () => {
    const trusted = assertTrustedWorkflowPreview({
      ...baseInput,
      preview: preview(),
      operationIndexes: [0, 2],
    });

    expect(trusted.operations).toEqual([operations[0], operations[2]]);
  });

  it.each([
    ["missing preview", null, /not found/],
    ["foreign owner", preview({ user_id: "user-2" }), /not found/],
    ["foreign session", preview({ session_id: "session-2" }), /session/],
    ["wrong tool", preview({ tool_name: "update_partial_workflow" }), /not found/],
    ["failed preview", preview({ status: "error" }), /not found/],
    ["expired preview", preview({ created_at: "2026-07-13T01:00:00.000Z" }), /stale/],
    ["future preview", preview({ created_at: "2026-07-13T02:07:00.000Z" }), /stale/],
  ])("rejects %s", (_label, row, message) => {
    expect(() =>
      assertTrustedWorkflowPreview({ ...baseInput, preview: row as ReturnType<typeof preview> }),
    ).toThrow(message);
  });

  it("rejects a workflow mismatch", () => {
    expect(() =>
      assertTrustedWorkflowPreview({ ...baseInput, preview: preview(), workflowId: "wf-2" }),
    ).toThrow(/scope/);
  });

  it("rejects operations that do not match the full preview", () => {
    expect(() =>
      assertTrustedWorkflowPreview({
        ...baseInput,
        preview: preview(),
        operations: [operations[0]],
      }),
    ).toThrow(/operations/);
  });

  it.each([
    [[], /at least one/],
    [[0, 0], /unique/],
    [[-1], /range/],
    [[3], /range/],
    [[0.5], /integers/],
  ])("rejects invalid operation indexes %#", (operationIndexes, message) => {
    expect(() =>
      assertTrustedWorkflowPreview({
        ...baseInput,
        preview: preview(),
        operationIndexes,
      }),
    ).toThrow(message);
  });
});
