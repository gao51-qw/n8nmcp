import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: mocks.from,
  },
}));

function presenceQuery(count: number | null, error: unknown = null) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    gte: vi.fn(),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  builder.gte.mockResolvedValue({ count, error });
  return builder;
}

describe("support availability service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only aggregate online state and count from the service-role query", async () => {
    const query = presenceQuery(2);
    mocks.from.mockReturnValue(query);
    const { getSupportAvailability } = await import("../availability.server");

    const result = await getSupportAvailability();

    expect(mocks.from).toHaveBeenCalledWith("support_agent_presence");
    expect(query.select).toHaveBeenCalledWith("agent_id", {
      count: "exact",
      head: true,
    });
    expect(result).toEqual({ online: true, count: 2 });
    expect(result).not.toHaveProperty("agents");
  });
});
