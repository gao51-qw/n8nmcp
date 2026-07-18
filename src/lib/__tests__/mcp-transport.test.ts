import { describe, expect, it } from "vitest";
import { CORS, jsonResp, rpcError, rpcResult, sseStream } from "../mcp-transport.server";

describe("mcp transport helpers", () => {
  it("wraps JSON-RPC results and errors consistently", () => {
    expect(rpcResult("1", { ok: true })).toEqual({
      jsonrpc: "2.0",
      id: "1",
      result: { ok: true },
    });

    expect(rpcError(undefined, -32001, "Unauthorized")).toEqual({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32001, message: "Unauthorized", data: undefined },
    });
  });

  it("returns JSON responses with the public MCP CORS headers", async () => {
    const res = jsonResp({ ok: true }, 201);

    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("access-control-allow-origin")).toBe(
      CORS["Access-Control-Allow-Origin"],
    );
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns a single-message SSE stream", async () => {
    const res = sseStream({ jsonrpc: "2.0", id: 1, result: {} });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(await res.text()).toBe(
      'event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n' +
        "event: done\ndata: [DONE]\n\n",
    );
  });
});
