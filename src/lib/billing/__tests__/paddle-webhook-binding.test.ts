import { createHmac } from "node:crypto";
import { EventName } from "@paddle/paddle-node-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "8b0f7a0e-3f1c-4a59-9d64-2f0f3c6c1a11";
const VICTIM = "1d2c3b4a-5f6e-4a7b-8c9d-0e1f2a3b4c5d";
const ATTACKER = "9a8b7c6d-5e4f-4a3b-9c1d-0e9f8a7b6c5d";
const SECRET = "binding-secret-0123456789abcdefghijklmnopqrstuvwxyz";
const CREATED_AT = "2026-11-06T12:00:00.000Z";
const CREATED_MS = Date.parse(CREATED_AT);

type Row = Record<string, unknown> & { user_id: string };
type Filter = [column: string, value: unknown];

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown> & { user_id: string }>,
  writes: [] as Array<{ kind: "update" | "upsert"; payload: Record<string, unknown> }>,
  unmarshal: vi.fn(),
  subscriptionsGet: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

function matches(row: Row, filters: Filter[]) {
  return filters.every(([column, value]) => row[column] === value);
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const filters: Filter[] = [];
      let pendingUpdate: Record<string, unknown> | null = null;
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn((column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        }),
        limit: vi.fn(async (count: number) => ({
          data: mocks.rows
            .filter((row) => matches(row, filters))
            .slice(0, count)
            .map((row) => ({ user_id: row.user_id })),
          error: null,
        })),
        update: vi.fn((payload: Record<string, unknown>) => {
          pendingUpdate = payload;
          return builder;
        }),
        upsert: vi.fn(async (payload: Row) => {
          mocks.writes.push({ kind: "upsert", payload });
          const index = mocks.rows.findIndex((row) => row.user_id === payload.user_id);
          if (index >= 0) mocks.rows[index] = { ...mocks.rows[index], ...payload };
          else mocks.rows.push({ ...payload });
          return { error: null };
        }),
        then: (resolve: (value: { error: null }) => void) => {
          if (pendingUpdate) {
            const payload = pendingUpdate;
            mocks.writes.push({ kind: "update", payload });
            mocks.rows = mocks.rows.map((row) =>
              matches(row, filters) ? { ...row, ...payload } : row,
            );
          }
          resolve({ error: null });
        },
      };
      return builder;
    }),
  },
}));

vi.mock("@/lib/logger.server", () => ({
  log: { warn: mocks.warn, error: mocks.error, info: mocks.info, debug: vi.fn() },
}));

vi.mock("@/lib/paddle.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paddle.server")>();
  return {
    ...actual,
    getPaddle: () => ({
      webhooks: { unmarshal: mocks.unmarshal },
      subscriptions: { get: mocks.subscriptionsGet },
    }),
  };
});

import { POST } from "@/app/api/public/paddle-webhook/route";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  CHECKOUT_BINDING_MAX_AGE_MS,
  signCheckoutBinding,
  verifyCheckoutBinding,
} from "@/lib/billing/checkout-binding.server";

function sign(userId: string, issuedAtMs: number, secret = SECRET) {
  const ts = Math.floor(issuedAtMs / 1000);
  const sig = createHmac("sha256", secret).update(`v1:${userId}:${ts}`).digest("base64url");
  return { user_id: userId, ts, sig };
}

function subscription(overrides: Record<string, unknown> = {}) {
  return {
    id: "sub_1",
    status: "active",
    customerId: "ctm_1",
    createdAt: CREATED_AT,
    currentBillingPeriod: { endsAt: "2026-12-06T12:00:00.000Z" },
    items: [{ price: { id: "pri_01pro" } }],
    customData: null,
    ...overrides,
  };
}

async function deliver(eventType: string, data: unknown) {
  mocks.unmarshal.mockResolvedValue({ eventType, occurredAt: CREATED_AT, data });
  return POST(
    new Request("https://dashboard.example.test/api/public/paddle-webhook", {
      method: "POST",
      headers: { "paddle-signature": "ts=1;h1=abc" },
      body: JSON.stringify({ event_type: eventType }),
    }),
  );
}

