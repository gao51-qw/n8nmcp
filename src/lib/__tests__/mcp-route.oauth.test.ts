import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mcpServerMocks = vi.hoisted(() => ({
  authenticateBearer: vi.fn(),
  checkDailyQuota: vi.fn(),
  checkShortWindowQuota: vi.fn(),
  dispatchTool: vi.fn(),
  getDefaultInstance: vi.fn(),
  getMergedTools: vi.fn(),
  recordCall: vi.fn(),
}));

vi.mock("@/lib/mcp.server", () => ({
  ...mcpServerMocks,
  ElicitationRequiredError: class ElicitationRequiredError extends Error {},
}));

vi.mock("@/lib/mcp-upstream.server", () => ({
  isUpstreamConfigured: vi.fn(() => false),
  isManagementTool: vi.fn((name: string) => name.startsWith("n8n_")),
}));

vi.mock("@/lib/logger.server", () => ({
  getRequestId: vi.fn(() => "request-id-1"),
  log: { info: vi.fn(), warn: vi.fn() },
}));

import { mcpPost } from "../mcp-route.server";

function call(name: string, args: Record<string, unknown> = {}) {
  return new Request("https://mcp.example.com/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: "Bearer token" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `call-${name}`,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });
}

function oauthCaller(scopes: string[]) {
  return {
    user_id: "user-1",
    key_id: "oauth:client-1",
    tier: "free",
    auth_source: "oauth",
    client_id: "client-1",
    scopes,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MCP_OAUTH_ENABLED", "1");
  vi.stubEnv("SUPABASE_URL", "https://proj.supabase.co");
  mcpServerMocks.checkShortWindowQuota.mockResolvedValue(true);
  mcpServerMocks.checkDailyQuota.mockResolvedValue({ ok: true, used: 0, limit: 100 });
  mcpServerMocks.getDefaultInstance.mockResolvedValue({ id: "instance-1" });
  mcpServerMocks.dispatchTool.mockResolvedValue({
    output: { ok: true },
    upstream: false,
    category: "local",
    needsInstance: false,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("OAuth on the MCP endpoint", () => {
  it("points unauthenticated clients at the protected resource metadata", async () => {
    mcpServerMocks.authenticateBearer.mockResolvedValue(null);
    const response = await mcpPost(call("list_workflows"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(
      /^Bearer resource_metadata="https:\/\/[^"]+\/\.well-known\/oauth-protected-resource\/mcp"$/,
    );
  });

  it("sends no OAuth challenge while OAuth is disabled", async () => {
    vi.stubEnv("MCP_OAUTH_ENABLED", "0");
    mcpServerMocks.authenticateBearer.mockResolvedValue(null);
    const response = await mcpPost(call("list_workflows"));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toBeNull();
  });

  it("lets a read-scoped client call read-only tools", async () => {
    mcpServerMocks.authenticateBearer.mockResolvedValue(oauthCaller(["mcp:tools:read"]));
    const response = await mcpPost(call("list_workflows"));
    expect(response.status).toBe(200);
    expect(mcpServerMocks.dispatchTool).toHaveBeenCalled();
    expect(mcpServerMocks.recordCall).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { source: "oauth", client_id: "client-1" } }),
    );
  });

  it("answers 403 insufficient_scope when the grant lacks a scope", async () => {
    mcpServerMocks.authenticateBearer.mockResolvedValue(oauthCaller(["mcp:tools:read"]));
    const response = await mcpPost(call("delete_workflow", { id: "wf-1" }));
    expect(response.status).toBe(403);
    expect(response.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
    expect(response.headers.get("www-authenticate")).toContain('scope="mcp:workflows:write"');
    const body = await response.json();
    expect(body.error).toMatchObject({ data: { requiredScopes: ["mcp:workflows:write"] } });
    expect(mcpServerMocks.dispatchTool).not.toHaveBeenCalled();
  });

  it("treats upstream management tools as writes", async () => {
    mcpServerMocks.authenticateBearer.mockResolvedValue(oauthCaller(["mcp:tools:read"]));
    const response = await mcpPost(call("n8n_update_full_workflow"));
    expect(response.status).toBe(403);
  });

  it("lets a write-scoped client change workflows", async () => {
    mcpServerMocks.authenticateBearer.mockResolvedValue(
      oauthCaller(["mcp:tools:read", "mcp:workflows:write"]),
    );
    const response = await mcpPost(call("delete_workflow", { id: "wf-1" }));
    expect(response.status).toBe(200);
    expect(mcpServerMocks.dispatchTool).toHaveBeenCalled();
  });

  it("does not scope-check platform API keys", async () => {
    mcpServerMocks.authenticateBearer.mockResolvedValue({
      user_id: "user-1",
      key_id: "key-1",
      tier: "free",
    });
    const response = await mcpPost(call("delete_workflow", { id: "wf-1" }));
    expect(response.status).toBe(200);
    expect(mcpServerMocks.recordCall).toHaveBeenCalledWith(
      expect.objectContaining({ auth: { source: "api_key", client_id: undefined } }),
    );
  });
});
