import { describe, expect, it } from "vitest";
import {
  classifyRequest,
  decodeMcpHeaderValue,
  discoverResult,
  HEADER_MISMATCH,
  looksModern,
  META_SERVER_INFO,
  modernErrorStatus,
  modernResult,
  supportsFormElicitation,
  UNSUPPORTED_PROTOCOL_VERSION,
} from "../mcp-protocol.server";
import type { JsonRpcReq } from "../mcp-types";

const meta = (overrides: Record<string, unknown> = {}) => ({
  "io.modelcontextprotocol/protocolVersion": "2026-07-28",
  "io.modelcontextprotocol/clientCapabilities": {},
  "io.modelcontextprotocol/clientInfo": { name: "Test", version: "1.0.0" },
  ...overrides,
});

function toolCall(params: Record<string, unknown> = {}): JsonRpcReq {
  return {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "get_weather", arguments: {}, _meta: meta(), ...params },
  };
}

const modernHeaders = (overrides: Record<string, string | null> = {}) => {
  const base: Record<string, string | null> = {
    "MCP-Protocol-Version": "2026-07-28",
    "Mcp-Method": "tools/call",
    "Mcp-Name": "get_weather",
    ...overrides,
  };
  const headers = new Headers();
  for (const [k, v] of Object.entries(base)) if (v !== null) headers.set(k, v);
  return headers;
};

describe("classifyRequest", () => {
  it("treats a request without _meta or a modern header as legacy", () => {
    const req: JsonRpcReq = { jsonrpc: "2.0", id: 1, method: "initialize", params: {} };
    expect(classifyRequest(req, new Headers())).toEqual({ era: "legacy" });
    expect(classifyRequest(req, new Headers({ "MCP-Protocol-Version": "2025-06-18" }))).toEqual({
      era: "legacy",
    });
  });

  it("classifies a well-formed 2026-07-28 request as modern", () => {
    expect(classifyRequest(toolCall(), modernHeaders())).toMatchObject({
      era: "modern",
      version: "2026-07-28",
      clientCapabilities: {},
      clientInfo: { name: "Test", version: "1.0.0" },
      mcpName: "get_weather",
    });
  });

  it("rejects an unknown _meta protocol version with UnsupportedProtocolVersion", () => {
    const req = toolCall({
      _meta: meta({ "io.modelcontextprotocol/protocolVersion": "1900-01-01" }),
    });
    expect(classifyRequest(req, modernHeaders())).toEqual({
      era: "invalid",
      error: {
        status: 400,
        code: UNSUPPORTED_PROTOCOL_VERSION,
        message: "Unsupported protocol version",
        data: { supported: ["2026-07-28"], requested: "1900-01-01" },
      },
    });
  });

  it("rejects a modern header without the required _meta as invalid params", () => {
    const req: JsonRpcReq = { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} };
    expect(classifyRequest(req, modernHeaders({ "Mcp-Method": "tools/list" }))).toMatchObject({
      era: "invalid",
      error: { status: 400, code: -32602 },
    });
  });

  it("rejects an unknown header version without _meta as unsupported", () => {
    const req: JsonRpcReq = { jsonrpc: "2.0", id: 1, method: "tools/list" };
    expect(
      classifyRequest(req, new Headers({ "MCP-Protocol-Version": "2099-01-01" })),
    ).toMatchObject({ era: "invalid", error: { code: UNSUPPORTED_PROTOCOL_VERSION } });
  });

  it("requires clientCapabilities in _meta", () => {
    const req = toolCall({
      _meta: { "io.modelcontextprotocol/protocolVersion": "2026-07-28" },
    });
    expect(classifyRequest(req, modernHeaders())).toMatchObject({
      era: "invalid",
      error: { status: 400, code: -32602 },
    });
  });

  it.each([
    ["missing MCP-Protocol-Version", { "MCP-Protocol-Version": null }],
    ["a different MCP-Protocol-Version", { "MCP-Protocol-Version": "2025-06-18" }],
    ["missing Mcp-Method", { "Mcp-Method": null }],
    ["a different Mcp-Method", { "Mcp-Method": "tools/list" }],
    ["missing Mcp-Name", { "Mcp-Name": null }],
    ["a different Mcp-Name", { "Mcp-Name": "delete_everything" }],
    ["a malformed Mcp-Name sentinel", { "Mcp-Name": "=?base64?not base64?=" }],
  ])("rejects %s with HeaderMismatch", (_label, overrides) => {
    expect(classifyRequest(toolCall(), modernHeaders(overrides))).toMatchObject({
      era: "invalid",
      error: { status: 400, code: HEADER_MISMATCH },
    });
  });

  it("decodes a base64 Mcp-Name before comparing it to the body", () => {
    const req = toolCall({ name: "天气" });
    const encoded = `=?base64?${Buffer.from("天气").toString("base64")}?=`;
    expect(classifyRequest(req, modernHeaders({ "Mcp-Name": encoded }))).toMatchObject({
      era: "modern",
      mcpName: "天气",
    });
  });

  it("does not require Mcp-Name for methods without a name", () => {
    const req: JsonRpcReq = {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
      params: { _meta: meta() },
    };
    expect(
      classifyRequest(req, modernHeaders({ "Mcp-Method": "tools/list", "Mcp-Name": null })),
    ).toMatchObject({ era: "modern" });
  });
});

