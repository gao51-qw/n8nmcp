import { beforeEach, describe, expect, it, vi } from "vitest";

const native = vi.hoisted(() => ({ callTool: vi.fn() }));

vi.mock("../ssrf-guard.server", () => ({
  assertPublicUrl: vi.fn().mockResolvedValue(undefined),
  safeFetchPublicUrl: (url: string, init?: RequestInit) => fetch(url, init),
}));

vi.mock("../n8n-native-execution.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../n8n-native-execution.server")>()),
  nativeClientFor: () => ({ callTool: native.callTool }),
}));

import { dispatchTool, runTool } from "../mcp.server";
import { NativeMcpError } from "../n8n-native-mcp.server";

const mockFetch = vi.fn<typeof fetch>();
global.fetch = mockFetch;

function n8nResponse(body: unknown) {
  mockFetch.mockResolvedValueOnce({ ok: true, text: async () => JSON.stringify(body) } as Response);
}

const instance = {
  id: "inst-1",
  name: "Prod",
  base_url: "https://n8n.example.com",
  api_key: "api-key",
  native: {
    token: "mcp-token",
    tools: [
      "execute_workflow",
      "get_workflow_execution",
      "get_workflow_history",
      "explore_node_resources",
    ],
  },
};

const workflow = (active: boolean) => ({
  id: "wf-1",
  active,
  nodes: [
    {
      name: "Hook",
      type: "n8n-nodes-base.webhook",
      parameters: { path: "hook", httpMethod: "POST" },
    },
  ],
  connections: {},
});

beforeEach(() => {
  mockFetch.mockReset();
  native.callTool.mockReset();
});

describe("execute_workflow through n8n's instance-level MCP", () => {
  it("runs an inactive draft in manual mode without touching its webhook", async () => {
    n8nResponse(workflow(false));
    native.callTool
      .mockResolvedValueOnce({ executionId: "e-1", status: "started" })
      .mockResolvedValueOnce({ execution: { id: "e-1", status: "success" } });

    const result = await runTool(instance, "execute_workflow", { id: "wf-1", confirm: true });

    expect(result).toMatchObject({
      success: true,
      executionSource: "native_mcp",
      mode: "manual",
      execution: { id: "e-1", status: "success", finished: true },
    });
    expect(native.callTool.mock.calls[0]![1]).toMatchObject({
      workflowId: "wf-1",
      executionMode: "manual",
    });
    expect(mockFetch).toHaveBeenCalledTimes(1); // only the workflow read
  });

  it("falls back to the webhook when n8n refuses to start the run", async () => {
    n8nResponse(workflow(true));
    native.callTool.mockRejectedValueOnce(
      new NativeMcpError("tool", "Workflow is not available in MCP"),
    );
    n8nResponse(workflow(true)); // webhook path re-reads the workflow
    n8nResponse({ data: [] }); // no previous execution
    n8nResponse({ ok: true }); // webhook response
    n8nResponse({ data: [{ id: "e-9", status: "success", finished: true }] });

    const result = await runTool(instance, "execute_workflow", { id: "wf-1", confirm: true });

    expect(result).toMatchObject({
      executionSource: "webhook",
      nativeFallbackReason: "Workflow is not available in MCP",
      execution: { id: "e-9" },
    });
    expect(mockFetch.mock.calls.map(([url]) => String(url))).toContain(
      "https://n8n.example.com/webhook/hook",
    );
  });

  it("does not fall back when it is unknown whether the run started", async () => {
    n8nResponse(workflow(true));
    native.callTool.mockRejectedValueOnce(new NativeMcpError("unavailable", "socket hang up"));

    await expect(
      runTool(instance, "execute_workflow", { id: "wf-1", confirm: true }),
    ).rejects.toThrow(/socket hang up/);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the webhook path for instances without a token", async () => {
    n8nResponse(workflow(true));
    n8nResponse({ data: [] });
    n8nResponse({ ok: true });
    n8nResponse({ data: [{ id: "e-5", status: "success", finished: true }] });
    const { native: _native, ...plain } = instance;

    const result = await runTool(plain, "execute_workflow", { id: "wf-1", confirm: true });

    expect(result).toMatchObject({ executionSource: "webhook" });
    expect(native.callTool).not.toHaveBeenCalled();
  });
});

describe("native read tools", () => {
  it("returns n8n's version history for source=native", async () => {
    native.callTool.mockResolvedValueOnce({
      versions: [{ versionId: "v2" }, { versionId: "v1" }],
      count: 2,
    });

    const result = await dispatchTool(
      "get_workflow_history",
      { workflowId: "wf-1", source: "native", limit: 500 },
      instance,
      { user_id: "user-1" },
    );

    expect(native.callTool).toHaveBeenCalledWith(
      "get_workflow_history",
      { workflowId: "wf-1", limit: 50 },
      { idempotent: true },
    );
    expect(result.output).toEqual({
      workflowId: "wf-1",
      source: "native",
      native: { available: true, versions: [{ versionId: "v2" }, { versionId: "v1" }], count: 2 },
    });
  });

  it("explains how to enable native history when no token is stored", async () => {
    const { native: _native, ...plain } = instance;
    const result = await dispatchTool(
      "get_workflow_history",
      { workflowId: "wf-1", source: "native" },
      plain,
      { user_id: "user-1" },
    );
    expect(result.output).toMatchObject({
      native: { available: false, reason: expect.stringContaining("Instance-level MCP") },
    });
  });

  it("resolves node options, forwarding only documented arguments", async () => {
    native.callTool.mockResolvedValueOnce({
      results: [{ name: "#general", value: "C1", url: "https://slack.example/C1", secret: "x" }],
      paginationToken: "next",
    });

    const result = await dispatchTool(
      "resolve_node_options",
      {
        nodeType: "n8n-nodes-base.slack",
        version: 2,
        methodName: "getChannels",
        methodType: "listSearch",
        credentialType: "slackOAuth2Api",
        credentialId: "cred-1",
        filter: "gen",
        unexpected: "dropped",
      },
      instance,
      { user_id: "user-1" },
    );

    expect(native.callTool.mock.calls[0]![1]).toEqual({
      nodeType: "n8n-nodes-base.slack",
      version: 2,
      methodName: "getChannels",
      methodType: "listSearch",
      credentialType: "slackOAuth2Api",
      credentialId: "cred-1",
      filter: "gen",
    });
    expect(result.output).toEqual({
      options: [{ name: "#general", value: "C1", url: "https://slack.example/C1" }],
      paginationToken: "next",
    });
  });

  it("rejects an invalid methodType before calling n8n", async () => {
    await expect(
      dispatchTool(
        "resolve_node_options",
        {
          nodeType: "x",
          version: 1,
          methodName: "m",
          methodType: "execute",
          credentialType: "c",
          credentialId: "1",
        },
        instance,
        { user_id: "user-1" },
      ),
    ).rejects.toThrow(/methodType/);
    expect(native.callTool).not.toHaveBeenCalled();
  });
});
