import { beforeEach, describe, expect, it, vi } from "vitest";

import { runTool } from "@/lib/mcp.server";

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

async function issueToken(args: Record<string, unknown>) {
  try {
    await runTool(instance, "update_partial_workflow", args);
  } catch (error) {
    return String((error as Error).message).match(/confirmationToken": "([^"]+)"/)?.[1] ?? "";
  }
  return "";
}

describe("trusted partial workflow versions", () => {
  beforeEach(() => {
    mockFetch.mockReset();
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
    const args = {
      workflowId: "wf-1",
      operations: [{ type: "cleanStaleConnections" }],
      expectedVersionId: "version-old",
    };
    const confirmationToken = await issueToken(args);
    expect(confirmationToken).toMatch(/^mcp_confirm_/);
    respond(workflow);

    await expect(
      runTool(instance, "update_partial_workflow", {
        ...args,
        confirm: true,
        confirmationToken,
      }),
    ).rejects.toThrow(/stale/i);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0]?.[1]?.method).toBeUndefined();
  });
});
