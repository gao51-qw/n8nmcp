import { isOAuthEnabled, mcpResource, oauthIssuer } from "@/lib/oauth/config.server";
import { MCP_SCOPES } from "@/lib/oauth/scopes";

/** RFC 9728 metadata, or null while OAuth is disabled. */
export function protectedResourceMetadata(): Record<string, unknown> | null {
  if (!isOAuthEnabled()) return null;
  return {
    resource: mcpResource(),
    authorization_servers: [oauthIssuer()],
    scopes_supported: [...MCP_SCOPES],
    bearer_methods_supported: ["header"],
    resource_name: "n8n-mcp",
  };
}

/** Browser-based MCP clients fetch the metadata cross-origin. */
export function protectedResourceResponseHeaders(): HeadersInit {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, MCP-Protocol-Version",
    "Cache-Control": "public, max-age=3600",
    "X-Robots-Tag": "noindex,nofollow",
  };
}
