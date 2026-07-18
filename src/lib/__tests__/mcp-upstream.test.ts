import { beforeEach, describe, expect, it, vi } from "vitest";

function jsonRpcResponse(result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: "test", result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

describe("mcp upstream proxy", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.stubEnv("UPSTREAM_N8N_MCP_URL", "http://mcp:3000/mcp");
    vi.stubEnv("UPSTREAM_N8N_MCP_TOKEN", "upstream-token");
    vi.stubEnv("NODE_ENV", "test");
  });

  it("uses the trusted fixed-origin transport and forwards management credentials", async () => {
    const requests: Array<{ input: string; init: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        requests.push({ input: String(input), init: init ?? {} });
        return jsonRpcResponse({ content: [] });
      }),
    );

    const { callUpstreamTool } = await import("../mcp-upstream.server");
    await callUpstreamTool(
      "n8n_list_workflows",
      {},
      { base_url: "https://tenant.n8n.io", api_key: "tenant-key" },
      { user_id: "user-1", source: "workflow-agent" },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0].input).toBe("http://mcp:3000/mcp");
    expect(requests[0].init.redirect).toBe("manual");
    const headers = new Headers(requests[0].init.headers);
    expect(headers.get("authorization")).toBe("Bearer upstream-token");
    expect(headers.get("x-n8n-url")).toBe("https://tenant.n8n.io");
    expect(headers.get("x-n8n-key")).toBe("tenant-key");
    expect(headers.get("x-request-id")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(headers.get("x-caller-id")).toBe("c6c289e49e9c05b2");
    expect(headers.get("x-caller-source")).toBe("workflow-agent");
    expect(headers.has("X-N8n-Api-Url")).toBe(false);
    expect(headers.has("X-N8n-Api-Key")).toBe(false);
  });

  it("does not attach n8n credentials to upstream knowledge tools", async () => {
    let capturedHeaders = new Headers();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        capturedHeaders = new Headers(init?.headers);
        return jsonRpcResponse({ content: [] });
      }),
    );

    const { callUpstreamTool } = await import("../mcp-upstream.server");
    await callUpstreamTool(
      "search_nodes",
      { query: "slack" },
      { base_url: "https://tenant.n8n.io", api_key: "tenant-key" },
    );

    expect(capturedHeaders.has("x-n8n-url")).toBe(false);
    expect(capturedHeaders.has("x-n8n-key")).toBe(false);
  });
});
