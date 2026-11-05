// Client for n8n's built-in instance-level MCP server (`<base>/mcp-server/http`).
//
// n8n (2.12+) exposes workflow execution, execution lookup, native version
// history and node-option resolution there, none of which the Public API has.
// Authentication is the user's personal MCP access token (Settings →
// Instance-level MCP), stored encrypted per instance.
//
// The server is a legacy-era MCP server: the client opens with `initialize`,
// keeps the `Mcp-Session-Id` it may hand out, and accepts either a JSON body
// or an SSE stream for each response. Every request goes through the SSRF
// guard (public targets only, no redirects).
import { safeFetchPublicUrl } from "@/lib/ssrf-guard.server";

export const NATIVE_MCP_PATH = "/mcp-server/http";
const CLIENT_PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "n8n-mcp-gateway", version: "0.3.0" };
const DEFAULT_TIMEOUT_MS = 30_000;

export type NativeMcpErrorKind = "unauthorized" | "unavailable" | "protocol" | "tool";

export class NativeMcpError extends Error {
  constructor(
    public readonly kind: NativeMcpErrorKind,
    message: string,
  ) {
    super(message);
  }
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type NativeMcpClientOptions = {
  baseUrl: string;
  token: string;
  timeoutMs?: number;
  fetchImpl?: Fetcher;
};

export type NativeMcpTool = { name: string; annotations?: Record<string, unknown> };

export function nativeMcpEndpoint(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}${NATIVE_MCP_PATH}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Finds the JSON-RPC response with `id` in an SSE body. */
export function parseSseResponse(body: string, id: number): Record<string, unknown> | null {
  for (const event of body.split(/\r?\n\r?\n/)) {
    const data = event
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data) continue;
    try {
      const message = JSON.parse(data) as unknown;
      if (isRecord(message) && message.id === id) return message;
    } catch {
      // Not JSON (keep-alive or partial event); keep scanning.
    }
  }
  return null;
}

/** Turns a tools/call result into its payload, or throws for isError results. */
export function toolPayload(result: unknown): unknown {
  if (!isRecord(result)) throw new NativeMcpError("protocol", "tool result is not an object");
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content
    .filter(
      (item): item is { type: string; text: string } =>
        isRecord(item) && typeof item.text === "string",
    )
    .map((item) => item.text)
    .join("\n");
  if (result.isError === true) {
    throw new NativeMcpError("tool", text.slice(0, 500) || "n8n MCP tool reported an error");
  }
  if (result.structuredContent !== undefined) return result.structuredContent;
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class NativeMcpClient {
  private readonly endpoint: string;
  private readonly fetchImpl: Fetcher;
  private readonly timeoutMs: number;
  private nextId = 1;
  private sessionId: string | null = null;
  private protocolVersion: string | null = null;
  private ready: Promise<void> | null = null;

  constructor(private readonly options: NativeMcpClientOptions) {
    this.endpoint = nativeMcpEndpoint(options.baseUrl);
    this.fetchImpl = options.fetchImpl ?? ((url, init) => safeFetchPublicUrl(url, init));
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  get negotiatedProtocolVersion(): string | null {
    return this.protocolVersion;
  }

  private headers(method: string, name?: string): Record<string, string> {
    return {
      authorization: `Bearer ${this.options.token}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-method": method,
      ...(name ? { "mcp-name": name } : {}),
      ...(this.protocolVersion ? { "mcp-protocol-version": this.protocolVersion } : {}),
      ...(this.sessionId ? { "mcp-session-id": this.sessionId } : {}),
    };
  }

  private async post(
    method: string,
    params: Record<string, unknown>,
    options: { name?: string; notification?: boolean } = {},
  ) {
    const id = this.nextId++;
    const message = options.notification
      ? { jsonrpc: "2.0", method, params }
      : { jsonrpc: "2.0", id, method, params };
    let response: Response;
    try {
      response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: this.headers(method, options.name),
        body: JSON.stringify(message),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new NativeMcpError(
        "unavailable",
        `n8n MCP request failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const session = response.headers.get("mcp-session-id");
    if (session) this.sessionId = session;
    if (response.status === 401 || response.status === 403) {
      throw new NativeMcpError("unauthorized", "n8n rejected the MCP access token");
    }
    if (options.notification) return null;
    if (!response.ok) {
      throw new NativeMcpError(
        response.status >= 500 ? "unavailable" : "protocol",
        `n8n MCP request failed with status ${response.status}`,
      );
    }
    const body = await response.text();
    const isSse = (response.headers.get("content-type") ?? "").includes("text/event-stream");
    let payload: Record<string, unknown> | null = null;
    if (isSse) {
      payload = parseSseResponse(body, id);
    } else {
      try {
        const parsed = JSON.parse(body) as unknown;
        payload = isRecord(parsed) ? parsed : null;
      } catch {
        payload = null;
      }
    }
    if (!payload)
      throw new NativeMcpError("protocol", "n8n MCP response was not a JSON-RPC message");
    if (isRecord(payload.error)) {
      throw new NativeMcpError(
        "protocol",
        `n8n MCP error ${String(payload.error.code ?? "")}: ${String(payload.error.message ?? "")}`.trim(),
      );
    }
    return payload.result;
  }

  /** Runs the initialize handshake once per client. */
  async connect(): Promise<void> {
    this.ready ??= (async () => {
      const result = await this.post("initialize", {
        protocolVersion: CLIENT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      });
      const version =
        isRecord(result) && typeof result.protocolVersion === "string"
          ? result.protocolVersion
          : null;
      if (!version)
        throw new NativeMcpError("protocol", "n8n MCP initialize returned no protocol version");
      this.protocolVersion = version;
      await this.post("notifications/initialized", {}, { notification: true });
    })().catch((error) => {
      this.ready = null;
      throw error;
    });
    return this.ready;
  }

  async listTools(): Promise<NativeMcpTool[]> {
    await this.connect();
    const result = await this.withRetry(() => this.post("tools/list", {}));
    const tools = isRecord(result) && Array.isArray(result.tools) ? result.tools : [];
    return tools
      .filter(
        (tool): tool is Record<string, unknown> => isRecord(tool) && typeof tool.name === "string",
      )
      .map((tool) => ({
        name: String(tool.name),
        annotations: isRecord(tool.annotations) ? tool.annotations : undefined,
      }));
  }

  /**
   * Calls a native tool. Pass `idempotent: true` only for read-only tools: a
   * network failure is then retried once. Anything that runs or changes
   * workflows is sent exactly once.
   */
  async callTool(
    name: string,
    args: Record<string, unknown>,
    options: { idempotent?: boolean } = {},
  ) {
    await this.connect();
    const run = () => this.post("tools/call", { name, arguments: args }, { name });
    const result = options.idempotent ? await this.withRetry(run) : await run();
    return toolPayload(result);
  }

  private async withRetry<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } catch (error) {
      if (error instanceof NativeMcpError && error.kind === "unavailable") return run();
      throw error;
    }
  }
}

export type NativeMcpCapabilities = {
  protocolVersion: string | null;
  tools: string[];
  checkedAt: string;
};

/** Connects with the token and records which native tools are available. */
export async function discoverNativeCapabilities(
  options: NativeMcpClientOptions,
): Promise<NativeMcpCapabilities> {
  const client = new NativeMcpClient(options);
  const tools = await client.listTools();
  return {
    protocolVersion: client.negotiatedProtocolVersion,
    tools: tools.map((tool) => tool.name).sort(),
    checkedAt: new Date().toISOString(),
  };
}
