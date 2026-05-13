// MCP Streamable HTTP gateway helpers (server-only).
// Auth: Bearer nmcp_<...> from `Authorization` header → SHA-256 → platform_api_keys lookup.
// Rate limit: in-memory token bucket per user + daily quota check via usage_daily.
import { hashPlatformApiKey, decryptSecret } from "./crypto.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TIER_DAILY_LIMITS, type Tier } from "./tiers";
import {
  callUpstreamTool,
  categorize,
  isManagementTool,
  isUpstreamConfigured,
  listUpstreamTools,
  type UpstreamTool,
  type CallerCtx,
} from "./mcp-upstream.server";

export type AuthedKey = {
  user_id: string;
  key_id: string;
  tier: Tier;
};

// In-memory short-window throttle (per Worker isolate). 60 req / 10s per user.
const buckets = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10_000;
const WINDOW_MAX = 60;

export function shortWindowAllow(userId: string): boolean {
  const now = Date.now();
  const b = buckets.get(userId);
  if (!b || b.resetAt < now) {
    buckets.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (b.count >= WINDOW_MAX) return false;
  b.count++;
  return true;
}

export async function authenticateBearer(req: Request): Promise<AuthedKey | null> {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(nmcp_[A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const full = m[1];
  const hash = hashPlatformApiKey(full);

  const { data: key } = await supabaseAdmin
    .from("platform_api_keys")
    .select("id,user_id,revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (!key || key.revoked_at) return null;

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("tier,status")
    .eq("user_id", key.user_id)
    .maybeSingle();

  // touch last_used_at (fire and forget)
  void supabaseAdmin
    .from("platform_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", key.id);

  return {
    user_id: key.user_id,
    key_id: key.id,
    tier: ((sub?.tier as Tier) ?? "free"),
  };
}

export async function checkDailyQuota(auth: AuthedKey): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = TIER_DAILY_LIMITS[auth.tier] ?? TIER_DAILY_LIMITS.free;
  const { data } = await supabaseAdmin.rpc("get_today_mcp_usage", { _user_id: auth.user_id });
  const used = typeof data === "number" ? data : 0;
  return { ok: used < limit, used, limit };
}

export async function recordCall(opts: {
  user_id: string;
  instance_id?: string | null;
  tool_name: string | null;
  status: "ok" | "error" | "rate_limited";
  latency_ms: number;
  error_message?: string | null;
  upstream?: boolean;
  category?: "local" | "knowledge" | "management" | null;
}) {
  await Promise.allSettled([
    supabaseAdmin.from("mcp_call_logs").insert({
      user_id: opts.user_id,
      instance_id: opts.instance_id ?? null,
      tool_name: opts.tool_name,
      status: opts.status,
      latency_ms: opts.latency_ms,
      error_message: opts.error_message ?? null,
      upstream: opts.upstream ?? false,
      category: opts.category ?? null,
    }),
    supabaseAdmin.rpc("increment_mcp_usage", { _user_id: opts.user_id, _n: 1 }),
  ]);
}

/** Pick the user's first n8n instance (single-instance MVP). */
export async function getDefaultInstance(userId: string) {
  const { data } = await supabaseAdmin
    .from("n8n_instances")
    .select("id,base_url,api_key_encrypted,api_key_iv,api_key_tag,name")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    base_url: data.base_url,
    api_key: decryptSecret({
      ciphertext: data.api_key_encrypted,
      iv: data.api_key_iv,
      tag: data.api_key_tag,
    }),
  };
}

// ---- MCP tool definitions ---------------------------------------------------

export const LOCAL_TOOLS = [
  {
    name: "list_workflows",
    description: "List workflows from the user's n8n instance.",
    inputSchema: {
      type: "object",
      properties: {
        active: { type: "boolean", description: "Filter by active state" },
        limit: { type: "number", default: 50 },
      },
    },
  },
  {
    name: "get_workflow",
    description: "Fetch a single workflow by id.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string" } },
    },
  },
  {
    name: "execute_workflow",
    description: "Trigger a workflow execution by id with optional JSON input.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string" },
        data: { type: "object", description: "Input payload" },
      },
    },
  },
  {
    name: "list_executions",
    description: "List recent workflow executions.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string" },
        limit: { type: "number", default: 20 },
      },
    },
  },
  {
    name: "import_workflow_template",
    description:
      "Import a workflow template (by template id from search_workflow_templates / get_workflow_template) " +
      "into the user's n8n instance. Fetches the workflow JSON from the knowledge base and POSTs it to " +
      "/api/v1/workflows. Returns the created workflow id. Set activate=true to also activate it.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "number", description: "Template id" },
        name: { type: "string", description: "Override workflow name on import" },
        activate: { type: "boolean", default: false },
      },
    },
  },
] as const;

type Inst = NonNullable<Awaited<ReturnType<typeof getDefaultInstance>>>;

async function n8n(inst: Inst, path: string, init?: RequestInit) {
  const url = `${inst.base_url}${path}`;
  const { assertPublicUrl } = await import("./ssrf-guard.server");
  await assertPublicUrl(url);
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-N8N-API-KEY": inst.api_key,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    throw new Error(`n8n ${res.status}: ${typeof body === "string" ? body : JSON.stringify(body)}`);
  }
  return body;
}

