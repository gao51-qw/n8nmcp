// Lovable AI-powered chat agent for n8n workflow generation.
// Auth: requires user JWT. Increments prompt_usage_daily and enforces tier limits.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TIER_PROMPTS_DAY: Record<string, number> = {
  free: 5,
  pro: 200,
  enterprise: -1,
};

const SYSTEM_BASE = `You are an expert n8n workflow architect. When the user describes an automation, respond conversationally explaining your plan, and when appropriate include a complete valid n8n workflow JSON inside a fenced \`\`\`json code block. Use real n8n node types (e.g. n8n-nodes-base.webhook, n8n-nodes-base.httpRequest, n8n-nodes-base.set, etc.). Keep responses focused.`;

// Bundled fallback stats — kept in sync with src/data/n8n-stats.json.
// Used when the upstream MCP knowledge base is unreachable so the model still has
// authoritative numbers instead of hallucinating "300-400 nodes".
const FALLBACK_STATS = {
  totalNodes: 1994,
  coreNodes: 661,
  communityNodes: 1333,
  communityPackages: 553,
  aiTools: 105,
  triggers: 290,
  generatedAt: "2026-05-12",
};

type KnowledgeStatus =
  | { mode: "live"; stats: Record<string, unknown> }
  | { mode: "fallback"; stats: typeof FALLBACK_STATS; reason: string };

function buildSourceFooter(status: KnowledgeStatus): string {
  const ts = new Date().toISOString();
  const s = status.stats as Record<string, unknown>;
  const total = s.totalNodes ?? s.total ?? "?";
  const ai = s.aiTools ?? s.ai_tools ?? "?";
  if (status.mode === "live") {
    return `---\n*📡 Source: live MCP \`/health\` (statsCount) · ${total} nodes · ${ai} AI tools · fetched ${ts}*`;
  }
  return `---\n*⚠️ Source: cached snapshot (${FALLBACK_STATS.generatedAt}) · ${total} nodes · ${ai} AI tools · live MCP unavailable: ${status.reason} · fetched ${ts}*`;
}

async function fetchKnowledgeStatus(): Promise<KnowledgeStatus> {
  const mcpUrl = Deno.env.get("UPSTREAM_N8N_MCP_URL");
  if (!mcpUrl) {
    return { mode: "fallback", stats: FALLBACK_STATS, reason: "UPSTREAM_N8N_MCP_URL not configured (MCP not deployed yet)" };
  }
  const healthUrl = mcpUrl.replace(/\/mcp\/?$/, "") + "/health";
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(healthUrl, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) {
      return { mode: "fallback", stats: FALLBACK_STATS, reason: `health endpoint returned HTTP ${res.status}` };
    }
    const data = await res.json();
    if (!data?.ok) {
      return { mode: "fallback", stats: FALLBACK_STATS, reason: "health endpoint reported not-ok" };
    }
    return { mode: "live", stats: data };
  } catch (e) {
    const msg = (e as Error).name === "AbortError" ? "timeout after 3s" : (e as Error).message;
    return { mode: "fallback", stats: FALLBACK_STATS, reason: `unreachable: ${msg}` };
  }
}

