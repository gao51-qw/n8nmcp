import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  key: null as unknown,
  subscription: null as unknown,
  touched: vi.fn(),
  rpc: vi.fn(),
  /** When set, authenticate_mcp_platform_key fails with this error. */
  rpcError: null as null | { code?: string; message: string },
}));

const verifyMock = vi.hoisted(() => vi.fn());

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    // authenticate_mcp_platform_key, emulated over the same fixtures.
    rpc: async (name: string, args: { _key_hash: string }) => {
      db.rpc(name, args);
      if (db.rpcError) return { data: null, error: db.rpcError };
      const key = db.key as { id: string; user_id: string; revoked_at: string | null } | null;
      if (!key || key.revoked_at) return { data: [], error: null };
      const sub = db.subscription as { tier: string; status: string } | null;
      return {
        data: [
          {
            key_id: key.id,
            user_id: key.user_id,
            tier: sub?.tier ?? null,
            status: sub?.status ?? null,
          },
        ],
        error: null,
      };
    },
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
  db.rpcError = null;
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

  it("resolves a platform key and its tier in one database call", async () => {
    await authenticateBearer(request("Bearer nmcp_abc123"));
    expect(db.rpc).toHaveBeenCalledExactlyOnceWith("authenticate_mcp_platform_key", {
      _key_hash: expect.any(String),
    });
    // last_used_at is touched by the function itself, not by a second request.
    expect(db.touched).not.toHaveBeenCalled();
  });

  it("treats a missing subscription row as the free tier", async () => {
    db.subscription = null;
    await expect(authenticateBearer(request("Bearer nmcp_abc123"))).resolves.toMatchObject({
      tier: "free",
    });
  });

  it("rejects the key when the lookup fails", async () => {
    db.rpcError = { code: "57014", message: "canceling statement due to statement timeout" };
    await expect(authenticateBearer(request("Bearer nmcp_abc123"))).resolves.toBeNull();
    expect(db.touched).not.toHaveBeenCalled();
  });

  describe("before the authenticate_mcp_platform_key migration is applied", () => {
    beforeEach(() => {
      db.rpcError = { code: "PGRST202", message: "Could not find the function" };
    });

    it("falls back to the key + subscription queries", async () => {
      await expect(authenticateBearer(request("Bearer nmcp_abc123"))).resolves.toMatchObject({
        user_id: "user-1",
        key_id: "key-1",
        tier: "pro",
      });
    });

    it("actually sends the last_used_at update for platform keys", async () => {
      await authenticateBearer(request("Bearer nmcp_abc123"));
      expect(db.touched).toHaveBeenCalledWith("platform_api_keys");
    });

    it("rejects revoked keys", async () => {
      db.key = { id: "key-1", user_id: "user-1", revoked_at: "2026-01-01" };
      await expect(authenticateBearer(request("Bearer nmcp_abc123"))).resolves.toBeNull();
    });
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
