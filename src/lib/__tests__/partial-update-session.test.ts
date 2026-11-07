// update_partial_workflow binds a trusted preview to the MCP session it was
// recorded under: previews store the session id (never the per-request id),
// so the check must compare ids of the same kind.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  loadPreview: vi.fn(),
  n8n: vi.fn(),
}));

vi.mock("@/lib/workflow-agent/trusted-preview.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/workflow-agent/trusted-preview.server")>();
  return { ...actual, loadTrustedWorkflowPreview: mocks.loadPreview };
});

vi.mock("@/lib/mcp/n8n-client.server", () => ({ n8n: mocks.n8n }));

import { updatePartialWorkflow } from "@/lib/mcp/partial-update.server";

const INSTANCE = {
  id: "instance-1",
  name: "Primary",
  base_url: "https://n8n.example.com",
  api_key: "secret",
};

const PREVIEW = {
  id: "preview-1",
  user_id: "user-1",
  instance_id: "instance-1",
  tool_name: "preview_workflow_diff",
  status: "ok",
  created_at: "2026-07-10T00:05:00.000Z",
  workflow_id: "wf-1",
  session_id: "mcp-session-a",
  metadata: {
    workflowId: "wf-1",
    baseFingerprint: "fingerprint-1",
    operations: [{ type: "cleanStaleConnections" }],
  },
};

const ARGS = {
  workflowId: "wf-1",
  operations: [{ type: "cleanStaleConnections" }],
  sourcePreviewCallId: "preview-1",
  confirm: true,
};

// Reaching n8n proves the preview checks passed; the fake failure stops the
// tool before any write.
const REACHED_N8N = "reached n8n";

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-07-10T00:10:00.000Z"));
  mocks.loadPreview.mockReset().mockResolvedValue(PREVIEW);
  mocks.n8n.mockReset().mockRejectedValue(new Error(REACHED_N8N));
});

describe("update_partial_workflow preview session binding", () => {
  it("applies a preview from the MCP session that recorded it", async () => {
    await expect(
      updatePartialWorkflow(INSTANCE, ARGS, {
        user_id: "user-1",
        request_id: "request-123",
        session_id: "mcp-session-a",
      }),
    ).rejects.toThrow(REACHED_N8N);
  });

  it("refuses a preview recorded under another MCP session", async () => {
    await expect(
      updatePartialWorkflow(INSTANCE, ARGS, {
        user_id: "user-1",
        request_id: "request-123",
        session_id: "mcp-session-b",
      }),
    ).rejects.toThrow("Workflow preview session does not match the current session");
    expect(mocks.n8n).not.toHaveBeenCalled();
  });

  it("never compares the preview's session with the per-request id", async () => {
    // The dashboard (no MCP session) applies previews recorded by MCP
    // clients; the request id differs on every call and must not be used.
    await expect(
      updatePartialWorkflow(INSTANCE, ARGS, { user_id: "user-1", request_id: "request-123" }),
    ).rejects.toThrow(REACHED_N8N);
  });
});
