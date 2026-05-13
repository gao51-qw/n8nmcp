// MCP Streamable HTTP gateway endpoint.
// Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
// - POST /api/public/mcp with JSON-RPC 2.0 body, Accept: application/json, text/event-stream
// - Bearer auth: nmcp_<...> platform key
// - Returns SSE stream (one `message` event with the JSON-RPC response, then `[DONE]`)
import { createFileRoute } from "@tanstack/react-router";
import {
  authenticateBearer,
  checkDailyQuota,
  dispatchTool,
  getDefaultInstance,
  getMergedTools,
  recordCall,
  shortWindowAllow,
} from "@/lib/mcp.server";
import { isUpstreamConfigured } from "@/lib/mcp-upstream.server";
import { log } from "@/lib/logger.server";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
} as const;

type JsonRpcReq = {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
};

function rpcResult(id: JsonRpcReq["id"], result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}
function rpcError(id: JsonRpcReq["id"], code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message, data } };
}

function sseStream(payload: unknown): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(enc.encode(`event: message\ndata: ${JSON.stringify(payload)}\n\n`));
      controller.enqueue(enc.encode(`event: done\ndata: [DONE]\n\n`));
      controller.close();
    },
  });
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
      ...CORS,
    },
  });
}

function jsonResp(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

async function handleRpc(
  req: JsonRpcReq,
  ctx: Awaited<ReturnType<typeof authenticateBearer>>,
  source: { ip: string; ua: string },
): Promise<unknown> {
  if (!ctx) return rpcError(req.id, -32001, "Unauthorized");

  switch (req.method) {
    case "initialize":
      return rpcResult(req.id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: {
          name: "n8n-mcp-gateway",
          version: "0.2.0",
          notes: isUpstreamConfigured()
            ? "local management + self-hosted n8n-knowledge-mcp upstream"
            : "local-only (upstream knowledge base not configured)",
        },
      });

    case "ping":
    case "notifications/initialized":
      return rpcResult(req.id, {});

    case "tools/list": {
      const t0 = Date.now();
      const tools = await getMergedTools();
      log.info("mcp.gateway.request", {
        method: "tools/list",
        user_id: ctx.user_id,
        key_id: ctx.key_id,
        ip: source.ip,
        ua: source.ua,
        latency_ms: Date.now() - t0,
        tool_count: tools.length,
      });
      return rpcResult(req.id, { tools });
    }

    case "tools/call": {
      const params = req.params ?? {};
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const started = Date.now();

      // Lazily resolve the user's n8n instance — knowledge-only tools don't need one.
      const inst = await getDefaultInstance(ctx.user_id);

      try {
        const result = await dispatchTool(name, args, inst, {
          user_id: ctx.user_id,
          key_id: ctx.key_id,
          source: "tools/call",
        });

        if (result.needsInstance) {
          await recordCall({
            user_id: ctx.user_id,
            tool_name: name,
            status: "error",
            latency_ms: Date.now() - started,
            error_message: "no n8n instance configured",
            upstream: result.upstream,
            category: result.category,
          });
          log.warn("mcp.gateway.request", {
            method: "tools/call",
            tool: name,
            user_id: ctx.user_id,
            key_id: ctx.key_id,
            ip: source.ip,
            ua: source.ua,
            latency_ms: Date.now() - started,
            status: "needs_instance",
            upstream: result.upstream,
            category: result.category,
          });
          return rpcError(req.id, -32002, "No n8n instance configured for this user");
        }

        await recordCall({
          user_id: ctx.user_id,
          instance_id: inst?.id ?? null,
          tool_name: name,
          status: "ok",
          latency_ms: Date.now() - started,
          upstream: result.upstream,
          category: result.category,
        });
        log.info("mcp.gateway.request", {
          method: "tools/call",
          tool: name,
          user_id: ctx.user_id,
          key_id: ctx.key_id,
          ip: source.ip,
          ua: source.ua,
          latency_ms: Date.now() - started,
          status: "ok",
          upstream: result.upstream,
          category: result.category,
        });

        // Upstream already returns MCP-shaped { content, isError }. Pass through verbatim.
        if (result.upstream && result.output && typeof result.output === "object") {
          return rpcResult(req.id, result.output);
        }
        return rpcResult(req.id, {
          content: [{ type: "text", text: JSON.stringify(result.output, null, 2) }],
          isError: false,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "tool failed";
        await recordCall({
          user_id: ctx.user_id,
          instance_id: inst?.id ?? null,
          tool_name: name,
          status: "error",
          latency_ms: Date.now() - started,
          error_message: msg,
        });
        log.warn("mcp.gateway.request", {
          method: "tools/call",
          tool: name,
          user_id: ctx.user_id,
          key_id: ctx.key_id,
          ip: source.ip,
          ua: source.ua,
          latency_ms: Date.now() - started,
          status: "error",
          err: msg,
        });
        // Never surface raw upstream/internal error text to the client.
        return rpcResult(req.id, {
          content: [{ type: "text", text: "Tool execution failed. Check gateway logs." }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

export const Route = createFileRoute("/api/public/mcp")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),

      GET: async () =>
        // Some clients probe with GET — return 405 with hint.
        new Response("Use POST with JSON-RPC body", {
          status: 405,
          headers: { Allow: "POST, OPTIONS", ...CORS },
        }),

      POST: async ({ request }) => {
        const auth = await authenticateBearer(request);
        const ip =
          request.headers.get("cf-connecting-ip") ||
          request.headers.get("x-real-ip") ||
          (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
          "unknown";
        const ua = (request.headers.get("user-agent") ?? "").slice(0, 200);
        const source = { ip, ua };

        if (!auth) {
          log.warn("mcp.gateway.unauthorized", { ip, ua });
          return jsonResp(rpcError(null, -32001, "Unauthorized: invalid or missing Bearer key"), 401);
        }

        // short-window throttle (per isolate)
        if (!shortWindowAllow(auth.user_id)) {
          await recordCall({
            user_id: auth.user_id,
            tool_name: null,
            status: "rate_limited",
            latency_ms: 0,
            error_message: "short-window throttle",
          });
          return jsonResp(rpcError(null, -32003, "Rate limit exceeded (60 req / 10s)"), 429);
        }

        // daily quota
        const quota = await checkDailyQuota(auth);
        if (!quota.ok) {
          await recordCall({
            user_id: auth.user_id,
            tool_name: null,
            status: "rate_limited",
            latency_ms: 0,
            error_message: `daily quota exceeded (${quota.used}/${quota.limit})`,
          });
          return jsonResp(
            rpcError(null, -32004, `Daily quota exceeded (${quota.used}/${quota.limit})`),
            429,
          );
        }

        let body: JsonRpcReq | JsonRpcReq[];
        try {
          body = await request.json();
        } catch {
          return jsonResp(rpcError(null, -32700, "Parse error"), 400);
        }

        const wantsSse = (request.headers.get("accept") ?? "").includes("text/event-stream");
        const batch = Array.isArray(body) ? body : [body];

        const responses: unknown[] = [];
        for (const r of batch) {
          if (!r || r.jsonrpc !== "2.0" || typeof r.method !== "string") {
            responses.push(rpcError(r?.id ?? null, -32600, "Invalid Request"));
            continue;
          }
          // Notifications (no id) → no response body required
          const isNotification = r.id === undefined || r.id === null;
          const out = await handleRpc(r, auth, source);
          if (!isNotification) responses.push(out);
        }

        const payload = Array.isArray(body) ? responses : (responses[0] ?? null);

        // notifications-only batch → 202 Accepted, empty body per spec
        if (responses.length === 0) {
          return new Response(null, { status: 202, headers: CORS });
        }

        return wantsSse ? sseStream(payload) : jsonResp(payload);
      },
    },
  },
});
