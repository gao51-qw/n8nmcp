import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  key: null as unknown,
  subscription: null as unknown,
  touched: vi.fn(),
}));

const verifyMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: (table: string) => {
      const chain: Record<string, unknown> = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: table === "platform_api_keys" ? db.key : db.subscription,
          error: null,
        }),
        update: () => ({
          eq: () => ({
            then: (resolve?: (value: unknown) => unknown) => {
              db.touched(table);
              return Promise.resolve({ error: null }).then(resolve);
            },
          }),
        }),
      };
      return chain;
    },
  },
}));

vi.mock("../oauth/verify.server", () => ({ verifyOAuthAccessToken: verifyMock }));
vi.mock("../mcp-upstream.server", () => ({
  callUpstreamTool: vi.fn(),
  categorize: vi.fn(),
  isManagementTool: vi.fn(() => false),
  isUpstreamConfigured: vi.fn(() => false),
  listUpstreamTools: vi.fn(async () => []),
}));

import { authenticateBearer } from "../mcp.server";
import { MCP_SCOPES } from "../oauth/scopes";

function request(authorization?: string) {
  return new Request("https://mcp.example.com/mcp", {
    method: "POST",
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  db.key = { id: "key-1", user_id: "user-1", revoked_at: null };
  db.subscription = { tier: "pro", status: "active" };
  verifyMock.mockResolvedValue(null);
});

describe("authenticateBearer", () => {
  it("authenticates a platform API key with every scope", async () => {
    await expect(authenticateBearer(request("Bearer nmcp_abc123"))).resolves.toEqual({
      user_id: "user-1",
      key_id: "key-1",
      tier: "pro",
      auth_source: "api_key",
      scopes: MCP_SCOPES,
    });
    expect(verifyMock).not.toHaveBeenCalled();
  });

  it("actually sends the last_used_at update for platform keys", async () => {
    await authenticateBearer(request("Bearer nmcp_abc123"));
    expect(db.touched).toHaveBeenCalledWith("platform_api_keys");
  });

  it("rejects revoked keys and missing headers", async () => {
    db.key = { id: "key-1", user_id: "user-1", revoked_at: "2026-01-01" };
    await expect(authenticateBearer(request("Bearer nmcp_abc123"))).resolves.toBeNull();
    await expect(authenticateBearer(request())).resolves.toBeNull();
  });

  it("authenticates an OAuth access token through its grant", async () => {
    verifyMock.mockResolvedValue({
      userId: "user-2",
      clientId: "client-1",
      clientName: "Claude",
      scopes: ["mcp:tools:read"],
    });
    await expect(authenticateBearer(request("Bearer a.b.c"))).resolves.toEqual({
      user_id: "user-2",
      key_id: "oauth:client-1",
      tier: "pro",
      auth_source: "oauth",
      client_id: "client-1",
      scopes: ["mcp:tools:read"],
    });
  });

  it("rejects a bearer that is neither a key nor a valid OAuth token", async () => {
    await expect(authenticateBearer(request("Bearer a.b.c"))).resolves.toBeNull();
    await expect(authenticateBearer(request("Bearer nmcp_bad key"))).resolves.toBeNull();
  });

  it("downgrades a lapsed subscription to the free tier", async () => {
    db.subscription = { tier: "pro", status: "past_due" };
    await expect(authenticateBearer(request("Bearer nmcp_abc123"))).resolves.toMatchObject({
      tier: "free",
    });
  });
});
