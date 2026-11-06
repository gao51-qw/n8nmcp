import type { JsonRpcReq } from "./mcp-types";

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, Accept, Mcp-Session-Id, MCP-Protocol-Version, Mcp-Method, Mcp-Name",
  // Browser-based MCP clients can only read non-safelisted response headers
  // that are listed here: the OAuth challenge (WWW-Authenticate, RFC 9728),
  // the MCP session/protocol headers, the request id used for support
  // correlation, and Retry-After on throttled responses.
  "Access-Control-Expose-Headers":
    "WWW-Authenticate, Mcp-Session-Id, MCP-Protocol-Version, X-Request-Id, Retry-After",
  "Access-Control-Max-Age": "86400",
} as const;

export function rpcResult(id: JsonRpcReq["id"], result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}

export function rpcError(id: JsonRpcReq["id"], code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message, data } };
}

export function sseStream(payload: unknown): Response {
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

export function jsonResp(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}
