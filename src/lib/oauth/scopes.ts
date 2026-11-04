// MCP scopes granted to OAuth clients. Safe to import from client components.
//
// Supabase Auth has no custom OAuth scopes yet, so the user picks these on the
// consent page and they are stored per client in public.oauth_grants.
// Platform API keys (nmcp_…) carry every scope.

export const MCP_SCOPES = ["mcp:tools:read", "mcp:tools:execute", "mcp:workflows:write"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

export const DEFAULT_GRANTED_SCOPES: readonly McpScope[] = ["mcp:tools:read"];

export const SCOPE_LABELS: Record<McpScope, { title: string; description: string }> = {
  "mcp:tools:read": {
    title: "Read",
    description:
      "Read workflows, executions, nodes and templates, and run previews and validation.",
  },
  "mcp:tools:execute": {
    title: "Execute",
    description: "Run workflows and deployment tests in your n8n instance.",
  },
  "mcp:workflows:write": {
    title: "Change workflows",
    description: "Create, change, activate, roll back and delete workflows.",
  },
};

export function isMcpScope(value: unknown): value is McpScope {
  return typeof value === "string" && (MCP_SCOPES as readonly string[]).includes(value);
}

export function missingScopes(granted: readonly string[], required: readonly McpScope[]) {
  return required.filter((scope) => !granted.includes(scope));
}
