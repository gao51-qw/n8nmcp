// Upstream proxy to czlonkowski/n8n-mcp.
// Forwards JSON-RPC over MCP Streamable HTTP, parses both JSON and SSE responses,
// caches tools/list, and injects per-user n8n credentials into management tool calls.
//
// Configure via env:
//   UPSTREAM_N8N_MCP_URL    e.g. https://n8n-mcp.example.com/mcp
//   UPSTREAM_N8N_MCP_TOKEN  bearer token for upstream AUTH_TOKEN
//
// Auth hardening:
// - In production (NODE_ENV=production) the bearer token is REQUIRED; calls
//   without it throw before any network I/O.
// - Every outbound call carries a per-call X-Request-Id (uuid) and a non-PII
//   X-Caller-Id (sha256(user_id) prefix). Upstream logs can correlate.
// - Token is sent over Authorization: Bearer; we never log it. A short
//   sha256 fingerprint is logged for ops to confirm rotation took effect.
// - Latency, status, request_id, caller, tool, and upstream host are logged
//   per request via the structured logger.

import { createHash, randomUUID } from "node:crypto";
import { log } from "./logger.server";
import { assertPublicUrl } from "./ssrf-guard.server";

export type UpstreamTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type N8nCreds = {
  base_url: string;
  api_key: string;
};

export type CallerCtx = {
  user_id?: string;
  key_id?: string;
  source?: string; // free-form, e.g. "tools/call" or "tools/list"
};

const TOOL_LIST_TTL_MS = 5 * 60 * 1000;
let toolListCache: { at: number; tools: UpstreamTool[] } | null = null;

export function isUpstreamConfigured(): boolean {
  return !!process.env.UPSTREAM_N8N_MCP_URL;
}

function rpcId() {
  return Math.random().toString(36).slice(2);
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function tokenFingerprint(token: string): string {
  return sha256Hex(token).slice(0, 12);
}

function callerHash(caller?: CallerCtx): string | undefined {
  if (!caller?.user_id) return undefined;
  return sha256Hex(caller.user_id).slice(0, 16);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "unknown";
  }
}