function rowFor(userId: string) {
  return mocks.rows.find((row) => row.user_id === userId);
}

function warned(event: string) {
  return mocks.warn.mock.calls.filter(([name]) => name === event).map(([, fields]) => fields);
}

beforeEach(() => {
  mocks.rows = [];
  mocks.writes = [];
  mocks.unmarshal.mockReset();
  mocks.subscriptionsGet.mockReset();
  mocks.warn.mockReset();
  mocks.error.mockReset();
  mocks.info.mockReset();
  vi.mocked(supabaseAdmin.from).mockClear();
  vi.stubEnv("PADDLE_ENV", "sandbox");
  vi.stubEnv("PADDLE_API_KEY", "pdl_sdbx_apikey_secret_value");
  vi.stubEnv("PADDLE_WEBHOOK_SECRET", "pdl_ntfset_webhook_secret_value");
  vi.stubEnv("PADDLE_PRICE_PRO", "pri_01pro");
  vi.stubEnv("BILLING_CUSTOM_DATA_SECRET", SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Paddle-Signature verification", () => {
  it("rejects a missing signature header before touching the database", async () => {
    const response = await POST(
      new Request("https://dashboard.example.test/api/public/paddle-webhook", {
        method: "POST",
        body: "{}",
      }),
    );
    expect(response.status).toBe(400);
    expect(mocks.unmarshal).not.toHaveBeenCalled();
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("rejects an invalid signature before any binding logic runs", async () => {
    mocks.unmarshal.mockRejectedValue(new Error("signature mismatch"));
    const response = await POST(
      new Request("https://dashboard.example.test/api/public/paddle-webhook", {
        method: "POST",
        headers: { "paddle-signature": "ts=1;h1=forged" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.unmarshal).toHaveBeenCalledWith(
      "{}",
      "pdl_ntfset_webhook_secret_value",
      "ts=1;h1=forged",
    );
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});

describe("subscription.created binding", () => {
  it("binds the subscription to the user named by a valid signature", async () => {
    const response = await deliver(
      EventName.SubscriptionCreated,
      subscription({ customData: sign(OWNER, CREATED_MS - 60_000) }),
    );

    expect(response.status).toBe(200);
    expect(rowFor(OWNER)).toMatchObject({
      user_id: OWNER,
      tier: "pro",
      status: "active",
      billing_provider: "paddle",
      billing_customer_id: "ctm_1",
      billing_subscription_id: "sub_1",
      current_period_end: "2026-12-06T12:00:00.000Z",
    });
  });

  it("accepts a binding issued just under the 24h maximum age", async () => {
    await deliver(
      EventName.SubscriptionCreated,
      subscription({ customData: sign(OWNER, CREATED_MS - CHECKOUT_BINDING_MAX_AGE_MS + 1000) }),
    );
    expect(rowFor(OWNER)?.billing_subscription_id).toBe("sub_1");
  });

  it.each([
    ["forged with another secret", () => sign(VICTIM, CREATED_MS, "x".repeat(48)), "bad_signature"],
    [
      "re-targeted to another user",
      () => ({ ...sign(ATTACKER, CREATED_MS), user_id: VICTIM }),
      "bad_signature",
    ],
    [
      "with a shifted timestamp",
      () => ({ ...sign(VICTIM, CREATED_MS - 2 * CHECKOUT_BINDING_MAX_AGE_MS), ts: 1 }),
      "bad_signature",
    ],
    ["unsigned (bare user_id)", () => ({ user_id: VICTIM }), "missing"],
    ["missing entirely", () => null, "missing"],
    ["with a malformed sig", () => ({ ...sign(VICTIM, CREATED_MS), sig: "abc" }), "malformed"],
    ["expired", () => sign(VICTIM, CREATED_MS - CHECKOUT_BINDING_MAX_AGE_MS - 1000), "expired"],
    [
      "issued after the subscription",
      () => sign(VICTIM, CREATED_MS + 3_600_000),
      "issued_in_future",
    ],
  ])("does not bind customData %s", async (_label, customData, reason) => {
    mocks.rows = [
      {
        user_id: VICTIM,
        tier: "pro",
        status: "active",
        billing_provider: "paddle",
        billing_subscription_id: "sub_victim",
      },
    ];
    const before = structuredClone(mocks.rows);

    const response = await deliver(
      EventName.SubscriptionCreated,
      subscription({ id: "sub_attacker", status: "canceled", customData: customData() }),
    );

    expect(response.status).toBe(200);
    expect(mocks.writes).toEqual([]);
    expect(mocks.rows).toEqual(before);
    expect(warned("paddle.webhook.binding_rejected")).toEqual([
      expect.objectContaining({ subscription_id: "sub_attacker", reason }),
    ]);
  });

  it("does not bind when the binding secret is unset", async () => {
    vi.stubEnv("BILLING_CUSTOM_DATA_SECRET", "");
    await deliver(
      EventName.SubscriptionCreated,
      subscription({ customData: sign(OWNER, CREATED_MS) }),
    );
    expect(mocks.writes).toEqual([]);
    expect(warned("paddle.webhook.binding_rejected")).toEqual([
      expect.objectContaining({ reason: "secret_unset" }),
    ]);
  });

  it("keeps an existing binding when a created event is replayed for another user", async () => {
    mocks.rows = [
      {
        user_id: OWNER,
        tier: "pro",
        status: "active",
        billing_provider: "paddle",
        billing_subscription_id: "sub_1",
      },
    ];
    await deliver(
      EventName.SubscriptionCreated,
      subscription({ customData: sign(ATTACKER, CREATED_MS) }),
    );

    expect(rowFor(ATTACKER)).toBeUndefined();
    expect(rowFor(OWNER)?.billing_subscription_id).toBe("sub_1");
    expect(mocks.writes.every((write) => write.kind === "update")).toBe(true);
    expect(warned("paddle.webhook.custom_data_mismatch")).toHaveLength(1);
  });
});

describe("later events use the stored binding", () => {
  beforeEach(() => {
    mocks.rows = [
      {
        user_id: OWNER,
        tier: "pro",
        status: "active",
        billing_provider: "paddle",
        billing_customer_id: "ctm_1",
        billing_subscription_id: "sub_1",
      },
      {
        user_id: VICTIM,
        tier: "pro",
        status: "active",
        billing_provider: "paddle",
        billing_customer_id: "ctm_v",
        billing_subscription_id: "sub_victim",
      },
    ];
  });

  it.each([EventName.SubscriptionUpdated, EventName.SubscriptionCanceled])(
    "%s updates the stored owner even when customData names another user",
    async (eventType) => {
      await deliver(
        eventType,
        subscription({ status: "canceled", customData: sign(VICTIM, CREATED_MS) }),
      );

      expect(rowFor(OWNER)).toMatchObject({ tier: "free", status: "canceled" });
      expect(rowFor(VICTIM)).toMatchObject({ tier: "pro", status: "active" });
      expect(rowFor(VICTIM)?.billing_subscription_id).toBe("sub_victim");
      for (const write of mocks.writes) {
        expect(write.payload).not.toHaveProperty("user_id");
        expect(write.payload).not.toHaveProperty("billing_subscription_id");
      }
      expect(warned("paddle.webhook.custom_data_mismatch")).toEqual([
        expect.objectContaining({ user_id: OWNER, claimed_user_id: VICTIM }),
      ]);
    },
  );

  it("never creates a binding from an update for an unknown subscription", async () => {
    await deliver(
      EventName.SubscriptionCanceled,
      subscription({ id: "sub_unknown", status: "canceled", customData: sign(VICTIM, CREATED_MS) }),
    );
    expect(mocks.writes).toEqual([]);
    expect(rowFor(VICTIM)).toMatchObject({ tier: "pro", status: "active" });
    expect(warned("paddle.webhook.subscription_unbound")).toHaveLength(1);
  });

  it("keeps a legacy subscription without a signature working", async () => {
    mocks.rows[0] = { ...mocks.rows[0], billing_subscription_id: "sub_legacy" };
    await deliver(
      EventName.SubscriptionUpdated,
      subscription({ id: "sub_legacy", status: "past_due", customData: { user_id: OWNER } }),
    );
    expect(rowFor(OWNER)).toMatchObject({
      tier: "pro",
      status: "past_due",
      billing_subscription_id: "sub_legacy",
    });
    expect(warned("paddle.webhook.custom_data_mismatch")).toEqual([]);
  });

  it("transaction.completed resolves the user through the stored binding", async () => {
    mocks.subscriptionsGet.mockResolvedValue(
      subscription({ status: "active", customData: { user_id: VICTIM } }),
    );
    await deliver(EventName.TransactionCompleted, { id: "txn_1", subscriptionId: "sub_1" });

    expect(mocks.subscriptionsGet).toHaveBeenCalledWith("sub_1");
    expect(rowFor(OWNER)).toMatchObject({ tier: "pro", status: "active" });
    expect(rowFor(VICTIM)?.billing_subscription_id).toBe("sub_victim");
  });

  it("transaction.completed never binds an unknown subscription, even with a valid signature", async () => {
    mocks.subscriptionsGet.mockResolvedValue(
      subscription({ id: "sub_new", customData: sign(ATTACKER, CREATED_MS) }),
    );
    await deliver(EventName.TransactionCompleted, { id: "txn_2", subscriptionId: "sub_new" });

    expect(mocks.writes).toEqual([]);
    expect(rowFor(ATTACKER)).toBeUndefined();
  });

  it("transaction.payment_failed marks only the stored binding past_due", async () => {
    await deliver(EventName.TransactionPaymentFailed, { id: "txn_3", subscriptionId: "sub_1" });
    expect(rowFor(OWNER)?.status).toBe("past_due");
    expect(rowFor(VICTIM)?.status).toBe("active");
  });

  it("refuses to write when two rows claim the same subscription", async () => {
    mocks.rows[1] = { ...mocks.rows[1], billing_subscription_id: "sub_1" };
    const before = structuredClone(mocks.rows);
    await deliver(EventName.SubscriptionCanceled, subscription({ status: "canceled" }));
    expect(mocks.writes).toEqual([]);
    expect(mocks.rows).toEqual(before);
    expect(mocks.error).toHaveBeenCalledWith(
      "paddle.webhook.binding_ambiguous",
      expect.objectContaining({ subscription_id: "sub_1" }),
    );
  });
});

describe("checkout binding signatures", () => {
  it("signs v1:<user_id>:<ts> with HMAC-SHA256 in base64url", () => {
    const binding = signCheckoutBinding(OWNER, CREATED_MS);
    expect(binding).toEqual(sign(OWNER, CREATED_MS));
    expect(binding?.sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(binding)).not.toContain(SECRET);
  });

  it("does not sign without a dedicated, long enough secret", () => {
    vi.stubEnv("BILLING_CUSTOM_DATA_SECRET", "");
    expect(signCheckoutBinding(OWNER)).toBeNull();
    vi.stubEnv("BILLING_CUSTOM_DATA_SECRET", "short");
    expect(signCheckoutBinding(OWNER)).toBeNull();
    vi.stubEnv("BILLING_CUSTOM_DATA_SECRET", "pdl_ntfset_webhook_secret_value");
    expect(signCheckoutBinding(OWNER)).toBeNull();
  });

  it("rejects a non-UUID user id and non-object customData", () => {
    expect(signCheckoutBinding("not-a-uuid")).toBeNull();
    expect(verifyCheckoutBinding("user_id", CREATED_MS)).toMatchObject({ ok: false });
    expect(
      verifyCheckoutBinding({ ...sign(OWNER, CREATED_MS), ts: 1.5 }, CREATED_MS),
    ).toMatchObject({ ok: false, reason: "malformed" });
  });
});
