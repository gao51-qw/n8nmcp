import { beforeEach, describe, expect, it, vi } from "vitest";

const selectLimitMock = vi.fn();
const selectInMock = vi.fn();
const selectNotMock = vi.fn();
const selectEqMock = vi.fn();
const selectMock = vi.fn();

const updateEqMock = vi.fn();
const updateMock = vi.fn();
const fromMock = vi.fn();
const paddleGetMock = vi.fn();
const logWarnMock = vi.fn();

const selectBuilder = {
  select: selectMock,
  eq: selectEqMock,
  not: selectNotMock,
  in: selectInMock,
  limit: selectLimitMock,
};

const updateBuilder = {
  update: updateMock,
  eq: updateEqMock,
};

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: fromMock,
  },
}));

vi.mock("@/lib/paddle.server", () => ({
  getPaddle: () => ({
    subscriptions: {
      get: paddleGetMock,
    },
  }),
  isPaddleConfigured: () => true,
  tierFromPriceId: (priceId: string | null | undefined) =>
    priceId === "price_enterprise" ? "enterprise" : priceId === "price_pro" ? "pro" : "free",
}));

vi.mock("@/lib/logger.server", () => ({
  log: {
    info: vi.fn(),
    warn: logWarnMock,
    error: vi.fn(),
  },
}));

describe("billing subscription sync", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    selectMock.mockReturnValue(selectBuilder);
    selectEqMock.mockReturnValue(selectBuilder);
    selectNotMock.mockReturnValue(selectBuilder);
    selectInMock.mockReturnValue(selectBuilder);
    updateMock.mockReturnValue(updateBuilder);
    updateEqMock.mockResolvedValue({ error: null });

    fromMock.mockImplementation(() => {
      if (fromMock.mock.calls.length === 1) return selectBuilder;
      return updateBuilder;
    });
  });

  it("downgrades a stale active local subscription when Paddle reports canceled", async () => {
    selectLimitMock.mockResolvedValue({
      error: null,
      data: [
        {
          user_id: "user-1",
          tier: "pro",
          status: "active",
          billing_subscription_id: "sub_1",
        },
      ],
    });
    paddleGetMock.mockResolvedValue({
      id: "sub_1",
      status: "canceled",
      customerId: "ctm_1",
      currentBillingPeriod: { endsAt: "2026-07-31T00:00:00Z" },
      items: [{ price: { id: "price_pro" } }],
    });

    const { syncPaddleSubscriptions } = await import("@/lib/billing/subscription-sync.server");
    const result = await syncPaddleSubscriptions({ limit: 25 });

    expect(selectMock).toHaveBeenCalledWith(
      "user_id,tier,status,billing_subscription_id,billing_customer_id,current_period_end",
    );
    expect(selectEqMock).toHaveBeenCalledWith("billing_provider", "paddle");
    expect(selectNotMock).toHaveBeenCalledWith("billing_subscription_id", "is", null);
    expect(selectInMock).toHaveBeenCalledWith("status", ["active", "trialing", "past_due"]);
    expect(selectLimitMock).toHaveBeenCalledWith(25);
    expect(paddleGetMock).toHaveBeenCalledWith("sub_1");
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "free",
        status: "canceled",
        billing_customer_id: "ctm_1",
        current_period_end: "2026-07-31T00:00:00.000Z",
      }),
    );
    expect(updateEqMock).toHaveBeenCalledWith("billing_subscription_id", "sub_1");
    expect(result).toEqual({ scanned: 1, synced: 1, failed: 0 });
  });

  it("continues syncing later rows when one Paddle lookup fails", async () => {
    selectLimitMock.mockResolvedValue({
      error: null,
      data: [
        { user_id: "user-1", status: "active", tier: "pro", billing_subscription_id: "sub_bad" },
        { user_id: "user-2", status: "active", tier: "pro", billing_subscription_id: "sub_ok" },
      ],
    });
    paddleGetMock.mockRejectedValueOnce(new Error("Paddle timeout")).mockResolvedValueOnce({
      id: "sub_ok",
      status: "past_due",
      customerId: "ctm_2",
      items: [{ price: { id: "price_pro" } }],
    });

    const { syncPaddleSubscriptions } = await import("@/lib/billing/subscription-sync.server");
    const result = await syncPaddleSubscriptions();

    expect(updateMock).toHaveBeenCalledTimes(1);
    expect(updateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "pro",
        status: "past_due",
      }),
    );
    expect(logWarnMock).toHaveBeenCalledWith(
      "billing.subscription_sync.lookup_failed",
      expect.objectContaining({ subscriptionId: "sub_bad", errorType: "Error" }),
    );
    expect(result).toEqual({ scanned: 2, synced: 1, failed: 1 });
  });
});
