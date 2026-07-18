import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createSupportTicket: vi.fn(),
  listSupportTickets: vi.fn(),
  requireSupportUser: vi.fn(),
}));

vi.mock("@/lib/support/auth.server", () => ({
  requireSupportUser: mocks.requireSupportUser,
}));

vi.mock("@/lib/support/tickets.server", () => {
  class SupportHttpError extends Error {
    constructor(
      public readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }

  return {
    createSupportTicket: mocks.createSupportTicket,
    listSupportTickets: mocks.listSupportTickets,
    SupportHttpError,
  };
});

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(() => "sentry-event"),
}));

vi.mock("@/lib/logger.server", () => ({
  createSafeErrorDto: (message: string, requestId: string) => ({ error: message, requestId }),
  getRequestId: () => "request-route-test",
  log: { error: vi.fn() },
}));

describe("user support ticket routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupportUser.mockResolvedValue({
      userId: "10000000-0000-4000-8000-000000000001",
      email: "owner@example.test",
    });
  });

  it("requires ticketId when creating a ticket", async () => {
    const { POST } = await import("@/app/api/support/tickets/route");
    const response = await POST(
      new Request("https://example.test/api/support/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "Login failure",
          description: "Cannot sign in",
          category: "account",
          source: "ticket_form",
        }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "Invalid request",
      issues: [expect.objectContaining({ path: "ticketId" })],
    });
    expect(mocks.createSupportTicket).not.toHaveBeenCalled();
  });

  it("requires authentication before creating a ticket", async () => {
    mocks.requireSupportUser.mockRejectedValue(new Response(null, { status: 401 }));
    const { POST } = await import("@/app/api/support/tickets/route");
    const response = await POST(
      new Request("https://example.test/api/support/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "Authentication required" });
    expect(mocks.createSupportTicket).not.toHaveBeenCalled();
  });

  it.each([
    [400, "Invalid request"],
    [403, "Forbidden"],
    [404, "Not found"],
    [409, "Conflict"],
  ] as const)("maps service HTTP %s errors without exposing details", async (status, message) => {
    const { SupportHttpError } = await import("@/lib/support/tickets.server");
    mocks.createSupportTicket.mockRejectedValue(new SupportHttpError(status, "database detail"));
    const { POST } = await import("@/app/api/support/tickets/route");
    const response = await POST(
      new Request("https://example.test/api/support/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ticketId: "30000000-0000-4000-8000-000000000001",
          title: "Login failure",
          description: "Cannot sign in",
          category: "account",
          source: "ticket_form",
        }),
      }),
    );

    expect(response.status).toBe(status);
    await expect(response.json()).resolves.toMatchObject({ error: message });
  });
});
