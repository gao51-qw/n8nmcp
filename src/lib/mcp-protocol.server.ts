// MCP protocol-version handling for the dual-era gateway.
//
// Legacy clients (2025-06-18 and earlier) open with an `initialize` handshake
// and are served by the session-based path in mcp-route.server.ts. Modern
// clients (2026-07-28) carry the protocol version and their capabilities in
// every request's `_meta` and are served statelessly.
// Spec: https://modelcontextprotocol.io/specification/2026-07-28/basic/versioning
import type { JsonRpcReq } from "@/lib/mcp-types";

export const MODERN_PROTOCOL_VERSION = "2026-07-28";
/** Versions accepted in `_meta["io.modelcontextprotocol/protocolVersion"]`. */
export const MODERN_PROTOCOL_VERSIONS: readonly string[] = [MODERN_PROTOCOL_VERSION];
/** Version negotiated by the legacy `initialize` handshake. */
export const LEGACY_PROTOCOL_VERSION = "2025-06-18";
/**
 * Versions that predate per-request `_meta`. A request whose
 * `MCP-Protocol-Version` header names one of these (or omits the header) is a
 * legacy request even when it has no `_meta`.
 */
const LEGACY_PROTOCOL_VERSIONS = new Set(["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"]);

export const META_PROTOCOL_VERSION = "io.modelcontextprotocol/protocolVersion";
export const META_CLIENT_CAPABILITIES = "io.modelcontextprotocol/clientCapabilities";
export const META_CLIENT_INFO = "io.modelcontextprotocol/clientInfo";
export const META_LOG_LEVEL = "io.modelcontextprotocol/logLevel";
export const META_SERVER_INFO = "io.modelcontextprotocol/serverInfo";

export const HEADER_MISMATCH = -32020;
export const MISSING_REQUIRED_CLIENT_CAPABILITY = -32021;
export const UNSUPPORTED_PROTOCOL_VERSION = -32022;

export const SERVER_INFO = { name: "n8n-mcp-gateway", version: "0.3.0" } as const;

/** Methods whose `Mcp-Name` header mirrors `params.name` / `params.uri`. */
const NAMED_METHODS: Record<string, "name" | "uri"> = {
  "tools/call": "name",
  "prompts/get": "name",
  "resources/read": "uri",
};

export type ModernClientCapabilities = {
  elicitation?: { form?: Record<string, unknown>; url?: Record<string, unknown> };
  [key: string]: unknown;
};

export type ProtocolError = {
  status: number;
  code: number;
  message: string;
  data?: unknown;
};

export type ModernRequest = {
  era: "modern";
  version: string;
  clientCapabilities: ModernClientCapabilities;
  clientInfo?: { name?: string; version?: string };
  /** Value of the `Mcp-Name` header after decoding, when the method has one. */
  mcpName?: string;
};

export type ProtocolClassification =
  { era: "legacy" } | ModernRequest | { era: "invalid"; error: ProtocolError };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requestMeta(req: JsonRpcReq): Record<string, unknown> | null {
  return asRecord(asRecord(req.params)?._meta);
}

function unsupportedVersion(requested: string): ProtocolError {
  return {
    status: 400,
    code: UNSUPPORTED_PROTOCOL_VERSION,
    message: "Unsupported protocol version",
    data: { supported: [...MODERN_PROTOCOL_VERSIONS], requested },
  };
}

function headerMismatch(message: string): ProtocolError {
  return { status: 400, code: HEADER_MISMATCH, message: `Header mismatch: ${message}` };
}

/**
 * True when the body or headers signal a modern (2026-07-28+) client. Used to
 * refuse JSON-RPC batches, which modern Streamable HTTP does not allow.
 */
export function looksModern(req: unknown, headers: Headers): boolean {
  const header = headers.get("mcp-protocol-version")?.trim();
  if (header && !LEGACY_PROTOCOL_VERSIONS.has(header)) return true;
  const meta = asRecord(asRecord(asRecord(req)?.params)?._meta);
  return meta?.[META_PROTOCOL_VERSION] !== undefined;
}

/**
 * Decides which era serves a single JSON-RPC message and, for modern
 * requests, validates the per-request `_meta` and the mirrored HTTP headers.
 */
export function classifyRequest(req: JsonRpcReq, headers: Headers): ProtocolClassification {
  const meta = requestMeta(req);
  const metaVersion = meta?.[META_PROTOCOL_VERSION];
  const headerVersion = headers.get("mcp-protocol-version")?.trim() || null;

  if (metaVersion === undefined) {
    if (!headerVersion || LEGACY_PROTOCOL_VERSIONS.has(headerVersion)) return { era: "legacy" };
    // A modern header without the required `_meta` is a malformed modern request.
    if (!MODERN_PROTOCOL_VERSIONS.includes(headerVersion)) {
      return { era: "invalid", error: unsupportedVersion(headerVersion) };
    }
    return {
      era: "invalid",
      error: {
        status: 400,
        code: -32602,
        message: `Invalid params: _meta["${META_PROTOCOL_VERSION}"] is required`,
      },
    };
  }

  if (typeof metaVersion !== "string" || !metaVersion) {
    return {
      era: "invalid",
      error: {
        status: 400,
        code: -32602,
        message: `Invalid params: _meta["${META_PROTOCOL_VERSION}"] must be a string`,
      },
    };
  }
  if (!MODERN_PROTOCOL_VERSIONS.includes(metaVersion)) {
    return { era: "invalid", error: unsupportedVersion(metaVersion) };
  }

  const capabilities = asRecord(meta?.[META_CLIENT_CAPABILITIES]);
  if (!capabilities) {
    return {
      era: "invalid",
      error: {
        status: 400,
        code: -32602,
        message: `Invalid params: _meta["${META_CLIENT_CAPABILITIES}"] is required`,
      },
    };
  }

  const headerError = validateHeaders(req, headers, metaVersion);
  if (headerError) return { era: "invalid", error: headerError };

  const clientInfo = asRecord(meta?.[META_CLIENT_INFO]);
  const nameField = NAMED_METHODS[req.method];
  return {
    era: "modern",
    version: metaVersion,
    clientCapabilities: capabilities as ModernClientCapabilities,
    clientInfo: clientInfo
      ? {
          name: typeof clientInfo.name === "string" ? clientInfo.name : undefined,
          version: typeof clientInfo.version === "string" ? clientInfo.version : undefined,
        }
      : undefined,
    mcpName: nameField ? String(asRecord(req.params)?.[nameField] ?? "") : undefined,
  };
}

