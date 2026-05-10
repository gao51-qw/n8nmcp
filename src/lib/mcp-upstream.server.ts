// Upstream proxy to czlonkowski/n8n-mcp.
// Forwards JSON-RPC over MCP Streamable HTTP, parses both JSON and SSE responses,
// caches tools/list, and injects per-user n8n credentials into management tool calls.
//
// Configure via env:
//   UPSTREAM_N8N_MCP_URL    e.g. https://n8n-mcp.example.com/mcp
//   UPSTREAM_N8N_MCP_TOKEN  bearer token for upstream AUTH_TOKEN

export type UpstreamTool = {
  name: string;
  description?: string;
  inputSchema?: unknown;
};

export type N8nCreds = {
  base_url: string;
  api_key: string;
};

const TOOL_LIST_TTL_MS = 5 * 60 * 1000;
let toolListCache: { at: number; tools: UpstreamTool[] } | null = null;

export function isUpstreamConfigured(): boolean {
  return !!process.env.UPSTREAM_N8N_MCP_URL;
}

function ids() {
  return Math.random().toString(36).slice(2);
}

async function rpc(
  method: string,
  params: Record<string, unknown> | undefined,
  extraHeaders?: Record<string, string>,
): Promise<unknown> {
  const url = process.env.UPSTREAM_N8N_MCP_URL;
  if (!url) throw new Error("UPSTREAM_N8N_MCP_URL is not configured");
  const token = process.env.UPSTREAM_N8N_MCP_TOKEN;

  const body = JSON.stringify({ jsonrpc: "2.0", id: ids(), method, params: params ?? {} });

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      // MCP Streamable HTTP spec requires accepting both
      Accept: "application/json, text/event-stream",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(extraHeaders ?? {}),
    },
    body,
    signal: AbortSignal.timeout(30_000),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`upstream ${res.status}: ${text.slice(0, 500)}`);
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
    throw new Error(`upstream rpc error ${obj.error.code}: ${obj.error.message}`);
  }
  return obj.result;
}

export async function listUpstreamTools(force = false): Promise<UpstreamTool[]> {
  if (!isUpstreamConfigured()) return [];
  const now = Date.now();
  if (!force && toolListCache && now - toolListCache.at < TOOL_LIST_TTL_MS) {
    return toolListCache.tools;
  }
  try {
    const result = (await rpc("tools/list", {})) as { tools?: UpstreamTool[] };
    const tools = Array.isArray(result?.tools) ? result.tools : [];
    toolListCache = { at: now, tools };
    return tools;
  } catch (e) {
    // Don't poison cache on transient failures; serve stale if available.
    if (toolListCache) return toolListCache.tools;
    console.error("[mcp-upstream] tools/list failed:", e);
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
): Promise<unknown> {
  const headers: Record<string, string> = {};
  if (creds && isManagementTool(name)) {
    headers["X-N8n-Api-Url"] = creds.base_url;
    headers["X-N8n-Api-Key"] = creds.api_key;
  }
  const result = await rpc("tools/call", { name, arguments: args }, headers);
  return result;
}

export function categorize(name: string): "knowledge" | "management" {
  return isManagementTool(name) ? "management" : "knowledge";
}