export async function runTool(
  inst: Inst,
  name: string,
  args: Record<string, unknown>
): Promise<unknown> {
  switch (name) {
    case "list_workflows": {
      const qs = new URLSearchParams();
      if (typeof args.active === "boolean") qs.set("active", String(args.active));
      qs.set("limit", String(args.limit ?? 50));
      return n8n(inst, `/api/v1/workflows?${qs}`);
    }
    case "get_workflow":
      return n8n(inst, `/api/v1/workflows/${encodeURIComponent(String(args.id))}`);
    case "execute_workflow":
      return n8n(inst, `/api/v1/workflows/${encodeURIComponent(String(args.id))}/execute`, {
        method: "POST",
        body: JSON.stringify(args.data ?? {}),
      });
    case "list_executions": {
      const qs = new URLSearchParams();
      if (args.workflowId) qs.set("workflowId", String(args.workflowId));
      qs.set("limit", String(args.limit ?? 20));
      return n8n(inst, `/api/v1/executions?${qs}`);
    }
    case "import_workflow_template": {
      const id = Number(args.id);
      if (!Number.isFinite(id)) throw new Error("id (template id) is required");
      if (!isUpstreamConfigured()) {
        throw new Error("Knowledge base is not configured on this gateway; cannot resolve template.");
      }
      // 1) fetch template JSON from the upstream knowledge base
      const tpl = (await callUpstreamTool("get_workflow_template", { id }, null, {
        source: "import_workflow_template",
      })) as {
        content?: Array<{ type: string; text: string }>;
      };
      const raw = tpl?.content?.[0]?.text;
      if (!raw) throw new Error("template not found in knowledge base");
      const parsed = JSON.parse(raw) as {
        name?: string;
        workflow?: { name?: string; nodes?: unknown[]; connections?: unknown; settings?: unknown };
        error?: string;
      };
      if (parsed.error) throw new Error(parsed.error);
      const wf = parsed.workflow;
      if (!wf?.nodes) throw new Error("template has no workflow body");
      // 2) build n8n create payload (only fields the n8n REST API accepts on create)
      const payload = {
        name: String(args.name ?? wf.name ?? parsed.name ?? `template-${id}`),
        nodes: wf.nodes,
        connections: wf.connections ?? {},
        settings: wf.settings ?? {},
      };
      const created = (await n8n(inst, "/api/v1/workflows", {
        method: "POST",
        body: JSON.stringify(payload),
      })) as { id?: string | number };
      // 3) optionally activate
      if (args.activate && created?.id != null) {
        await n8n(inst, `/api/v1/workflows/${encodeURIComponent(String(created.id))}/activate`, {
          method: "POST",
        }).catch((e) => {
          console.warn("[import_workflow_template] activate failed:", (e as Error).message);
        });
      }
      return { ok: true, workflow_id: created?.id, name: payload.name, template_id: id };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const LOCAL_NAMES: Set<string> = new Set(LOCAL_TOOLS.map((t) => t.name));

/** Backwards-compatible alias used by tests. */
export const TOOLS = LOCAL_TOOLS;

/**
 * Merge local tools with upstream knowledge/management tools (czlonkowski/n8n-mcp).
 * Local definitions win on name collisions.
 */
export async function getMergedTools(): Promise<
  Array<{ name: string; description?: string; inputSchema?: unknown }>
> {
  const upstream: UpstreamTool[] = await listUpstreamTools(false);
  const merged: Array<{ name: string; description?: string; inputSchema?: unknown }> = [
    ...LOCAL_TOOLS,
  ];
  for (const t of upstream) {
    if (!t?.name || LOCAL_NAMES.has(t.name)) continue;
    merged.push(t);
  }
  return merged;
}

export type DispatchResult = {
  output: unknown;
  upstream: boolean;
  category: "local" | "knowledge" | "management";
  needsInstance: boolean;
};

/**
 * Route a tool call to local handler or upstream proxy.
 * `inst` is required for local tools and for upstream `n8n_*` management tools;
 * upstream knowledge tools work without it.
 */
export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  inst: Inst | null,
  caller?: CallerCtx,
): Promise<DispatchResult> {
  if (LOCAL_NAMES.has(name)) {
    if (!inst) {
      return {
        output: null,
        upstream: false,
        category: "local",
        needsInstance: true,
      };
    }
    const out = await runTool(inst, name, args);
    return { output: out, upstream: false, category: "local", needsInstance: false };
  }

  if (!isUpstreamConfigured()) {
    throw new Error(
      `Unknown tool: ${name} (upstream knowledge base is not configured on this gateway)`,
    );
  }

  const management = isManagementTool(name);
  if (management && !inst) {
    return {
      output: null,
      upstream: true,
      category: "management",
      needsInstance: true,
    };
  }

  const out = await callUpstreamTool(
    name,
    args,
    management && inst ? { base_url: inst.base_url, api_key: inst.api_key } : null,
    caller,
  );
  return {
    output: out,
    upstream: true,
    category: categorize(name),
    needsInstance: false,
  };
}
