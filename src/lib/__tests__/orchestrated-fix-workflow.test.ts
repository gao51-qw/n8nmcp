import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../ssrf-guard.server", () => ({
  assertPublicUrl: vi.fn().mockResolvedValue(undefined),
  safeFetchPublicUrl: (url: string, init?: RequestInit) => fetch(url, init),
}));

import { OrchestratedToolsService } from "../orchestrated-tools.service";

const mockFetch = vi.fn<typeof fetch>();
global.fetch = mockFetch;

function respond(body: unknown) {
  mockFetch.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify(body) } as Response);
}

const instance = { id: "i", name: "n", base_url: "https://n8n.example.com", api_key: "k" };

const workflow = {
  id: "wf-1",
  name: "Orders",
  active: false,
  nodes: [
    {
      name: "Manual",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [0, 0],
      parameters: {},
    },
    {
      name: "HTTP",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4,
      position: [200, 0],
      parameters: { url: "https://api.example.com" },
    },
  ],
  connections: { Manual: { main: [[{ node: "HTTP", type: "main", index: 0 }]] } },
};

beforeEach(() => mockFetch.mockReset());

describe("fix_workflow_errors against the real Public API response shape", () => {
  it("reads failed executions from { data } with run data included", async () => {
    respond(workflow);
    respond({
      data: [
        {
          id: "e-1",
          startedAt: "2026-11-05T00:00:00Z",
          data: { resultData: { lastNodeExecuted: "HTTP", error: { message: "ETIMEDOUT" } } },
        },
      ],
      nextCursor: null,
    });

    const result = (await new OrchestratedToolsService(instance).callTool("fix_workflow_errors", {
      workflowId: "wf-1",
    })) as Record<string, unknown>;

    expect(String(mockFetch.mock.calls[1]![0])).toBe(
      "https://n8n.example.com/api/v1/executions?workflowId=wf-1&status=error&limit=5&includeData=true",
    );
    expect(result).toHaveProperty("recommendations");
    expect(result.applied === undefined || result.applied === false).toBe(true);
  });

  it("reports no errors when the page is empty", async () => {
    respond(workflow);
    respond({ data: [], nextCursor: null });

    await expect(
      new OrchestratedToolsService(instance).callTool("fix_workflow_errors", {
        workflowId: "wf-1",
      }),
    ).resolves.toMatchObject({
      success: false,
      message: expect.stringContaining("No errors found"),
    });
  });
});
