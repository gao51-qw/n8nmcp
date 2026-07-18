import { beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchTool, runTool } from "@/lib/mcp.server";

const trustedPreviewMocks = vi.hoisted(() => ({
  loadTrustedWorkflowPreview: vi.fn(),
}));

vi.mock("../trusted-preview.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../trusted-preview.server")>()),
  loadTrustedWorkflowPreview: trustedPreviewMocks.loadTrustedWorkflowPreview,
}));

vi.mock("@/lib/ssrf-guard.server", () => ({
  safeFetchPublicUrl: (url: string, init?: RequestInit) => fetch(url, init),
}));

const instance = {
  id: "instance-1",
  name: "Primary",
  base_url: "https://n8n.example.com",
  api_key: "test-key",
};

const workflow = {
  id: "wf-1",
  versionId: "version-1",
  name: "Workflow",
  nodes: [
    {
      id: "trigger",
      name: "Manual Trigger",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    },
  ],
  connections: {},
  settings: {},
};

const mockFetch = vi.fn<typeof fetch>();
global.fetch = mockFetch;

function respond(body: unknown) {
  mockFetch.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify(body) } as Response);
}

describe("trusted partial workflow versions", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    trustedPreviewMocks.loadTrustedWorkflowPreview.mockReset();
  });

  it("returns the base version and fingerprint with a preview", async () => {
    respond(workflow);

    const result = (await runTool(instance, "preview_workflow_diff", {
      workflowId: "wf-1",
      operations: [{ type: "cleanStaleConnections" }],
    })) as Record<string, unknown>;

    expect(result.baseVersionId).toBe("version-1");
    expect(result.baseFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects an update when the preview version is stale", async () => {
    const operations = [{ type: "cleanStaleConnections" }];
    const args = {
      workflowId: "wf-1",
      operations,
      sourcePreviewCallId: "preview-1",
    };
    trustedPreviewMocks.loadTrustedWorkflowPreview.mockResolvedValueOnce({
      id: "preview-1",
      user_id: "user-1",
      tool_name: "preview_workflow_diff",
      status: "ok",
      created_at: new Date().toISOString(),
      workflow_id: "wf-1",
      metadata: {
        workflowId: "wf-1",
        operations,
        baseVersionId: "version-old",
      },
    });
    respond(workflow);

    await expect(
      dispatchTool("update_partial_workflow", args, instance, {
        user_id: "user-1",
        confirmationVerified: true,
      }),
    ).rejects.toThrow(/stale/i);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
});