function validateHeaders(
  req: JsonRpcReq,
  headers: Headers,
  metaVersion: string,
): ProtocolError | null {
  const headerVersion = headers.get("mcp-protocol-version");
  if (headerVersion === null) return headerMismatch("MCP-Protocol-Version header is required");
  if (headerVersion.trim() !== metaVersion) {
    return headerMismatch(
      `MCP-Protocol-Version header value '${headerVersion.trim()}' does not match body value '${metaVersion}'`,
    );
  }

  const method = headers.get("mcp-method");
  if (method === null) return headerMismatch("Mcp-Method header is required");
  if (method.trim() !== req.method) {
    return headerMismatch(
      `Mcp-Method header value '${method.trim()}' does not match body value '${req.method}'`,
    );
  }

  const nameField = NAMED_METHODS[req.method];
  if (nameField) {
    const raw = headers.get("mcp-name");
    if (raw === null) return headerMismatch("Mcp-Name header is required");
    const decoded = decodeMcpHeaderValue(raw.trim());
    if (decoded === null) return headerMismatch("Mcp-Name header value is not valid");
    const bodyValue = String(asRecord(req.params)?.[nameField] ?? "");
    if (decoded !== bodyValue) {
      return headerMismatch(
        `Mcp-Name header value '${decoded}' does not match body value '${bodyValue}'`,
      );
    }
  }
  return null;
}

const BASE64_SENTINEL = /^=\?base64\?([A-Za-z0-9+/]*={0,2})\?=$/;
const PLAIN_HEADER_VALUE = /^[\x20-\x7e\t]*$/;

/**
 * Decodes an `Mcp-Name` / `Mcp-Param-*` header value. Values wrapped in the
 * `=?base64?…?=` sentinel are Base64-decoded as UTF-8; anything else must be
 * plain visible ASCII. Returns null for values that are not valid.
 */
export function decodeMcpHeaderValue(value: string): string | null {
  const sentinel = BASE64_SENTINEL.exec(value);
  if (sentinel) {
    const bytes = Buffer.from(sentinel[1], "base64");
    if (bytes.toString("base64").replace(/=+$/, "") !== sentinel[1].replace(/=+$/, "")) {
      return null;
    }
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    return decoded.includes("�") ? null : decoded;
  }
  if (value.startsWith("=?base64?")) return null;
  return PLAIN_HEADER_VALUE.test(value) ? value : null;
}

const ELICITATION_MODES = new Set(["form", "url"]);

/**
 * Whether a client's `elicitation` capability value allows form-mode
 * elicitation, the only mode this server issues. Per the MCP spec the
 * capability is an object: 2025-06-18 declares it as `elicitation: {}` (form
 * only), and later revisions list modes (`{ form: {} }`, `{ url: {} }`), where
 * an object naming no known mode still means form for backwards
 * compatibility. A URL-only client cannot render a form, so it is reported as
 * unsupported. `true` (older non-spec clients) also counts as form support;
 * `false`, absent, null, arrays and other values do not.
 */
export function elicitationCapabilityAllowsForm(value: unknown): boolean {
  if (value === true) return true;
  const elicitation = asRecord(value);
  if (!elicitation) return false;
  const modes = Object.keys(elicitation).filter((mode) => ELICITATION_MODES.has(mode));
  return modes.length === 0 || modes.includes("form");
}

/** Whether a modern client declared form-mode elicitation support. */
export function supportsFormElicitation(capabilities: ModernClientCapabilities): boolean {
  return elicitationCapabilityAllowsForm(capabilities.elicitation);
}

/** Adds the modern result envelope: `resultType` and `_meta` server identity. */
export function modernResult(result: unknown): Record<string, unknown> {
  const base = asRecord(result) ?? {};
  const meta = asRecord(base._meta) ?? {};
  return {
    ...base,
    resultType: typeof base.resultType === "string" ? base.resultType : "complete",
    _meta: { ...meta, [META_SERVER_INFO]: SERVER_INFO },
  };
}

/** Result for `server/discover`. */
export function discoverResult(instructions: string): Record<string, unknown> {
  return modernResult({
    supportedVersions: [...MODERN_PROTOCOL_VERSIONS],
    capabilities: { tools: {}, extensions: {} },
    instructions,
    ttlMs: 3_600_000,
    cacheScope: "private",
  });
}

/** HTTP status a modern JSON-RPC error code maps to. */
export function modernErrorStatus(code: number): number {
  if (code === -32601) return 404;
  if (
    code === HEADER_MISMATCH ||
    code === MISSING_REQUIRED_CLIENT_CAPABILITY ||
    code === UNSUPPORTED_PROTOCOL_VERSION
  ) {
    return 400;
  }
  if (code === -32003 || code === -32004) return 429;
  return 200;
}
