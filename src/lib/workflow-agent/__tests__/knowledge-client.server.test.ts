import { afterEach, describe, expect, it, vi } from "vitest";
import { safeFetchPublicUrl } from "../../ssrf-guard.server";
import {
  KnowledgeConfigurationError,
  KnowledgeResponseError,
  KnowledgeUnavailableError,
  createKnowledgeClient,
} from "../knowledge-client.server";

type CapturedRequest = { url: string; init: RequestInit };

function rpcResponse(result: unknown, headers?: HeadersInit): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id: "test", result }), {
    status: 200,
    headers: { "content-type": "application/json", ...headers },
  });
}

function toolResult(value: unknown): { content: Array<{ type: "text"; text: string }> } {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function clientWith(handler: (url: string, init: RequestInit) => Response | Promise<Response>): {
  client: ReturnType<typeof createKnowledgeClient>;
  requests: CapturedRequest[];
} {
  const requests: CapturedRequest[] = [];
  const networkFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const completeInit = init ?? {};
    requests.push({ url, init: completeInit });
    return handler(url, completeInit);
  }) as typeof fetch;

  return {
    client: createKnowledgeClient(
      { url: "http://mcp:3000/mcp", token: "secret" },
      { fetch: networkFetch },
    ),
    requests,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("trusted Knowledge MCP client", () => {
  it("posts JSON-RPC to only the exact configured Docker URL with bearer auth", async () => {
    const { client, requests } = clientWith((_url, init) => {
      const body = JSON.parse(String(init.body)) as {
        method: string;
        params: { name: string; arguments: unknown };
      };
      expect(body).toMatchObject({
        jsonrpc: "2.0",
        method: "tools/call",
        params: { name: "search_nodes", arguments: { query: "http://127.0.0.1", limit: 5 } },
      });
      return rpcResponse(
        toolResult({
          query: "http://127.0.0.1",
          count: 1,
          results: [{ node_type: "webhook", display_name: "Webhook" }],
        }),
      );
    });

    await expect(client.searchNodes("http://127.0.0.1", 5)).resolves.toEqual([
      { node_type: "webhook", display_name: "Webhook" },
    ]);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe("http://mcp:3000/mcp");
    expect(requests[0].init).toMatchObject({ method: "POST", redirect: "manual" });
    expect(new Headers(requests[0].init.headers)).toMatchObject(expect.any(Headers));
    expect(new Headers(requests[0].init.headers).get("authorization")).toBe("Bearer secret");
    expect(new Headers(requests[0].init.headers).get("accept")).toBe(
      "application/json, text/event-stream",
    );
  });

  it("adapts the real Knowledge MCP tool-result content for every client method", async () => {
    const replies = [
      { count: 1, templates: [{ id: 17, name: "Webhook starter" }] },
      { id: 17, name: "Webhook starter", workflow: { nodes: [], connections: {} } },
      { count: 1, results: [{ node_type: "webhook", display_name: "Webhook" }] },
      { node_type: "webhook", display_name: "Webhook", essentials: [] },
      { ok: true, errors: [], warnings: [] },
      { ok: true, total: 1, errors_total: 0, nodes: [] },
    ];
    const calls: Array<{ name: string; arguments: unknown }> = [];
    const { client } = clientWith((_url, init) => {
      const request = JSON.parse(String(init.body)) as {
        params: { name: string; arguments: unknown };
      };
      calls.push(request.params);
      return rpcResponse(toolResult(replies.shift()));
    });

    await expect(client.searchTemplates("webhook", 3)).resolves.toEqual([
      { id: 17, name: "Webhook starter" },
    ]);
    await expect(client.getTemplate(17)).resolves.toMatchObject({ id: 17 });
    await expect(client.searchNodes("webhook", 4)).resolves.toHaveLength(1);
    await expect(client.getNode("webhook", "n8n-nodes-base")).resolves.toMatchObject({
      node_type: "webhook",
    });
    await expect(
      client.validateNode({
        nodeType: "webhook",
        packageName: "n8n-nodes-base",
        parameters: { path: "events" },
      }),
    ).resolves.toMatchObject({ ok: true });
    await expect(client.validateWorkflow({ nodes: [], connections: {} })).resolves.toMatchObject({
      ok: true,
    });

    expect(calls).toEqual([
      { name: "search_templates", arguments: { query: "webhook", limit: 3 } },
      { name: "get_workflow_template", arguments: { id: 17 } },
      { name: "search_nodes", arguments: { query: "webhook", limit: 4 } },
      {
        name: "get_node_essentials",
        arguments: { node_type: "webhook", package_name: "n8n-nodes-base" },
      },
      {
        name: "validate_node_operation",
        arguments: {
          node_type: "webhook",
          package_name: "n8n-nodes-base",
          parameters: { path: "events" },
        },
      },
      { name: "validate_workflow", arguments: { workflow: { nodes: [], connections: {} } } },
    ]);
  });

  it("parses SSE JSON-RPC responses with CRLF framing", async () => {
    const sse = [
      ": heartbeat",
      "",
      "event: message",
      `data: ${JSON.stringify({
        jsonrpc: "2.0",
        id: "test",
        result: toolResult({ count: 0, results: [] }),
      })}`,
      "",
    ].join("\r\n");
    const { client } = clientWith(() =>
      Promise.resolve(
        new Response(sse, { headers: { "content-type": "text/event-stream; charset=utf-8" } }),
      ),
    );

    await expect(client.searchNodes("webhook", 5)).resolves.toEqual([]);
  });

  it("parses legal CR-only SSE line and event framing", async () => {
    const sse = [
      ": heartbeat",
      "",
      "event: message",
      `data: ${JSON.stringify({
        jsonrpc: "2.0",
        id: "test",
        result: toolResult({ count: 0, results: [] }),
      })}`,
      "",
    ].join("\r");
    const { client } = clientWith(() =>
      Promise.resolve(
        new Response(sse, { headers: { "content-type": "text/event-stream; charset=utf-8" } }),
      ),
    );

    await expect(client.searchNodes("webhook", 5)).resolves.toEqual([]);
  });

  it("rejects redirects without following their Location header", async () => {
    const { client, requests } = clientWith(() =>
      Promise.resolve(
        new Response(null, {
          status: 302,
          headers: { location: "http://127.0.0.1/admin" },
        }),
      ),
    );

    await expect(client.searchNodes("webhook", 5)).rejects.toBeInstanceOf(
      KnowledgeConfigurationError,
    );
    expect(requests[0].init.redirect).toBe("manual");
  });

  it("rejects a native response marked as already redirected", async () => {
    const response = rpcResponse(toolResult({ count: 0, results: [] }));
    Object.defineProperty(response, "redirected", { value: true });
    const { client } = clientWith(() => Promise.resolve(response));

    await expect(client.searchNodes("webhook", 5)).rejects.toBeInstanceOf(
      KnowledgeConfigurationError,
    );
  });

  it("rejects a native response whose non-empty URL differs from the configured URL", async () => {
    const response = rpcResponse(toolResult({ count: 0, results: [] }));
    Object.defineProperty(response, "url", { value: "http://other:3000/mcp" });
    const { client } = clientWith(() => Promise.resolve(response));

    await expect(client.searchNodes("webhook", 5)).rejects.toBeInstanceOf(
      KnowledgeConfigurationError,
    );
  });

  it.each([408, 429, 500, 503])(
    "classifies HTTP %s as transient unavailability",
    async (status) => {
      const { client } = clientWith(() => Promise.resolve(new Response("canary", { status })));

      await expect(client.searchNodes("webhook", 5)).rejects.toBeInstanceOf(
        KnowledgeUnavailableError,
      );
    },
  );

  it.each([401, 403])("classifies HTTP %s as non-degradable configuration/auth", async (status) => {
    const { client } = clientWith(() => Promise.resolve(new Response("canary", { status })));

    await expect(client.searchNodes("webhook", 5)).rejects.toBeInstanceOf(
      KnowledgeConfigurationError,
    );
  });

  it.each([400, 404])("classifies HTTP %s as a non-degradable response error", async (status) => {
    const { client } = clientWith(() => Promise.resolve(new Response("canary", { status })));

    await expect(client.searchNodes("webhook", 5)).rejects.toBeInstanceOf(KnowledgeResponseError);
  });

  it("aborts the network boundary after exactly ten seconds", async () => {
    vi.useFakeTimers();
    const { client } = clientWith(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("operator-secret timeout body", "AbortError")),
            { once: true },
          );
        }),
    );

    const pending = expect(client.searchNodes("webhook", 5)).rejects.toMatchObject({
      name: "KnowledgeUnavailableError",
      message: "Knowledge service is unavailable",
    });
    await vi.advanceTimersByTimeAsync(9_999);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
  });

  it("aborts stalled native response body consumption at ten seconds", async () => {
    vi.useFakeTimers();
    const { client } = clientWith((_url, init) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("raw stalled body secret", "AbortError")),
            { once: true },
          );
        },
      });
      return new Response(body, { headers: { "content-type": "application/json" } });
    });

    const pending = expect(client.searchNodes("webhook", 5)).rejects.toMatchObject({
      name: "KnowledgeUnavailableError",
      message: "Knowledge service is unavailable",
    });
    await vi.advanceTimersByTimeAsync(9_999);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the transport timer after both success and response failure", async () => {
    vi.useFakeTimers();
    const responses = [
      rpcResponse(toolResult({ count: 0, results: [] })),
      new Response("not-json", { headers: { "content-type": "application/json" } }),
    ];
    const { client } = clientWith(() => Promise.resolve(responses.shift()!));

    await expect(client.searchNodes("webhook", 5)).resolves.toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    await expect(client.searchNodes("webhook", 5)).rejects.toBeInstanceOf(KnowledgeResponseError);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("bounds streamed responses at one MiB even without Content-Length", async () => {
    const oversized = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.enqueue(new Uint8Array([1]));
        controller.close();
      },
    });
    const { client } = clientWith(() =>
      Promise.resolve(new Response(oversized, { headers: { "content-type": "application/json" } })),
    );

    await expect(client.searchNodes("webhook", 5)).rejects.toMatchObject({
      name: "KnowledgeResponseError",
      message: "Knowledge service returned an invalid response",
    });
  });

  it.each([
    ["malformed JSON", "application/json", "upstream raw token=secret"],
    ["malformed SSE", "text/event-stream", "data: not-json\n\n"],
  ])("sanitizes %s responses", async (_label, contentType, body) => {
    const { client } = clientWith(() =>
      Promise.resolve(new Response(body, { headers: { "content-type": contentType } })),
    );

    const error = await client.searchNodes("webhook", 5).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(KnowledgeResponseError);
    expect(String(error)).toBe(
      "KnowledgeResponseError: Knowledge service returned an invalid response",
    );
    expect(String(error)).not.toContain("secret");
    expect(String(error)).not.toContain(body);
  });

  it("uses generic errors for upstream HTTP and JSON-RPC failures", async () => {
    const responses = [
      new Response("database password=secret", { status: 503 }),
      rpcResponse(undefined, { "content-type": "application/json" }),
    ];
    responses[1] = new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: "test",
        error: { code: -32603, message: "database password=secret" },
      }),
      { headers: { "content-type": "application/json" } },
    );
    const { client } = clientWith(() => Promise.resolve(responses.shift()!));

    for (const expectedType of [KnowledgeUnavailableError, KnowledgeResponseError]) {
      const error = await client.searchNodes("webhook", 5).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(expectedType);
      expect(String(error)).not.toContain("password");
      expect(String(error)).not.toContain("secret");
    }
  });

  it("rejects sanitized tool-content error envelopes for templates and nodes", async () => {
    const responses = [
      rpcResponse(toolResult({ error: "template database password=secret" })),
      rpcResponse(toolResult({ error: "node database password=secret" })),
      rpcResponse({
        isError: true,
        content: [{ type: "text", text: "raw MCP tool error password=secret" }],
      }),
    ];
    const { client } = clientWith(() => Promise.resolve(responses.shift()!));

    for (const call of [
      () => client.getTemplate(999),
      () => client.getNode("missing-node"),
      () => client.searchNodes("missing-node", 5),
    ]) {
      const error = await call().catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(KnowledgeResponseError);
      expect(String(error)).toBe(
        "KnowledgeResponseError: Knowledge service returned an invalid response",
      );
      expect(String(error)).not.toContain("password");
      expect(String(error)).not.toContain("secret");
    }
  });

  it("returns unknown-node validation as a sanitized business result", async () => {
    const { client } = clientWith(() =>
      Promise.resolve(
        rpcResponse(
          toolResult({
            ok: false,
            error: "node not found: credential-password=secret",
          }),
        ),
      ),
    );

    const result = await client.validateNode({
      nodeType: "missing-node",
      parameters: {},
    });
    expect(result).toEqual({ ok: false, error: "Node validation failed" });
    expect(JSON.stringify(result)).not.toContain("credential-password");
    expect(JSON.stringify(result)).not.toContain("secret");
  });

  it("reads configuration only from server environment when no config is injected", async () => {
    vi.stubEnv("UPSTREAM_N8N_MCP_URL", "http://mcp:3000/mcp");
    vi.stubEnv("UPSTREAM_N8N_MCP_TOKEN", "environment-secret");
    let authorization: string | null = null;
    const networkFetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get("authorization");
      return rpcResponse(toolResult({ count: 0, results: [] }));
    }) as typeof fetch;

    await createKnowledgeClient(undefined, { fetch: networkFetch }).searchNodes("webhook", 5);
    expect(authorization).toBe("Bearer environment-secret");
  });

  it.each([
    [{ url: "", token: "secret" }, "missing URL"],
    [{ url: "http://mcp:3000/mcp", token: "" }, "missing token"],
    [{ url: " http://mcp:3000/mcp", token: "secret" }, "untrimmed URL"],
    [{ url: "ftp://mcp/knowledge", token: "secret" }, "unsupported URL protocol"],
    [
      { url: "http://mcp:3000/mcp", token: "secret\r\nX-Canary: injected" },
      "embedded token header controls",
    ],
  ])("rejects %s as a non-degradable configuration error (%s)", (config) => {
    const error = (() => {
      try {
        createKnowledgeClient(config);
      } catch (caught) {
        return caught;
      }
    })();
    expect(error).toMatchObject({
      name: "KnowledgeConfigurationError",
      message: "Knowledge service configuration is invalid",
    });
    expect(error).not.toBeInstanceOf(KnowledgeUnavailableError);
  });

  it("keeps user-controlled loopback URLs rejected by the public SSRF guard", async () => {
    await expect(safeFetchPublicUrl("http://127.0.0.1")).rejects.toThrow(
      "Target IP is private/internal",
    );
  });
});
