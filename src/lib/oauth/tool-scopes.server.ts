// Which MCP scope each tool call needs.
import { TOOLS } from "@/lib/mcp-tool-definitions";
import type { McpScope } from "@/lib/oauth/scopes";

/** Tools that run workflows rather than only changing their definition. */
const EXECUTE_ONLY_TOOLS = new Set(["execute_workflow"]);
/** Tools that both change and run workflows. */
const WRITE_AND_EXECUTE_TOOLS = new Set(["deploy_and_test_workflow"]);

const LOCAL_READ_ONLY = new Map(
  TOOLS.map((tool) => [
    tool.name,
    (tool as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint === true,
  ]),
);

/**
 * Scopes a tool call needs. Local tools are classified by their readOnlyHint;
 * upstream tools are read-only knowledge tools unless the upstream marks them
 * as management tools (which mutate n8n). Unknown local names fall through to
 * the upstream rule; dispatch rejects them anyway.
 */
export function requiredScopesForTool(name: string, upstreamManagement = false): McpScope[] {
  if (EXECUTE_ONLY_TOOLS.has(name)) return ["mcp:tools:execute"];
  if (WRITE_AND_EXECUTE_TOOLS.has(name)) return ["mcp:tools:execute", "mcp:workflows:write"];
  const localReadOnly = LOCAL_READ_ONLY.get(name);
  if (localReadOnly !== undefined) {
    return localReadOnly ? ["mcp:tools:read"] : ["mcp:workflows:write"];
  }
  return upstreamManagement ? ["mcp:workflows:write"] : ["mcp:tools:read"];
}
