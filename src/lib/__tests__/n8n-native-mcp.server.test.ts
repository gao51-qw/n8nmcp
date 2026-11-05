import { describe, expect, it, vi } from "vitest";
import {
  discoverNativeCapabilities,
  NativeMcpClient,
  NativeMcpError,
  nativeMcpEndpoint,
  parseSseResponse,
  toolPayload,
} from "../n8n-native-mcp.server";

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

/** Fake n8n MCP server: hands out a session id and answers over SSE. */
function fakeN8n(handlers: Record<string, (params: Record<string, unknown>) => unknown> = {}) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    calls.push({ url, headers, body });
    if (headers.authorization !== "Bearer good-token") return new Response("no", { status: 401 });
    const method = String(body.method);
    if (method === "notifications/initialized") return new Response(null, { status: 202 });
    let result: unknown;
    if (method === "initialize") {
      result = {
        protocolVersion: "2025-03-26",
        capabilities: { tools: {} },
        serverInfo: { name: "n8n" },
      };
    } else if (method === "tools/list") {
      result = {
        tools: [
          { name: "execute_workflow" },
          { name: "search_workflows", annotations: { readOnlyHint: true } },
        ],
      };
    } else {
      const handler = handlers[String((body.params as Record<string, unknown>).name)];
      result = handler
        ? handler((body.params as Record<string, unknown>).arguments as Record<string, unknown>)
        : { content: [{ type: "text", text: "unknown tool" }], isError: true };
    }
    const sse = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n`;
    return new Response(sse, {
      status: 200,
      headers: { "content-type": "text/event-stream", "mcp-session-id": "session-1" },
    });
  });
  return { calls, fetchImpl };
}

function client(
  fetchImpl: (url: string, init: RequestInit) => Promise<Response>,
  token = "good-token",
) {
  return new NativeMcpClient({ baseUrl: "https://n8n.example.com/", token, fetchImpl });
}

describe("NativeMcpClient", () => {
  it("initializes once, keeps the session and protocol version, and calls tools", async () => {
    const { calls, fetchImpl } = fakeN8n({
      search_workflows: () => ({
        content: [{ type: "text", text: JSON.stringify({ data: [{ id: "1" }], count: 1 }) }],
      }),
    });
    const mcp = client(fetchImpl);

    await expect(
      mcp.callTool("search_workflows", { query: "x" }, { idempotent: true }),
    ).resolves.toEqual({
      data: [{ id: "1" }],
      count: 1,
    });
    await mcp.callTool("search_workflows", {});

    expect(calls.map((call) => call.body.method)).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/call",
      "tools/call",
    ]);
    expect(calls[0]!.url).toBe("https://n8n.example.com/mcp-server/http");
    expect(calls[2]!.headers).toMatchObject({
      "mcp-session-id": "session-1",
      "mcp-protocol-version": "2025-03-26",
      "mcp-method": "tools/call",
      "mcp-name": "search_workflows",
      accept: "application/json, text/event-stream",
    });
    expect(mcp.negotiatedProtocolVersion).toBe("2025-03-26");
  });

  it("prefers structuredContent and reports tool errors", async () => {
    const { fetchImpl } = fakeN8n({
      execute_workflow: () => ({
        content: [],
        structuredContent: { executionId: "9", status: "started" },
      }),
      broken: () => ({
        content: [{ type: "text", text: "Workflow is not available in MCP" }],
        isError: true,
      }),
    });
    const mcp = client(fetchImpl);
    await expect(mcp.callTool("execute_workflow", { workflowId: "1" })).resolves.toEqual({
      executionId: "9",
      status: "started",
    });
    await expect(mcp.callTool("broken", {})).rejects.toMatchObject({
      kind: "tool",
      message: "Workflow is not available in MCP",
    });
  });

  it("maps a rejected token to an unauthorized error", async () => {
    const { fetchImpl } = fakeN8n();
    await expect(client(fetchImpl, "bad-token").listTools()).rejects.toMatchObject({
      kind: "unauthorized",
    });
  });

  it("retries an idempotent call once after a network failure, but never a write", async () => {
    const { fetchImpl } = fakeN8n({
      search_workflows: () => ({ content: [{ type: "text", text: "{}" }] }),
    });
    let failNext = false;
    const flaky = vi.fn(async (url: string, init: RequestInit) => {
      if (failNext) {
        failNext = false;
        throw new Error("socket hang up");
      }
      return fetchImpl(url, init);
    });
    const mcp = client(flaky);
    await mcp.connect();

    failNext = true;
    await expect(mcp.callTool("search_workflows", {}, { idempotent: true })).resolves.toEqual({});

    failNext = true;
    await expect(mcp.callTool("execute_workflow", {})).rejects.toBeInstanceOf(NativeMcpError);
    expect(
      flaky.mock.calls.filter(([, init]) => String(init.body).includes("execute_workflow")),
    ).toHaveLength(1);
  });

  it("surfaces JSON-RPC errors and non-JSON bodies as protocol errors", async () => {
    const jsonError = vi.fn(async () =>
      Response.json({ jsonrpc: "2.0", id: 1, error: { code: -32600, message: "bad" } }),
    );
    await expect(client(jsonError).connect()).rejects.toMatchObject({ kind: "protocol" });
    const html = vi.fn(async () => new Response("<html>", { status: 200 }));
    await expect(client(html).connect()).rejects.toMatchObject({ kind: "protocol" });
  });
});

describe("helpers", () => {
  it("builds the endpoint from the instance base URL", () => {
    expect(nativeMcpEndpoint("https://n8n.example.com///")).toBe(
      "https://n8n.example.com/mcp-server/http",
    );
  });

  it("finds the matching response among SSE events", () => {
    const body = [
      ": keep-alive",
      "",
      'data: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}',
      "",
      'data: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}',
      "",
    ].join("\n");
    expect(parseSseResponse(body, 7)).toEqual({ jsonrpc: "2.0", id: 7, result: { ok: true } });
    expect(parseSseResponse(body, 8)).toBeNull();
  });

  it("returns plain text when a tool result is not JSON", () => {
    expect(toolPayload({ content: [{ type: "text", text: "done" }] })).toBe("done");
  });

  it("discovers the available native tools", async () => {
    const { fetchImpl } = fakeN8n();
    await expect(
      discoverNativeCapabilities({
        baseUrl: "https://n8n.example.com",
        token: "good-token",
        fetchImpl,
      }),
    ).resolves.toMatchObject({
      protocolVersion: "2025-03-26",
      tools: ["execute_workflow", "search_workflows"],
    });
  });
});
