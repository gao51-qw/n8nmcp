import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  upsert: vi.fn(),
  update: vi.fn(),
  calls: [] as Array<[string, ...unknown[]]>,
  result: { data: null as unknown, error: null as unknown },
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "is", "order"]) {
    chain[method] = (...args: unknown[]) => {
      db.calls.push([method, ...args]);
      return chain;
    };
  }
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(db.result).then(resolve);
  return {
    supabaseAdmin: {
      from: () => ({
        ...chain,
        upsert: (...args: unknown[]) => {
          db.upsert(...args);
          return Promise.resolve(db.result);
        },
        update: (values: unknown) => {
          db.update(values);
          return chain;
        },
      }),
    },
  };
});

import {
  assertClientId,
  fetchAuthorizationDetails,
  GrantError,
  listGrants,
  parseScopes,
  recordGrant,
  revokeGrant,
} from "../grants.server";

const details = {
  authorizationId: "auth-1",
  userId: "user-1",
  client: { id: "client-1", name: "Claude" },
  redirectUri: "https://claude.ai/api/mcp/auth_callback",
};

beforeEach(() => {
  vi.clearAllMocks();
  db.calls = [];
  db.result = { data: null, error: null };
  vi.stubEnv("SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "pk");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("input validation", () => {
  it("accepts known scopes and de-duplicates them", () => {
    expect(parseScopes(["mcp:tools:read", "mcp:tools:read"])).toEqual(["mcp:tools:read"]);
  });

  it.each([[[]], [null], [["mcp:admin"]], [["mcp:tools:read", 1]]])(
    "rejects scopes %j",
    (scopes) => {
      expect(() => parseScopes(scopes)).toThrow(GrantError);
    },
  );

  it("validates client ids", () => {
    expect(assertClientId("8a7c4f2e-1d2b-4c3a-9e8f-0a1b2c3d4e5f")).toBeTruthy();
    expect(() => assertClientId("../../etc")).toThrow(GrantError);
    expect(() => assertClientId(null)).toThrow(GrantError);
  });
});

describe("fetchAuthorizationDetails", () => {
  function respond(status: number, body: unknown) {
    return vi.fn(async () => new Response(JSON.stringify(body), { status }));
  }

  it("loads the pending authorization as the signed-in user", async () => {
    const fetchImpl = respond(200, {
      authorization_id: "auth-1",
      redirect_uri: details.redirectUri,
      client: { id: "client-1", name: "Claude", uri: "", logo_uri: "" },
      user: { id: "user-1", email: "u@example.com" },
      scope: "openid",
    });
    await expect(
      fetchAuthorizationDetails("auth-1", "user-jwt", fetchImpl as typeof fetch),
    ).resolves.toEqual(details);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://proj.supabase.co/auth/v1/oauth/authorizations/auth-1");
    expect(init.headers).toMatchObject({ apikey: "pk", authorization: "Bearer user-jwt" });
  });

  it("refuses malformed authorization ids before calling Supabase", async () => {
    const fetchImpl = respond(200, {});
    await expect(
      fetchAuthorizationDetails("../admin", "jwt", fetchImpl as typeof fetch),
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("maps an unknown request to 404 and an answered one to 409", async () => {
    await expect(
      fetchAuthorizationDetails("auth-1", "jwt", respond(404, {}) as typeof fetch),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      fetchAuthorizationDetails(
        "auth-1",
        "jwt",
        respond(200, { redirect_url: "https://x" }) as typeof fetch,
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
});

describe("grant storage", () => {
  it("records the chosen scopes and clears any earlier revocation", async () => {
    await recordGrant("user-1", details, ["mcp:tools:read"]);
    expect(db.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        client_id: "client-1",
        client_name: "Claude",
        scopes: ["mcp:tools:read"],
        revoked_at: null,
      }),
      { onConflict: "user_id,client_id" },
    );
  });

  it("refuses to record an authorization that belongs to another user", async () => {
    await expect(recordGrant("user-2", details, ["mcp:tools:read"])).rejects.toMatchObject({
      status: 403,
    });
    expect(db.upsert).not.toHaveBeenCalled();
  });

  it("lists only active grants of the user and drops unknown scopes", async () => {
    db.result = {
      data: [
        {
          client_id: "c",
          client_name: "n",
          scopes: ["mcp:tools:read", "x"],
          granted_at: "t",
          last_used_at: null,
        },
      ],
      error: null,
    };
    await expect(listGrants("user-1")).resolves.toEqual([
      {
        client_id: "c",
        client_name: "n",
        scopes: ["mcp:tools:read"],
        granted_at: "t",
        last_used_at: null,
      },
    ]);
    expect(db.calls).toContainEqual(["eq", "user_id", "user-1"]);
    expect(db.calls).toContainEqual(["is", "revoked_at", null]);
  });

  it("revokes only the user's own active grant", async () => {
    await revokeGrant("user-1", "client-1");
    expect(db.update).toHaveBeenCalledWith({ revoked_at: expect.any(String) });
    expect(db.calls).toEqual(
      expect.arrayContaining([
        ["eq", "user_id", "user-1"],
        ["eq", "client_id", "client-1"],
        ["is", "revoked_at", null],
      ]),
    );
  });
});
