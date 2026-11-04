import { describe, expect, it, vi } from "vitest";

import {
  buildProductionWebhookUrl,
  findWebhookTrigger,
  latestExecutionId,
  summarizeExecution,
  triggerWorkflowWebhook,
  waitForNewExecution,
} from "../n8n-execution.server";

const safeFetchPublicUrl = vi.fn();
vi.mock("../ssrf-guard.server", () => ({
  safeFetchPublicUrl: (...args: unknown[]) => safeFetchPublicUrl(...args),
}));

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

describe("findWebhookTrigger", () => {
  it("uses the node path, falling back to webhookId, and skips disabled nodes", () => {
    expect(
      findWebhookTrigger({
        nodes: [
          {
            name: "Off",
            type: "n8n-nodes-base.webhook",
            disabled: true,
            parameters: { path: "a" },
          },
          { name: "Hook", type: "n8n-nodes-base.webhook", parameters: { path: "/orders/" } },
        ],
      }),
    ).toEqual({ nodeName: "Hook", path: "orders/", httpMethod: "GET" });

    expect(
      findWebhookTrigger({
        nodes: [
          {
            name: "Hook",
            type: "n8n-nodes-base.webhook",
            webhookId: "abc-123",
            parameters: { httpMethod: "post" },
          },
        ],
      }),
    ).toEqual({ nodeName: "Hook", path: "abc-123", httpMethod: "POST" });
  });

  it("returns null for workflows without a usable webhook trigger", () => {
    expect(findWebhookTrigger({ nodes: [] })).toBeNull();
    expect(
      findWebhookTrigger({ nodes: [{ name: "M", type: "n8n-nodes-base.manualTrigger" }] }),
    ).toBeNull();
    expect(
      findWebhookTrigger({
        nodes: [{ name: "H", type: "n8n-nodes-base.webhook", parameters: {} }],
      }),
    ).toBeNull();
  });

  it("builds production webhook URLs without doubled slashes", () => {
    expect(buildProductionWebhookUrl("https://n8n.example.com/", "/orders")).toBe(
      "https://n8n.example.com/webhook/orders",
    );
  });
});

describe("triggerWorkflowWebhook", () => {
  const workflow = {
    id: "wf-1",
    active: true,
    nodes: [{ name: "Hook", type: "n8n-nodes-base.webhook", parameters: { path: "orders" } }],
  };

  it("sends data as query parameters for GET webhooks and parses the response", async () => {
    safeFetchPublicUrl.mockReset().mockResolvedValueOnce(response({ ok: true }));

    const result = await triggerWorkflowWebhook("https://n8n.example.com", workflow, {
      id: "42",
      nested: { a: 1 },
    });

    expect(safeFetchPublicUrl).toHaveBeenCalledTimes(1);
    const [url, init] = safeFetchPublicUrl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://n8n.example.com/webhook/orders?id=42&nested=%7B%22a%22%3A1%7D");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty("X-N8N-API-KEY");
    expect(result).toEqual({ url, method: "GET", status: 200, body: { ok: true } });
  });

  it("rejects inactive workflows before any network call unless told the workflow is active", async () => {
    safeFetchPublicUrl.mockReset().mockResolvedValueOnce(response("accepted"));

    await expect(
      triggerWorkflowWebhook("https://n8n.example.com", { ...workflow, active: false }),
    ).rejects.toThrow(/not active/);
    expect(safeFetchPublicUrl).not.toHaveBeenCalled();

    const result = await triggerWorkflowWebhook(
      "https://n8n.example.com",
      { ...workflow, active: false },
      {},
      { assumeActive: true },
    );
    expect(result.body).toBe("accepted");
  });

  it("explains a 404 as an unregistered production webhook", async () => {
    safeFetchPublicUrl.mockReset().mockResolvedValueOnce(response({ message: "not found" }, 404));

    await expect(triggerWorkflowWebhook("https://n8n.example.com", workflow)).rejects.toThrow(
      /status 404.*not registered/,
    );
  });
});

describe("summarizeExecution", () => {
  it("extracts the last node's first output item and error messages", () => {
    expect(
      summarizeExecution({
        id: 7,
        status: "success",
        finished: true,
        data: {
          resultData: {
            lastNodeExecuted: "Set",
            runData: {
              Set: [
                { data: { main: [[{ json: { stale: true } }]] } },
                { data: { main: [[{ json: { fresh: true } }]] } },
              ],
            },
          },
        },
      }),
    ).toEqual({
      id: "7",
      status: "success",
      finished: true,
      error: null,
      lastNodeExecuted: "Set",
      output: { fresh: true },
    });

    expect(
      summarizeExecution({
        id: "8",
        status: "error",
        data: { resultData: { error: { message: "Node failed" } } },
      }),
    ).toMatchObject({ id: "8", finished: true, error: "Node failed", output: null });

    expect(summarizeExecution({ id: "9", status: "running" })).toMatchObject({
      finished: false,
      error: null,
    });
  });
});

describe("execution polling", () => {
  it("reads the latest execution id and waits for a different, finished execution", async () => {
    const responses = [
      { data: [{ id: "exec-1" }] },
      { data: [{ id: "exec-1", status: "success", finished: true }] },
      { data: [{ id: "exec-2", status: "running" }] },
      { data: [{ id: "exec-2", status: "success", finished: true }] },
    ];
    const request = vi.fn(async () => responses.shift());
    const sleep = vi.fn(async () => {});

    expect(await latestExecutionId(request, "wf-1")).toBe("exec-1");
    expect(request).toHaveBeenLastCalledWith("/api/v1/executions?workflowId=wf-1&limit=1");

    const execution = await waitForNewExecution(request, "wf-1", {
      excludeId: "exec-1",
      attempts: 5,
      intervalMs: 250,
      sleep,
    });

    expect(execution).toMatchObject({ id: "exec-2", status: "success", finished: true });
    expect(request).toHaveBeenLastCalledWith(
      "/api/v1/executions?workflowId=wf-1&limit=1&includeData=true",
    );
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(250);
  });

  it("returns null when no new execution appears within the attempts", async () => {
    const request = vi.fn(async () => ({ data: [{ id: "exec-1", finished: true }] }));

    const execution = await waitForNewExecution(request, "wf-1", {
      excludeId: "exec-1",
      attempts: 3,
      sleep: async () => {},
    });

    expect(execution).toBeNull();
    expect(request).toHaveBeenCalledTimes(3);
  });
});
