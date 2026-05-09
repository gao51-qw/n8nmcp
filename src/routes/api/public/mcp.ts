// MCP Streamable HTTP gateway endpoint.
// Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
// - POST /api/public/mcp with JSON-RPC 2.0 body, Accept: application/json, text/event-stream
// - Bearer auth: nmcp_<...> platform key
// - Returns SSE stream (one `message` event with the JSON-RPC response, then `[DONE]`)
import { createFileRoute } from "@tanstack/react-router";
import {
  TOOLS,
  authenticateBearer,
  checkDailyQuota,
  shortWindowAllow,
  getDefaultInstance,
  recordCall,
  runTool,
} from "@/lib/mcp.server";

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
  ctx: Awaited<ReturnType<typeof authenticateBearer>>
): Promise<unknown> {
  if (!ctx) return rpcError(req.id, -32001, "Unauthorized");

  switch (req.method) {
    case "initialize":
      return rpcResult(req.id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "n8n-mcp-gateway", version: "0.1.0" },
      });

    case "ping":
    case "notifications/initialized":
      return rpcResult(req.id, {});

    case "tools/list":
      return rpcResult(req.id, { tools: TOOLS });

    case "tools/call": {
      const params = req.params ?? {};
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const started = Date.now();

      const inst = await getDefaultInstance(ctx.user_id);
      if (!inst) {
        await recordCall({
          user_id: ctx.user_id,
          tool_name: name,
          status: "error",
          latency_ms: Date.now() - started,
          error_message: "no n8n instance configured",
        });
        return rpcError(req.id, -32002, "No n8n instance configured for this user");
      }

      try {
        const out = await runTool(inst, name, args);
        await recordCall({
          user_id: ctx.user_id,
          instance_id: inst.id,
          tool_name: name,
          status: "ok",
          latency_ms: Date.now() - started,
        });
        return rpcResult(req.id, {
          content: [{ type: "text", text: JSON.stringify(out, null, 2) }],
          isError: false,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "tool failed";
        await recordCall({
          user_id: ctx.user_id,
          instance_id: inst.id,
          tool_name: name,
          status: "error",
          latency_ms: Date.now() - started,
          error_message: msg,
        });
        return rpcResult(req.id, {
          content: [{ type: "text", text: msg }],
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
        if (!auth) {
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
          const out = await handleRpc(r, auth);
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