describe("decodeMcpHeaderValue", () => {
  // Examples from the Streamable HTTP "Value Encoding" table.
  it.each([
    ["us-west1", "us-west1"],
    ["=?base64?SGVsbG8sIOS4lueVjA==?=", "Hello, 世界"],
    ["=?base64?IHBhZGRlZCA=?=", " padded "],
    ["=?base64?bGluZTEKbGluZTI=?=", "line1\nline2"],
    ["=?base64?PT9iYXNlNjQ/bGl0ZXJhbD89?=", "=?base64?literal?="],
  ])("decodes %j", (header, expected) => {
    expect(decodeMcpHeaderValue(header)).toBe(expected);
  });

  it("rejects non-ASCII plain values and broken sentinels", () => {
    expect(decodeMcpHeaderValue("héllo")).toBeNull();
    expect(decodeMcpHeaderValue("=?base64?abc")).toBeNull();
  });
});

describe("helpers", () => {
  it("detects modern requests for batch refusal", () => {
    expect(looksModern({ params: { _meta: meta() } }, new Headers())).toBe(true);
    expect(looksModern(null, new Headers({ "MCP-Protocol-Version": "2026-07-28" }))).toBe(true);
    expect(looksModern({ params: {} }, new Headers({ "MCP-Protocol-Version": "2025-06-18" }))).toBe(
      false,
    );
  });

  it("reads form elicitation support from modern capabilities", () => {
    expect(supportsFormElicitation({})).toBe(false);
    expect(supportsFormElicitation({ elicitation: {} })).toBe(true);
    expect(supportsFormElicitation({ elicitation: { form: {} } })).toBe(true);
    expect(supportsFormElicitation({ elicitation: { url: {} } })).toBe(false);
  });

  it("adds resultType and serverInfo without dropping existing fields", () => {
    expect(modernResult({ tools: [], _meta: { other: 1 } })).toEqual({
      tools: [],
      resultType: "complete",
      _meta: { other: 1, [META_SERVER_INFO]: { name: "n8n-mcp-gateway", version: "0.3.0" } },
    });
    expect(modernResult({ resultType: "input_required" })).toMatchObject({
      resultType: "input_required",
    });
  });

  it("builds a cacheable discover result", () => {
    expect(discoverResult("notes")).toMatchObject({
      resultType: "complete",
      supportedVersions: ["2026-07-28"],
      capabilities: { tools: {} },
      instructions: "notes",
      ttlMs: 3_600_000,
      cacheScope: "private",
    });
  });

  it("maps modern error codes to HTTP statuses", () => {
    expect(modernErrorStatus(-32601)).toBe(404);
    expect(modernErrorStatus(HEADER_MISMATCH)).toBe(400);
    expect(modernErrorStatus(UNSUPPORTED_PROTOCOL_VERSION)).toBe(400);
    expect(modernErrorStatus(-32004)).toBe(429);
    expect(modernErrorStatus(-32602)).toBe(200);
  });
});
