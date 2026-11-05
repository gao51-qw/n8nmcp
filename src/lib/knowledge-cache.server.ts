// Short-lived cache for read-only Knowledge MCP lookups (search_nodes,
// get_node, search_templates, get_template). Results do not depend on the
// caller, so one entry serves every user. The knowledge base changes weekly,
// so five minutes of staleness is harmless and saves repeated round trips
// while an agent iterates. Errors are never cached.
import { createExpiringStore } from "@/lib/expiring-store";
import { digestArguments } from "@/lib/mcp-request-state.server";

export const KNOWLEDGE_CACHE_TTL_MS = 5 * 60_000;
const MAX_ENTRIES = 1_000;
const CACHEABLE = new Set([
  "search_nodes",
  "get_node_essentials",
  "search_templates",
  "get_workflow_template",
]);

let cache = createExpiringStore<unknown>({ maxEntries: MAX_ENTRIES });

function isErrorResult(value: unknown): boolean {
  return (
    typeof value === "object" && value !== null && (value as { isError?: unknown }).isError === true
  );
}

export async function cachedKnowledgeCall(
  upstreamTool: string,
  args: Record<string, unknown>,
  load: () => Promise<unknown>,
): Promise<unknown> {
  if (!CACHEABLE.has(upstreamTool)) return load();
  const key = `${upstreamTool}:${digestArguments(args)}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  const value = await load();
  if (!isErrorResult(value)) cache.set(key, value, KNOWLEDGE_CACHE_TTL_MS);
  return value;
}

/** Test hook: start from an empty cache. */
export function clearKnowledgeCacheForTests(): void {
  cache = createExpiringStore<unknown>({ maxEntries: MAX_ENTRIES });
}
