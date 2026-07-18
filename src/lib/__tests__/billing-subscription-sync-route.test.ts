import { beforeEach, describe, expect, it, vi } from "vitest";

const syncMock = vi.fn();

vi.mock("@/lib/billing/subscription-sync.server", () => ({
  syncPaddleSubscriptions: syncMock,
}));

vi.mock("@/lib/logger.server", () => ({
  getRequestId: (request: Request) => request.headers.get("x-request-id") ?? "generated-request",
  log: {
    error: vi.fn(),
  },
}));

describe("billing subscription sync cron route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    process.env.BILLING_CRON_SECRET = "billing-secret";
  });

  it.each([undefined, "Bearer wrong", "Basic billing-secret"])(
    "rejects invalid cron authorization",
    async (authorization) => {
      const { POST } = await import("@/app/api/internal/billing/sync-subscriptions/route");
      const response = await POST(
        new Request("https://example.test/api/internal/billing/sync-subscriptions", {
          method: "POST",
          headers: authorization ? { authorization } : undefined,
        }),
      );

      expect(response.status).toBe(401);
      expect(syncMock).not.toHaveBeenCalled();
    },
  );

  it("runs the bounded subscription sync for an authorized cron request", async () => {
    syncMock.mockResolvedValue({ scanned: 2, synced: 1, failed: 1 });
    const { POST } = await import("@/app/api/internal/billing/sync-subscriptions/route");

    const response = await POST(
      new Request("https://example.test/api/internal/billing/sync-subscriptions", {
        method: "POST",
        headers: {
          authorization: "Bearer billing-secret",
          "x-request-id": "request-1",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("request-1");
    expect(syncMock).toHaveBeenCalledWith({ limit: 50 });
    expect(await response.json()).toEqual({
      subscriptionSync: { scanned: 2, synced: 1, failed: 1 },
    });
  });
});