function buildSystemPrompt(status: KnowledgeStatus): string {
  const s = status.stats as Record<string, unknown>;
  const numbers = [
    `total nodes: ${s.totalNodes ?? s.total ?? "?"}`,
    `core nodes: ${s.coreNodes ?? s.core ?? "?"}`,
    `community nodes: ${s.communityNodes ?? s.community ?? "?"}`,
    `AI tools: ${s.aiTools ?? s.ai_tools ?? "?"}`,
    `triggers: ${s.triggers ?? "?"}`,
  ].join(", ");

  if (status.mode === "live") {
    return `${SYSTEM_BASE}

Authoritative knowledge-base stats (live from MCP /health): ${numbers}.
When users ask quantitative questions about nodes, use these exact numbers — never guess.`;
  }

  return `${SYSTEM_BASE}

Knowledge-base retrieval is currently UNAVAILABLE (${status.reason}). You are running with bundled fallback stats from ${FALLBACK_STATS.generatedAt}: ${numbers}.
- For quantitative "how many nodes" questions, use these fallback numbers and append a brief note like "(based on cached snapshot from ${FALLBACK_STATS.generatedAt}; live retrieval is temporarily unavailable)".
- For specific lookups ("how does node X work", "show me an example of Y"), tell the user the live node knowledge base is temporarily unavailable and suggest they retry shortly. Briefly mention the reason: ${status.reason}.
- Still help with general workflow design and JSON examples from your training data.`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "");
    if (!token) return jsonErr(401, "Missing auth");

    const supaUrl = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const lovableKey = Deno.env.get("LOVABLE_API_KEY");
    if (!lovableKey) return jsonErr(500, "LOVABLE_API_KEY not configured");

    const userClient = createClient(supaUrl, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const admin = createClient(supaUrl, service);

    const { data: userData, error: uErr } = await userClient.auth.getUser();
    if (uErr || !userData.user) return jsonErr(401, "Unauthorized");
    const user = userData.user;

    const body = await req.json();
    const message = String(body?.message ?? "").trim();
    let conversationId: string | null = body?.conversation_id ?? null;
    if (!message) return jsonErr(400, "Message required");
    if (message.length > 4000) return jsonErr(400, "Message too long (max 4000 chars)");

    // Tier check
    const { data: sub } = await admin
      .from("subscriptions")
      .select("tier")
      .eq("user_id", user.id)
      .maybeSingle();
    const tier = sub?.tier ?? "free";
    const limit = TIER_PROMPTS_DAY[tier] ?? 5;
    if (limit !== -1) {
      const { data: usage } = await admin
        .from("prompt_usage_daily")
        .select("prompts")
        .eq("user_id", user.id)
        .eq("day", new Date().toISOString().slice(0, 10))
        .maybeSingle();
      const used = usage?.prompts ?? 0;
      if (used >= limit) {
        return jsonErr(429, `Daily prompt limit reached (${used}/${limit}). Upgrade for more.`);
      }
    }

    // Ensure conversation
    if (!conversationId) {
      const { data: conv, error } = await userClient
        .from("chat_conversations")
        .insert({ user_id: user.id, title: message.slice(0, 60) })
        .select("id")
        .single();
      if (error) return jsonErr(500, error.message);
      conversationId = conv.id;
    }

    // Load history (last 20)
    const { data: history } = await userClient
      .from("chat_messages")
      .select("role,content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .limit(20);

    // Insert user message
    await userClient
      .from("chat_messages")
      .insert({
        conversation_id: conversationId,
        user_id: user.id,
        role: "user",
        content: message,
      });

    // Probe MCP knowledge base (or fall back to bundled stats)
    const knowledge = await fetchKnowledgeStatus();
    const systemPrompt = buildSystemPrompt(knowledge);

    // Call Lovable AI Gateway
    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          { role: "system", content: systemPrompt },
          ...(history ?? []).map((m) => ({ role: m.role, content: m.content })),
          { role: "user", content: message },
        ],
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      if (aiRes.status === 429) return jsonErr(429, "AI rate limit, try again shortly");
      if (aiRes.status === 402) return jsonErr(402, "AI credits exhausted — top up Lovable workspace");
      console.error("AI gateway error", aiRes.status, errText.slice(0, 500));
      return jsonErr(502, "AI service temporarily unavailable");
    }

    const aiJson = await aiRes.json();
    const rawReply: string = aiJson?.choices?.[0]?.message?.content ?? "(empty response)";
    const reply = rawReply + "\n\n" + buildSourceFooter(knowledge);

    // Persist assistant message
    await userClient
      .from("chat_messages")
      .insert({
        conversation_id: conversationId,
        user_id: user.id,
        role: "assistant",
        content: reply,
      });

    // Bump usage
    await admin.rpc("increment_prompt_usage", { _user_id: user.id, _n: 1 });

    return new Response(
      JSON.stringify({ conversation_id: conversationId, reply }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("chat-agent error", e);
    return jsonErr(500, "Internal server error");
  }
});

function jsonErr(status: number, error: string) {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
