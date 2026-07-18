import { beforeEach, describe, expect, it, vi } from "vitest";

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

  it("returns the authenticated support user", async () => {
    const { requireSupportUser } = await import("@/lib/support/auth.server");
    const request = new Request("https://example.test/support", {
      headers: { authorization: "Bearer valid-token" },
    });

    await expect(requireSupportUser(request)).resolves.toEqual({
      userId: "user-1",
      email: "support@example.com",
    });
    expect(supabaseMocks.getUser).toHaveBeenCalledWith("valid-token");
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
      headers: { authorization: "Bearer valid-token" },
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
      headers: { authorization: "Bearer valid-token" },
    });

    await expect(requireSupportAdmin(request)).rejects.toMatchObject({ status: 403 });
  });
});