async function rpc(
  method: string,
  params: Record<string, unknown> | undefined,
  extraHeaders?: Record<string, string>,
  caller?: CallerCtx,
): Promise<unknown> {
  const url = process.env.UPSTREAM_N8N_MCP_URL;
  if (!url) throw new Error("UPSTREAM_N8N_MCP_URL is not configured");
  const token = process.env.UPSTREAM_N8N_MCP_TOKEN;
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && !token) {
    // Fail closed in production — never call upstream unauthenticated.
    log.error("mcp.upstream.token_missing", { upstream_host: hostOf(url) });
    throw new Error("UPSTREAM_N8N_MCP_TOKEN is required in production");
  }

  // SSRF guard — refuse private/loopback unless explicitly allow-listed.
  await assertPublicUrl(url);

  const requestId =
    typeof randomUUID === "function" ? randomUUID() : `r_${rpcId()}${rpcId()}`;
  const caller_hash = callerHash(caller);
  const upstream_host = hostOf(url);
  const tool = method === "tools/call" ? String(params?.name ?? "") : undefined;
  const started = Date.now();

  const body = JSON.stringify({ jsonrpc: "2.0", id: rpcId(), method, params: params ?? {} });

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // MCP Streamable HTTP spec requires accepting both
        Accept: "application/json, text/event-stream",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        "X-Request-Id": requestId,
        ...(caller_hash ? { "X-Caller-Id": caller_hash } : {}),
        ...(caller?.source ? { "X-Caller-Source": caller.source } : {}),
        ...(extraHeaders ?? {}),
      },
      body,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (e) {
    log.error("mcp.upstream.network_error", {
      method,
      tool,
      upstream_host,
      request_id: requestId,
      caller: caller_hash,
      latency_ms: Date.now() - started,
      err: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }

  const text = await res.text();
  const latency_ms = Date.now() - started;

  if (!res.ok) {
    log.warn("mcp.upstream.http_error", {
      method,
      tool,
      status: res.status,
      upstream_host,
      request_id: requestId,
      caller: caller_hash,
      latency_ms,
      token_fp: token ? tokenFingerprint(token) : null,
    });
    // Never leak upstream body verbatim to callers — keep generic.
    throw new Error(`upstream ${res.status}`);
  }

  // Either application/json or text/event-stream
  const ct = res.headers.get("content-type") ?? "";
  let payload: unknown;
  if (ct.includes("text/event-stream")) {
    // Parse first SSE `message` event with a JSON-RPC payload
    const events = text.split(/\n\n/);
    for (const ev of events) {
      const dataLines = ev
        .split("\n")
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim());
      const joined = dataLines.join("\n");
      if (!joined || joined === "[DONE]") continue;
      try {
        const obj = JSON.parse(joined);
        if (obj && typeof obj === "object" && ("result" in obj || "error" in obj)) {
          payload = obj;
          break;
        }
      } catch {
        // ignore non-JSON events (e.g. heartbeats)
      }
    }
    if (payload === undefined) throw new Error("upstream SSE returned no JSON-RPC payload");
  } else {
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error(`upstream returned non-JSON body: ${text.slice(0, 200)}`);
    }
  }

  const obj = payload as { result?: unknown; error?: { code: number; message: string; data?: unknown } };
  if (obj.error) {
    log.warn("mcp.upstream.rpc_error", {
      method,
      tool,
      code: obj.error.code,
      upstream_host,
      request_id: requestId,
      caller: caller_hash,
      latency_ms,
    });
    throw new Error(`upstream rpc error ${obj.error.code}: ${obj.error.message}`);
  }

  log.info("mcp.upstream.ok", {
    method,
    tool,
    upstream_host,
    request_id: requestId,
    caller: caller_hash,
    latency_ms,
    transport: ct.includes("text/event-stream") ? "sse" : "json",
  });
  return obj.result;
}

export async function listUpstreamTools(force = false, caller?: CallerCtx): Promise<UpstreamTool[]> {
  if (!isUpstreamConfigured()) return [];
  const now = Date.now();
  if (!force && toolListCache && now - toolListCache.at < TOOL_LIST_TTL_MS) {
    return toolListCache.tools;
  }
  try {
    const result = (await rpc("tools/list", {}, undefined, {
      ...caller,
      source: caller?.source ?? "tools/list",
    })) as { tools?: UpstreamTool[] };
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    toolListCache = { at: now, tools };
    return tools;
  } catch (e) {
    // Don't poison cache on transient failures; serve stale if available.
    if (toolListCache) return toolListCache.tools;
    log.error("mcp.upstream.tools_list_failed", {
      err: e instanceof Error ? e.message : String(e),
    });
    return [];
  }
}

/**
 * Tools whose name starts with `n8n_` are management tools that need real n8n
 * credentials. czlonkowski/n8n-mcp normally reads them from env (N8N_API_URL /
 * N8N_API_KEY). Since we proxy across users, we forward the per-user creds in
 * request headers — the upstream's HTTP transport reads `X-N8n-Api-Url` /
 * `X-N8n-Api-Key` overrides when set, and falls back to its own env otherwise.
 */
export function isManagementTool(name: string): boolean {
  return name.startsWith("n8n_");
}

export async function callUpstreamTool(
  name: string,
  args: Record<string, unknown>,
  creds: N8nCreds | null,
  caller?: CallerCtx,
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (creds && isManagementTool(name)) {
    headers["X-N8n-Api-Url"] = creds.base_url;
    headers["X-N8n-Api-Key"] = creds.api_key;
  }
  const result = await rpc("tools/call", { name, arguments: args }, headers, {
    ...caller,
    source: caller?.source ?? "tools/call",
  });
  return result;
}

export function categorize(name: string): "knowledge" | "management" {
  return isManagementTool(name) ? "management" : "knowledge";
}
