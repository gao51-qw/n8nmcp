import { describe, expect, it, vi } from "vitest";
import { nativeToolAvailable, runViaNativeMcp } from "../n8n-native-execution.server";

const webhookWorkflow = {
  id: "wf-1",
  active: false,
  nodes: [
    {
      name: "Orders Hook",
      type: "n8n-nodes-base.webhook",
      parameters: { path: "orders", httpMethod: "POST" },
    },
  ],
  connections: {},
};

function fakeClient(responses: Record<string, unknown[]>) {
  const queues = Object.fromEntries(Object.entries(responses).map(([k, v]) => [k, [...v]]));
  const callTool = vi.fn(async (name: string, _args?: unknown, _options?: unknown) => {
    const next = queues[name]?.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  return { callTool };
}

const noSleep = { sleep: async () => undefined, intervalMs: 0 };

describe("runViaNativeMcp", () => {
  it("starts the run with webhook inputs and polls until it finishes", async () => {
    const client = fakeClient({
      execute_workflow: [{ executionId: "e-1", status: "started" }],
      get_workflow_execution: [
        { execution: { id: "e-1", status: "running" } },
        {
          execution: { id: "e-1", status: "success" },
          data: {
            resultData: {
              lastNodeExecuted: "Set",
              runData: { Set: [{ data: { main: [[{ json: { ok: true } }]] } }] },
            },
          },
        },
      ],
    });

    const result = await runViaNativeMcp(
      client,
      { workflowId: "wf-1", workflow: webhookWorkflow, mode: "manual", data: { orderId: 7 } },
      noSleep,
    );

    expect(client.callTool).toHaveBeenNthCalledWith(1, "execute_workflow", {
      workflowId: "wf-1",
      executionMode: "manual",
      triggerNodeName: "Orders Hook",
      inputs: { type: "webhook", webhookData: { method: "POST", body: { orderId: 7 } } },
    });
    expect(client.callTool).toHaveBeenNthCalledWith(
      2,
      "get_workflow_execution",
      { workflowId: "wf-1", executionId: "e-1", includeData: true },
      { idempotent: true },
    );
    expect(result).toEqual({
      started: true,
      executionId: "e-1",
      execution: expect.objectContaining({
        id: "e-1",
        status: "success",
        finished: true,
        output: { ok: true },
      }),
    });
  });

  it("sends no inputs without test data", async () => {
    const client = fakeClient({
      execute_workflow: [{ executionId: "e-2", status: "started" }],
      get_workflow_execution: [{ execution: { status: "success" } }],
    });
    await runViaNativeMcp(
      client,
      { workflowId: "wf-1", workflow: webhookWorkflow, mode: "production" },
      noSleep,
    );
    expect(client.callTool.mock.calls[0]![1]).toEqual({
      workflowId: "wf-1",
      executionMode: "production",
    });
  });

  it("reports a run n8n did not start", async () => {
    const client = fakeClient({
      execute_workflow: [
        { executionId: null, status: "error", error: "Workflow has no published version" },
      ],
    });
    await expect(
      runViaNativeMcp(
        client,
        { workflowId: "wf-1", workflow: webhookWorkflow, mode: "production" },
        noSleep,
      ),
    ).resolves.toEqual({ started: false, error: "Workflow has no published version" });
  });

  it("stays 'started' when reading the result fails, so nobody re-runs it", async () => {
    const client = fakeClient({
      execute_workflow: [{ executionId: "e-3", status: "started" }],
      get_workflow_execution: [new Error("timeout"), new Error("timeout")],
    });
    await expect(
      runViaNativeMcp(
        client,
        { workflowId: "wf-1", workflow: webhookWorkflow, mode: "manual" },
        { ...noSleep, attempts: 2 },
      ),
    ).resolves.toEqual({ started: true, executionId: "e-3", execution: null });
  });
});

describe("nativeToolAvailable", () => {
  it("needs a stored token whose server offers the tool", () => {
    const base = { id: "i", name: "n", base_url: "https://n8n.example.com", api_key: "k" };
    expect(nativeToolAvailable(base, "execute_workflow")).toBe(false);
    expect(
      nativeToolAvailable(
        { ...base, native: { token: "t", tools: ["search_workflows"] } },
        "execute_workflow",
      ),
    ).toBe(false);
    expect(
      nativeToolAvailable(
        { ...base, native: { token: "t", tools: ["execute_workflow"] } },
        "execute_workflow",
      ),
    ).toBe(true);
  });
});
