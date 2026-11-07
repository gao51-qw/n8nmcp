// Shared MCP gateway types. Type-only: no runtime code, no imports with side effects.
import type { Tier } from "@/lib/tiers";
import type { McpScope } from "@/lib/oauth/scopes";
import type { WorkflowPolicyContext } from "@/lib/workflow-agent";

export type AuthedKey = {
  user_id: string;
  /** Platform key id, or `oauth:<client_id>` for OAuth access tokens. */
  key_id: string;
  tier: Tier;
  /** Missing on callers built before OAuth support; treat as "api_key". */
  auth_source?: "api_key" | "oauth";
  /** OAuth client id when auth_source is "oauth". */
  client_id?: string;
  /** Granted MCP scopes; platform keys carry every scope. */
  scopes?: readonly McpScope[];
};

export type ClientCapabilities = {
  elicitation?: boolean;
  sampling?: boolean;
};

export type ElicitationRequest = {
  title: string;
  description: string;
  details?: string;
  schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type ToolContext = {
  user_id?: string;
  /** Per-request id (x-request-id or random); never stable across calls. */
  request_id?: string;
  /**
   * The MCP session the call belongs to (`Mcp-Session-Id`), when the client
   * sends one. Trusted previews recorded under a session may only be applied
   * from that session; the dashboard applies them without a session.
   */
  session_id?: string;
  clientCapabilities?: ClientCapabilities;
  requestElicitation?: (request: ElicitationRequest) => Promise<Record<string, unknown>>;
  policy?: WorkflowPolicyContext;
  confirmationVerified?: boolean;
};

/** Pick the user's first n8n instance (single-instance MVP). */
/** A user's n8n instance with decrypted credentials (server-side only). */
export type N8nInstance = {
  id: string;
  name: string;
  base_url: string;
  api_key: string;
  /** Present when an instance-level MCP token is stored. */
  native?: NativeInstanceMcp | null;
};

/** Decrypted instance-level MCP token and the native tools found for it. */
export type NativeInstanceMcp = { token: string; tools: string[] };
