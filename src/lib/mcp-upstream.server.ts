// Fixed-origin proxy to the operator-configured internal Knowledge MCP.

import { createHash, randomUUID } from "node:crypto";
import { log } from "./logger.server";
import {
  createKnowledgeMcpTransport,
  KnowledgeResponseError,
  KnowledgeUnavailableError,
} from "./workflow-agent/knowledge-client.server";

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
  source?: string;
  ip?: string;
  ua?: string;
  request_id?: string;
  session_id?: string;
};

const TOOL_LIST_TTL_MS = 5 * 60 * 1000;
let toolListCache: { at: number; tools: UpstreamTool[] } | null = null;

export function isUpstreamConfigured(): boolean {
  return !!process.env.UPSTREAM_N8N_MCP_URL;
}

function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function callerHash(caller?: CallerCtx): string | undefined {
  return caller?.user_id ? sha256Hex(caller.user_id).slice(0, 16) : undefined;
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
  const token = process.env.UPSTREAM_N8N_MCP_TOKEN;
  if (!url || !token) {
    log.error("mcp.upstream.config_missing", {});
    throw new KnowledgeUnavailableError();
  }

  const requestId = randomUUID();
  const caller_hash = callerHash(caller);
  const upstream_host = hostOf(url);
  const tool = method === "tools/call" ? String(params?.name ?? "") : undefined;
  const started = Date.now();

  try {
    const result = await createKnowledgeMcpTransport({ url, token }).callRpc(method, params ?? {}, {
      "X-Request-Id": requestId,
      ...(caller_hash ? { "X-Caller-Id": caller_hash } : {}),
      ...(caller?.source ? { "X-Caller-Source": caller.source } : {}),
      ...(extraHeaders ?? {}),
    });
    log.info("mcp.upstream.ok", {
      method,
      tool,
      upstream_host,
      request_id: requestId,
      caller: caller_hash,
      latency_ms: Date.now() - started,
      transport: "trusted-internal",
    });
    return result;
  } catch (error) {
    log.error("mcp.upstream.network_error", {
      method,
      tool,
      upstream_host,
      request_id: requestId,
      caller: caller_hash,
      latency_ms: Date.now() - started,
      err:
        error instanceof KnowledgeUnavailableError || error instanceof KnowledgeResponseError
          ? error.message
          : "Knowledge service is unavailable",
    });
    throw error;
  }
}

export async function listUpstreamTools(
  force = false,
  caller?: CallerCtx,
): Promise<UpstreamTool[]> {
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
  } catch (error) {
    if (toolListCache) return toolListCache.tools;
    log.error("mcp.upstream.tools_list_failed", {
      err:
        error instanceof KnowledgeUnavailableError || error instanceof KnowledgeResponseError
          ? error.message
          : "Knowledge service is unavailable",
    });
    return [];
  }
}

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
    headers["x-n8n-url"] = creds.base_url;
    headers["x-n8n-key"] = creds.api_key;
  }
  return rpc("tools/call", { name, arguments: args }, headers, {
    ...caller,
    source: caller?.source ?? "tools/call",
  });
}

export function categorize(name: string): "knowledge" | "management" {
  return isManagementTool(name) ? "management" : "knowledge";
}
