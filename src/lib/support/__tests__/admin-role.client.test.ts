import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eqUser: vi.fn(),
  eqRole: vi.fn(),
  maybeSingle: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: supabaseMocks.from,
  },
}));

describe("hasSupportAdminRole", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMocks.from.mockReturnValue({ select: supabaseMocks.select });
    supabaseMocks.select.mockReturnValue({ eq: supabaseMocks.eqUser });
    supabaseMocks.eqUser.mockReturnValue({ eq: supabaseMocks.eqRole });
    supabaseMocks.eqRole.mockReturnValue({ maybeSingle: supabaseMocks.maybeSingle });
  });

  it("queries the caller's own admin row through row-level security", async () => {
    supabaseMocks.maybeSingle.mockResolvedValue({ data: { role: "admin" }, error: null });
    const { hasSupportAdminRole } = await import("@/lib/support/admin-role.client");

    await expect(hasSupportAdminRole("user-1")).resolves.toBe(true);

    expect(supabaseMocks.from).toHaveBeenCalledWith("user_roles");
    expect(supabaseMocks.select).toHaveBeenCalledWith("role");
    expect(supabaseMocks.eqUser).toHaveBeenCalledWith("user_id", "user-1");
    expect(supabaseMocks.eqRole).toHaveBeenCalledWith("role", "admin");
  });

  it("returns false when no admin row exists", async () => {
    supabaseMocks.maybeSingle.mockResolvedValue({ data: null, error: null });
    const { hasSupportAdminRole } = await import("@/lib/support/admin-role.client");

    await expect(hasSupportAdminRole("user-2")).resolves.toBe(false);
  });

  it("fails closed on query errors", async () => {
    supabaseMocks.maybeSingle.mockResolvedValue({
      data: { role: "admin" },
      error: { message: "permission denied" },
    });
    const { hasSupportAdminRole } = await import("@/lib/support/admin-role.client");

    await expect(hasSupportAdminRole("user-3")).resolves.toBe(false);
  });
});
