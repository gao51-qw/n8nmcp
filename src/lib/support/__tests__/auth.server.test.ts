import { beforeEach, describe, expect, it, vi } from "vitest";

/** Shape of a Supabase session access token; getUser is mocked, so it is unsigned. */
function fakeJwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "ES256", typ: "JWT" })}.${part(claims)}.signature`;
}

const SESSION_TOKEN = fakeJwt({ sub: "user-1", role: "authenticated" });
/** Expires in an hour, so the verification may be remembered. */
const FRESH_TOKEN = fakeJwt({
  sub: "user-1",
  role: "authenticated",
  exp: Math.floor(Date.now() / 1000) + 3600,
});

const supabaseMocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: {
      getUser: supabaseMocks.getUser,
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: supabaseMocks.maybeSingle,
          })),
        })),
      })),
    })),
  },
}));

describe("support authorization", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    (await import("@/lib/support/auth.server")).resetSupportUserCache();
    supabaseMocks.getUser.mockResolvedValue({
      data: {
        user: {
          id: "user-1",
          email: "support@example.com",
        },
      },
      error: null,
    });
    supabaseMocks.maybeSingle.mockResolvedValue({
      data: { role: "admin" },
      error: null,
    });
  });

  it("rejects requests without a bearer token", async () => {
    const { requireSupportUser } = await import("@/lib/support/auth.server");

    const thrown = await requireSupportUser(new Request("https://example.test/support")).catch(
      (error: unknown) => error,
    );
    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: { code: "authentication_required", message: "Authentication required" },
    });
    expect(supabaseMocks.getUser).not.toHaveBeenCalled();
  });

  it("rejects access tokens issued to OAuth clients", async () => {
    const { requireSupportUser } = await import("@/lib/support/auth.server");
    const agentToken = fakeJwt({ sub: "user-1", client_id: "mcp-client-1" });
    const request = new Request("https://example.test/support", {
      headers: { authorization: `Bearer ${agentToken}` },
    });

    await expect(requireSupportUser(request)).rejects.toMatchObject({ status: 401 });
  });

  it("fails closed for a token that is not a JWT", async () => {
    const { requireSupportUser } = await import("@/lib/support/auth.server");
    const request = new Request("https://example.test/support", {
      headers: { authorization: "Bearer not-a-jwt" },
    });

    await expect(requireSupportUser(request)).rejects.toMatchObject({ status: 401 });
  });

  it("returns the authenticated support user", async () => {
    const { requireSupportUser } = await import("@/lib/support/auth.server");
    const request = new Request("https://example.test/support", {
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
    });

    await expect(requireSupportUser(request)).resolves.toEqual({
      userId: "user-1",
      email: "support@example.com",
    });
    expect(supabaseMocks.getUser).toHaveBeenCalledWith(SESSION_TOKEN);
  });

  it("remembers a verified token briefly instead of asking Supabase on every call", async () => {
    const { requireSupportUser } = await import("@/lib/support/auth.server");
    const request = () =>
      new Request("https://example.test/support", {
        headers: { authorization: `Bearer ${FRESH_TOKEN}` },
      });

    await expect(requireSupportUser(request())).resolves.toMatchObject({ userId: "user-1" });
    await expect(requireSupportUser(request())).resolves.toMatchObject({ userId: "user-1" });
    expect(supabaseMocks.getUser).toHaveBeenCalledTimes(1);

    // Routes acting on the sign-in itself always verify again.
    supabaseMocks.getUser.mockResolvedValueOnce({ data: { user: null }, error: { status: 401 } });
    await expect(requireSupportUser(request(), { fresh: true })).rejects.toMatchObject({
      status: 401,
    });
    expect(supabaseMocks.getUser).toHaveBeenCalledTimes(2);
  });

  it("does not remember a token without a readable expiry, nor a rejected one", async () => {
    const { requireSupportUser } = await import("@/lib/support/auth.server");
    const request = () =>
      new Request("https://example.test/support", {
        headers: { authorization: `Bearer ${SESSION_TOKEN}` },
      });

    await requireSupportUser(request());
    await requireSupportUser(request());
    expect(supabaseMocks.getUser).toHaveBeenCalledTimes(2);

    supabaseMocks.getUser.mockResolvedValue({ data: { user: null }, error: { status: 401 } });
    const rejected = new Request("https://example.test/support", {
      headers: { authorization: `Bearer ${fakeJwt({ sub: "user-2", exp: 4102444800 })}` },
    });
    await expect(requireSupportUser(rejected)).rejects.toMatchObject({ status: 401 });
    await expect(requireSupportUser(rejected)).rejects.toMatchObject({ status: 401 });
    expect(supabaseMocks.getUser).toHaveBeenCalledTimes(4);
  });

  it("rejects an empty bearer token", async () => {
    const { requireSupportUser } = await import("@/lib/support/auth.server");
    const request = new Request("https://example.test/support", {
      headers: { authorization: "Bearer " },
    });

    await expect(requireSupportUser(request)).rejects.toMatchObject({ status: 401 });
    expect(supabaseMocks.getUser).not.toHaveBeenCalled();
  });

  it("rejects authenticated users without the admin role", async () => {
    supabaseMocks.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    const { requireSupportAdmin } = await import("@/lib/support/auth.server");
    const request = new Request("https://example.test/support", {
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
    });

    const thrown = await requireSupportAdmin(request).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Response);
    const response = thrown as Response;
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: { code: "forbidden", message: "Forbidden" },
    });
  });

  it("rejects admin authorization when the role lookup fails", async () => {
    supabaseMocks.maybeSingle.mockResolvedValueOnce({
      data: null,
      error: new Error("database unavailable"),
    });
    const { requireSupportAdmin } = await import("@/lib/support/auth.server");
    const request = new Request("https://example.test/support", {
      headers: { authorization: `Bearer ${SESSION_TOKEN}` },
    });

    await expect(requireSupportAdmin(request)).rejects.toMatchObject({ status: 403 });
  });
});
