import { describe, expect, it, vi } from "vitest";
import { nativeToolAvailable, runViaNativeMcp } from "../n8n-native-execution.server";
import { NativeMcpError } from "../n8n-native-mcp.server";

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
      inputs: { webhookData: { method: "POST", body: { orderId: 7 } } },
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

  it("still names the webhook trigger and sends an empty body without test data", async () => {
    // n8n rejects webhook-triggered runs without triggerNodeName + inputs.
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
      triggerNodeName: "Orders Hook",
      inputs: { webhookData: { method: "POST", body: {} } },
    });
  });

  it.each([
    [
      "an isError result (n8n 2.39+ style)",
      new NativeMcpError(
        "tool",
        "Input validation error: Invalid arguments for tool execute_workflow: inputs.type: Invalid discriminator value",
      ),
    ],
    [
      "a JSON-RPC -32602 error (older MCP SDK)",
      new NativeMcpError(
        "protocol",
        "n8n MCP error -32602: Invalid arguments for tool execute_workflow: inputs.type: Required",
      ),
    ],
  ])("retries once with the n8n ≤2.33 inputs shape after %s", async (_label, rejection) => {
    const client = fakeClient({
      execute_workflow: [rejection, { executionId: "e-4", status: "started" }],
      get_workflow_execution: [{ execution: { status: "success" } }],
    });
    const result = await runViaNativeMcp(
      client,
      { workflowId: "wf-1", workflow: webhookWorkflow, mode: "manual", data: { orderId: 7 } },
      noSleep,
    );
    expect(client.callTool.mock.calls.filter(([name]) => name === "execute_workflow")).toHaveLength(
      2,
    );
    expect(client.callTool.mock.calls[1]![1]).toEqual({
      workflowId: "wf-1",
      executionMode: "manual",
      triggerNodeName: "Orders Hook",
      inputs: { type: "webhook", webhookData: { method: "POST", body: { orderId: 7 } } },
    });
    expect(result).toMatchObject({ started: true, executionId: "e-4" });
  });

  it("does not retry other tool errors", async () => {
    const client = fakeClient({
      execute_workflow: [new NativeMcpError("tool", "Workflow is not available in MCP")],
    });
    await expect(
      runViaNativeMcp(
        client,
        { workflowId: "wf-1", workflow: webhookWorkflow, mode: "manual" },
        noSleep,
      ),
    ).rejects.toThrow(/not available in MCP/);
    expect(client.callTool).toHaveBeenCalledTimes(1);
  });

  it("sends no trigger or inputs for a workflow without a webhook trigger", async () => {
    const client = fakeClient({
      execute_workflow: [{ executionId: "e-3", status: "started" }],
      get_workflow_execution: [{ execution: { status: "success" } }],
    });
    const scheduled = {
      ...webhookWorkflow,
      nodes: [{ name: "Every hour", type: "n8n-nodes-base.scheduleTrigger", parameters: {} }],
    };
    await runViaNativeMcp(
      client,
      { workflowId: "wf-1", workflow: scheduled, mode: "manual", data: { ignored: true } },
      noSleep,
    );
    expect(client.callTool.mock.calls[0]![1]).toEqual({
      workflowId: "wf-1",
      executionMode: "manual",
    });
  });

  it("polls get_execution on n8n 2.27–2.33, where get_workflow_execution does not exist", async () => {
    const client = fakeClient({
      execute_workflow: [{ executionId: "e-5", status: "started" }],
      get_workflow_execution: [
        new NativeMcpError(
          "protocol",
          "n8n MCP error -32602: MCP error -32602: Tool get_workflow_execution not found",
        ),
      ],
      get_execution: [
        { execution: { id: "e-5", status: "running" } },
        { execution: { id: "e-5", status: "success" } },
      ],
    });
    const result = await runViaNativeMcp(
      client,
      { workflowId: "wf-1", workflow: webhookWorkflow, mode: "manual" },
      noSleep,
    );
    expect(client.callTool.mock.calls.map(([name]) => name)).toEqual([
      "execute_workflow",
      "get_workflow_execution",
      "get_execution",
      "get_execution",
    ]);
    expect(result).toMatchObject({
      started: true,
      executionId: "e-5",
      execution: { status: "success", finished: true },
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
