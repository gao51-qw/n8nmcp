// The tool list the gateway advertises: local tools merged with upstream
// knowledge/management tools (server-only).
import { listUpstreamTools, type UpstreamTool } from "@/lib/mcp-upstream.server";
import { TOOLS } from "@/lib/mcp-tool-definitions";

export const KNOWLEDGE_TOOL_MAP = Object.freeze({
  search_nodes: "search_nodes",
  get_node: "get_node_essentials",
  search_templates: "search_templates",
  get_template: "get_workflow_template",
} as const);

// Names dispatched locally (CRUD + orchestrated). Built from TOOLS, which
// merges LOCAL_TOOLS with the orchestrated tool schemas, so every advertised
// tool is also routable through runTool.
export const LOCAL_NAMES: Set<string> = new Set(TOOLS.map((t) => t.name));

/**
 * Merge local tools with upstream knowledge/management tools (czlonkowski/n8n-mcp).
 * Local definitions win on name collisions. The result is sorted by name so
 * tools/list is deterministic (MCP 2026-07-28 asks for this to keep client
 * caches and LLM prompt caches stable).
 */
export async function getMergedTools(): Promise<
  Array<{ name: string; description?: string; inputSchema?: unknown }>
> {
  const upstream: UpstreamTool[] = await listUpstreamTools(false);
  const merged: Array<{ name: string; description?: string; inputSchema?: unknown }> = [...TOOLS];
  const seen = new Set(LOCAL_NAMES);
  for (const t of upstream) {
    if (!t?.name || seen.has(t.name)) continue;
    seen.add(t.name);
    merged.push(t);
  }
  return merged.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}
