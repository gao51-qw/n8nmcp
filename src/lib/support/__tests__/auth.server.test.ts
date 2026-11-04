import { beforeEach, describe, expect, it, vi } from "vitest";

/** Shape of a Supabase session access token; getUser is mocked, so it is unsigned. */
function fakeJwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "ES256", typ: "JWT" })}.${part(claims)}.signature`;
}

const SESSION_TOKEN = fakeJwt({ sub: "user-1", role: "authenticated" });

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
  beforeEach(() => {
    vi.clearAllMocks();
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

    await expect(
      requireSupportUser(new Request("https://example.test/support")),
    ).rejects.toMatchObject({
      status: 401,
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

    await expect(requireSupportAdmin(request)).rejects.toMatchObject({ status: 403 });
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
