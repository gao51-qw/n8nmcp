import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSupportAvailability: vi.fn(),
  requireSupportUser: vi.fn(),
}));

vi.mock("@/lib/support/auth.server", () => ({
  requireSupportUser: mocks.requireSupportUser,
}));

vi.mock("@/lib/support/availability.server", () => ({
  getSupportAvailability: mocks.getSupportAvailability,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(() => "sentry-event"),
}));

vi.mock("@/lib/logger.server", () => ({
  createSafeErrorDto: (message: string, requestId: string) => ({ error: message, requestId }),
  getRequestId: () => "availability-request",
  log: { error: vi.fn() },
}));

describe("support availability route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupportUser.mockResolvedValue({
      userId: "10000000-0000-4000-8000-000000000001",
      email: "owner@example.test",
    });
  });

  it("requires authentication and returns only aggregate availability", async () => {
    mocks.getSupportAvailability.mockResolvedValue({ online: true, count: 3 });
    const { GET } = await import("@/app/api/support/availability/route");

    const response = await GET(new Request("https://example.test/api/support/availability"));

    expect(mocks.requireSupportUser).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toEqual({ online: true, count: 3 });
  });

  it("does not query availability for an unauthenticated request", async () => {
    mocks.requireSupportUser.mockRejectedValue(new Response(null, { status: 401 }));
    const { GET } = await import("@/app/api/support/availability/route");

    const response = await GET(new Request("https://example.test/api/support/availability"));

    expect(response.status).toBe(401);
    expect(mocks.getSupportAvailability).not.toHaveBeenCalled();
  });
});
