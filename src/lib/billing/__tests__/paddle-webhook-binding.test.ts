import { createHmac } from "node:crypto";
import { EventName } from "@paddle/paddle-node-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "8b0f7a0e-3f1c-4a59-9d64-2f0f3c6c1a11";
const VICTIM = "1d2c3b4a-5f6e-4a7b-8c9d-0e1f2a3b4c5d";
const ATTACKER = "9a8b7c6d-5e4f-4a3b-9c1d-0e9f8a7b6c5d";
const SECRET = "binding-secret-0123456789abcdefghijklmnopqrstuvwxyz";
const CREATED_AT = "2026-11-06T12:00:00.000Z";
const CREATED_MS = Date.parse(CREATED_AT);
const NONCE_A = "nonceAAAAAAAAAAAAAAAAA";
const NONCE_B = "nonceBBBBBBBBBBBBBBBBB";

type Row = Record<string, unknown> & { user_id: string };
type Filter = [column: string, value: unknown];

const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown> & { user_id: string }>,
  nonces: [] as Array<{ nonce: string; user_id: string; subscription_id: string }>,
  writes: [] as Array<{ kind: "update" | "bind"; payload: Record<string, unknown> }>,
  rpc: vi.fn(),
  unmarshal: vi.fn(),
  subscriptionsGet: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

function matches(row: Row, filters: Filter[]) {
  return filters.every(([column, value]) => row[column] === value);
}

/** Mirrors the PostgREST `or` guard built by the webhook. */
function orGuard(expression: string): (row: Row) => boolean {
  const match = /^billing_last_event_at\.is\.null,billing_last_event_at\.lte\.(.+)$/.exec(
    expression,
  );
  if (!match) throw new Error(`unexpected or() filter: ${expression}`);
  const limit = Date.parse(match[1]);
  return (row) =>
    row.billing_last_event_at == null || Date.parse(String(row.billing_last_event_at)) <= limit;
}

/** In-memory model of public.bind_paddle_subscription(). */
function bindPaddleSubscription(args: Record<string, unknown>): string {
  const userId = String(args._user_id);
  const subscriptionId = String(args._subscription_id);
  const eventAt = String(args._event_at);
  const row = mocks.rows.find((candidate) => candidate.user_id === userId);
  const alreadyBound =
    row?.billing_provider === "paddle" && row.billing_subscription_id === subscriptionId;
  if (
    mocks.rows.some(
      (candidate) =>
        candidate.billing_provider === "paddle" &&
        candidate.billing_subscription_id === subscriptionId &&
        candidate.user_id !== userId,
    )
  ) {
    return "subscription_bound_elsewhere";
  }
  const existing = mocks.nonces.find((nonce) => nonce.nonce === args._nonce);
  if (existing) {
    if (existing.subscription_id !== subscriptionId || existing.user_id !== userId) {
      return "nonce_reused";
    }
    if (!alreadyBound) return "binding_superseded";
  } else {
    mocks.nonces.push({
      nonce: String(args._nonce),
      user_id: userId,
      subscription_id: subscriptionId,
    });
  }
  if (
    alreadyBound &&
    row?.billing_last_event_at != null &&
    Date.parse(String(row.billing_last_event_at)) > Date.parse(eventAt)
  ) {
    return "stale";
  }
  const payload = {
    user_id: userId,
    tier: args._tier,
    status: args._status,
    billing_provider: "paddle",
    billing_customer_id: args._customer_id ?? null,
    billing_subscription_id: subscriptionId,
    current_period_end: args._current_period_end ?? null,
    billing_last_event_at: eventAt,
  };
  mocks.writes.push({ kind: "bind", payload });
  if (row) Object.assign(row, payload);
  else mocks.rows.push({ ...payload });
  return alreadyBound ? "updated" : "bound";
}

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: mocks.rpc,
    from: vi.fn(() => {
      const filters: Filter[] = [];
      let guard: ((row: Row) => boolean) | null = null;
      let pendingUpdate: Record<string, unknown> | null = null;
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn((column: string, value: unknown) => {
          filters.push([column, value]);
          return builder;
        }),
        or: vi.fn((expression: string) => {
          guard = orGuard(expression);
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
        then: (resolve: (value: { data: Array<{ user_id: string }>; error: null }) => void) => {
          const updated: Array<{ user_id: string }> = [];
          if (pendingUpdate) {
            const payload = pendingUpdate;
            mocks.rows = mocks.rows.map((row) => {
              if (!matches(row, filters) || (guard && !guard(row))) return row;
              updated.push({ user_id: row.user_id });
              return { ...row, ...payload };
            });
            if (updated.length > 0) mocks.writes.push({ kind: "update", payload });
          }
          resolve({ data: updated, error: null });
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

function sign(userId: string, issuedAtMs: number, nonce = NONCE_A, secret = SECRET) {
  const ts = Math.floor(issuedAtMs / 1000);
  const sig = createHmac("sha256", secret)
    .update(`v2:${userId}:${ts}:${nonce}`)
    .digest("base64url");
  return { user_id: userId, ts, nonce, sig };
}

function signV1(userId: string, issuedAtMs: number) {
  const ts = Math.floor(issuedAtMs / 1000);
  const sig = createHmac("sha256", SECRET).update(`v1:${userId}:${ts}`).digest("base64url");
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

async function deliver(eventType: string, data: unknown, occurredAt: string | null = CREATED_AT) {
  mocks.unmarshal.mockResolvedValue({ eventType, occurredAt: occurredAt ?? undefined, data });
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

function informed(event: string) {
  return mocks.info.mock.calls.filter(([name]) => name === event).map(([, fields]) => fields);
}

beforeEach(() => {
  mocks.rows = [];
  mocks.nonces = [];
  mocks.writes = [];
  mocks.rpc.mockReset();
  mocks.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name !== "bind_paddle_subscription") throw new Error(`unexpected rpc ${name}`);
    return { data: bindPaddleSubscription(args), error: null };
  });
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
    expect(mocks.rpc).not.toHaveBeenCalled();
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
      billing_last_event_at: CREATED_AT,
    });
    expect(mocks.rpc).toHaveBeenCalledWith(
      "bind_paddle_subscription",
      expect.objectContaining({
        _nonce: NONCE_A,
        _user_id: OWNER,
        _subscription_id: "sub_1",
        _event_at: CREATED_AT,
      }),
    );
    expect(mocks.nonces).toEqual([{ nonce: NONCE_A, user_id: OWNER, subscription_id: "sub_1" }]);
    expect(informed("paddle.webhook.subscription_bound")).toHaveLength(1);
  });

  it("accepts a binding issued just under the 24h maximum age", async () => {
    await deliver(
      EventName.SubscriptionCreated,
      subscription({ customData: sign(OWNER, CREATED_MS - CHECKOUT_BINDING_MAX_AGE_MS + 1000) }),
    );
    expect(rowFor(OWNER)?.billing_subscription_id).toBe("sub_1");
  });

  it.each([
    [
      "forged with another secret",
      () => sign(VICTIM, CREATED_MS, NONCE_A, "x".repeat(48)),
      "bad_signature",
    ],
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
    [
      "with a swapped nonce",
      () => ({ ...sign(VICTIM, CREATED_MS), nonce: NONCE_B }),
      "bad_signature",
    ],
    ["in the retired v1 format", () => signV1(VICTIM, CREATED_MS), "malformed"],
    ["unsigned (bare user_id)", () => ({ user_id: VICTIM }), "missing"],
    ["missing entirely", () => null, "missing"],
    ["with a malformed sig", () => ({ ...sign(VICTIM, CREATED_MS), sig: "abc" }), "malformed"],
    [
      "with a malformed nonce",
      () => ({ ...sign(VICTIM, CREATED_MS), nonce: "short" }),
      "malformed",
    ],
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
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.writes).toEqual([]);
    expect(mocks.nonces).toEqual([]);
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
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(warned("paddle.webhook.custom_data_mismatch")).toHaveLength(1);
  });

  it("logs and acknowledges a bind the database refuses permanently", async () => {
    // SQLSTATE 23xxx (integrity constraint): a redelivery cannot change it.
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "23503", message: "insert or update violates fk" },
    });
    const response = await deliver(
      EventName.SubscriptionCreated,
      subscription({ customData: sign(OWNER, CREATED_MS) }),
    );
    expect(response.status).toBe(200);
    expect(mocks.error).toHaveBeenCalledWith(
      "paddle.webhook.upsert_failed",
      expect.objectContaining({ user_id: OWNER, code: "23503", err: expect.any(String) }),
    );
  });

  it("asks Paddle to redeliver when the database is unavailable", async () => {
    // Without a non-2xx answer the event would be lost until the sync cron.
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: "57P01", message: "terminating connection due to administrator command" },
    });
    const response = await deliver(
      EventName.SubscriptionCreated,
      subscription({ customData: sign(OWNER, CREATED_MS) }),
    );
    expect(response.status).toBe(500);
    expect(mocks.error).toHaveBeenCalledWith(
      "paddle.webhook.handler_failed",
      expect.objectContaining({ retryable: true, errorType: "WebhookRetryableError" }),
    );
    expect(mocks.writes).toEqual([]);
  });

  it("asks Paddle to redeliver when the binding lookup fails", async () => {
    const original = vi.mocked(supabaseAdmin.from).getMockImplementation();
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(() => {
      const builder = {
        select: vi.fn(() => builder),
        eq: vi.fn(() => builder),
        limit: vi.fn(async () => ({ data: null, error: { message: "connection refused" } })),
      };
      return builder as never;
    });
    try {
      const response = await deliver(
        EventName.SubscriptionCreated,
        subscription({ customData: sign(OWNER, CREATED_MS) }),
      );
      expect(response.status).toBe(500);
      expect(mocks.rpc).not.toHaveBeenCalled();
    } finally {
      if (original) vi.mocked(supabaseAdmin.from).mockImplementation(original);
    }
  });
});

describe("single-use checkout nonces", () => {
  it("treats a Paddle retry for the same subscription as idempotent", async () => {
    const customData = sign(OWNER, CREATED_MS);
    expect(
      (await deliver(EventName.SubscriptionCreated, subscription({ customData }))).status,
    ).toBe(200);
    expect(
      (await deliver(EventName.SubscriptionCreated, subscription({ customData }))).status,
    ).toBe(200);

    expect(mocks.rows).toHaveLength(1);
    expect(rowFor(OWNER)).toMatchObject({ billing_subscription_id: "sub_1", tier: "pro" });
    expect(mocks.nonces).toEqual([{ nonce: NONCE_A, user_id: OWNER, subscription_id: "sub_1" }]);
    expect(warned("paddle.webhook.binding_rejected")).toEqual([]);
    expect(informed("paddle.webhook.subscription_bound")).toHaveLength(1);
    expect(informed("paddle.webhook.subscription_synced")).toHaveLength(1);
  });

  it("stays idempotent when the retry reaches the bind function after a concurrent bind", async () => {
    const customData = sign(OWNER, CREATED_MS);
    await deliver(EventName.SubscriptionCreated, subscription({ customData }));
    mocks.writes = [];
    // Model the race: the stored-binding lookup misses the row that a
    // concurrent delivery committed a moment later, so the bind function sees it.
    vi.mocked(supabaseAdmin.from).mockImplementationOnce(
      () =>
        ({
          select: () => ({
            eq: () => ({ eq: () => ({ limit: async () => ({ data: [], error: null }) }) }),
          }),
        }) as never,
    );

    const response = await deliver(EventName.SubscriptionCreated, subscription({ customData }));
    expect(response.status).toBe(200);
    expect(mocks.nonces).toHaveLength(1);
    expect(rowFor(OWNER)?.billing_subscription_id).toBe("sub_1");
    expect(warned("paddle.webhook.binding_rejected")).toEqual([]);
    expect(informed("paddle.webhook.subscription_synced")).toHaveLength(1);
  });

  it("rejects the same signed blob on a different subscription", async () => {
    const customData = sign(OWNER, CREATED_MS);
    await deliver(EventName.SubscriptionCreated, subscription({ customData }));
    const before = structuredClone(mocks.rows);
    mocks.writes = [];

    const response = await deliver(
      EventName.SubscriptionCreated,
      subscription({ id: "sub_2", customerId: "ctm_attacker", customData }),
    );

    expect(response.status).toBe(200);
    expect(mocks.writes).toEqual([]);
    expect(mocks.rows).toEqual(before);
    expect(mocks.nonces).toEqual([{ nonce: NONCE_A, user_id: OWNER, subscription_id: "sub_1" }]);
    expect(warned("paddle.webhook.binding_rejected")).toEqual([
      expect.objectContaining({
        subscription_id: "sub_2",
        reason: "nonce_reused",
        event_type: EventName.SubscriptionCreated,
      }),
    ]);
  });

  it("never moves a user back to a superseded subscription", async () => {
    const first = sign(OWNER, CREATED_MS, NONCE_A);
    await deliver(EventName.SubscriptionCreated, subscription({ customData: first }));
    await deliver(
      EventName.SubscriptionCreated,
      subscription({ id: "sub_2", customData: sign(OWNER, CREATED_MS + 60_000, NONCE_B) }),
      "2026-11-07T12:00:00.000Z",
    );
    expect(rowFor(OWNER)?.billing_subscription_id).toBe("sub_2");
    mocks.writes = [];

    await deliver(
      EventName.SubscriptionCanceled,
      subscription({ status: "canceled", customData: first }),
      "2026-11-08T12:00:00.000Z",
    );

    expect(mocks.writes).toEqual([]);
    expect(rowFor(OWNER)).toMatchObject({ billing_subscription_id: "sub_2", tier: "pro" });
    expect(warned("paddle.webhook.binding_rejected")).toEqual([
      expect.objectContaining({ subscription_id: "sub_1", reason: "binding_superseded" }),
    ]);
  });

  it("refuses to bind a subscription another user already holds", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: "subscription_bound_elsewhere", error: null });
    await deliver(
      EventName.SubscriptionCreated,
      subscription({ customData: sign(OWNER, CREATED_MS) }),
    );
    expect(mocks.writes).toEqual([]);
    expect(warned("paddle.webhook.binding_rejected")).toEqual([
      expect.objectContaining({ reason: "subscription_bound_elsewhere" }),
    ]);
  });
});

describe("event ordering", () => {
  it.each([
    EventName.SubscriptionUpdated,
    EventName.SubscriptionActivated,
    EventName.SubscriptionTrialing,
  ])("%s that arrives before subscription.created creates the binding", async (eventType) => {
    const response = await deliver(
      eventType,
      subscription({ customData: sign(OWNER, CREATED_MS - 60_000) }),
      "2026-11-06T12:00:05.000Z",
    );

    expect(response.status).toBe(200);
    expect(rowFor(OWNER)).toMatchObject({
      billing_subscription_id: "sub_1",
      tier: "pro",
      status: "active",
      billing_last_event_at: "2026-11-06T12:00:05.000Z",
    });
    expect(mocks.nonces).toHaveLength(1);
  });

  it("ignores the late subscription.created once a newer event was applied", async () => {
    await deliver(
      EventName.SubscriptionUpdated,
      subscription({ status: "past_due", customData: sign(OWNER, CREATED_MS) }),
      "2026-11-06T12:00:05.000Z",
    );
    mocks.writes = [];

    const response = await deliver(
      EventName.SubscriptionCreated,
      subscription({ status: "active", customData: sign(OWNER, CREATED_MS) }),
      CREATED_AT,
    );

    expect(response.status).toBe(200);
    expect(mocks.writes).toEqual([]);
    expect(rowFor(OWNER)).toMatchObject({
      status: "past_due",
      billing_last_event_at: "2026-11-06T12:00:05.000Z",
    });
    expect(informed("paddle.webhook.event_stale")).toEqual([
      expect.objectContaining({ subscription_id: "sub_1", occurred_at: CREATED_AT }),
    ]);
  });

  it("ignores a stale event for a stored binding and writes nothing", async () => {
    mocks.rows = [
      {
        user_id: OWNER,
        tier: "free",
        status: "canceled",
        billing_provider: "paddle",
        billing_subscription_id: "sub_1",
        billing_last_event_at: "2026-11-06T13:00:00.000Z",
      },
    ];
    const before = structuredClone(mocks.rows);

    const response = await deliver(
      EventName.SubscriptionUpdated,
      subscription({ status: "active" }),
      "2026-11-06T12:30:00.000Z",
    );

    expect(response.status).toBe(200);
    expect(mocks.writes).toEqual([]);
    expect(mocks.rows).toEqual(before);
    expect(informed("paddle.webhook.event_stale")).toHaveLength(1);
  });

  it("applies an event with the same timestamp, so retries stay idempotent", async () => {
    mocks.rows = [
      {
        user_id: OWNER,
        tier: "pro",
        status: "active",
        billing_provider: "paddle",
        billing_subscription_id: "sub_1",
        billing_last_event_at: CREATED_AT,
      },
    ];
    await deliver(EventName.SubscriptionPastDue, subscription({ status: "past_due" }));
    expect(rowFor(OWNER)).toMatchObject({ status: "past_due", billing_last_event_at: CREATED_AT });
  });

  it("records the event time of every applied event", async () => {
    mocks.rows = [
      {
        user_id: OWNER,
        tier: "pro",
        status: "active",
        billing_provider: "paddle",
        billing_subscription_id: "sub_1",
        billing_last_event_at: CREATED_AT,
      },
    ];
    await deliver(
      EventName.SubscriptionCanceled,
      subscription({ status: "canceled" }),
      "2026-11-20T08:00:00.123456Z",
    );
    expect(rowFor(OWNER)).toMatchObject({
      tier: "free",
      status: "canceled",
      billing_last_event_at: "2026-11-20T08:00:00.123456Z",
    });
  });

  it.each([null, "", "yesterday", "2026-11-06T12:00:00.000Z,billing_provider.eq.x"])(
    "fails closed on an unusable occurredAt (%s)",
    async (occurredAt) => {
      mocks.rows = [
        {
          user_id: OWNER,
          tier: "pro",
          status: "active",
          billing_provider: "paddle",
          billing_subscription_id: "sub_1",
        },
      ];
      const before = structuredClone(mocks.rows);
      const response = await deliver(
        EventName.SubscriptionCanceled,
        subscription({ status: "canceled" }),
        occurredAt,
      );
      expect(response.status).toBe(200);
      expect(mocks.writes).toEqual([]);
      expect(mocks.rows).toEqual(before);
      expect(warned("paddle.webhook.event_time_invalid")).toHaveLength(1);
    },
  );

  it("ignores a stale transaction.payment_failed", async () => {
    mocks.rows = [
      {
        user_id: OWNER,
        tier: "pro",
        status: "active",
        billing_provider: "paddle",
        billing_subscription_id: "sub_1",
        billing_last_event_at: "2026-11-06T13:00:00.000Z",
      },
    ];
    await deliver(EventName.TransactionPaymentFailed, { id: "txn_9", subscriptionId: "sub_1" });
    expect(rowFor(OWNER)?.status).toBe("active");
    expect(mocks.writes).toEqual([]);
    expect(informed("paddle.webhook.event_stale")).toHaveLength(1);
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
      expect(mocks.rpc).not.toHaveBeenCalled();
      expect(mocks.nonces).toEqual([]);
      for (const write of mocks.writes) {
        expect(write.payload).not.toHaveProperty("user_id");
        expect(write.payload).not.toHaveProperty("billing_subscription_id");
      }
      expect(warned("paddle.webhook.custom_data_mismatch")).toEqual([
        expect.objectContaining({ user_id: OWNER, claimed_user_id: VICTIM }),
      ]);
    },
  );

  it("never creates a binding from an unsigned update for an unknown subscription", async () => {
    await deliver(
      EventName.SubscriptionCanceled,
      subscription({ id: "sub_unknown", status: "canceled", customData: { user_id: VICTIM } }),
    );
    expect(mocks.writes).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(rowFor(VICTIM)).toMatchObject({ tier: "pro", status: "active" });
    expect(warned("paddle.webhook.binding_rejected")).toEqual([
      expect.objectContaining({ subscription_id: "sub_unknown", reason: "missing" }),
    ]);
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
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.nonces).toEqual([]);
    expect(rowFor(ATTACKER)).toBeUndefined();
    expect(warned("paddle.webhook.subscription_unbound")).toHaveLength(1);
  });

  it("transaction.payment_failed marks only the stored binding past_due", async () => {
    await deliver(EventName.TransactionPaymentFailed, { id: "txn_3", subscriptionId: "sub_1" });
    expect(rowFor(OWNER)).toMatchObject({ status: "past_due", billing_last_event_at: CREATED_AT });
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
  it("signs v2:<user_id>:<ts>:<nonce> with HMAC-SHA256 in base64url", () => {
    const binding = signCheckoutBinding(OWNER, CREATED_MS, NONCE_A);
    expect(binding).toEqual(sign(OWNER, CREATED_MS, NONCE_A));
    expect(binding?.sig).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(JSON.stringify(binding)).not.toContain(SECRET);
  });

  it("issues a fresh 128-bit nonce for every binding", () => {
    const nonces = new Set(
      Array.from({ length: 32 }, () => signCheckoutBinding(OWNER, CREATED_MS)?.nonce),
    );
    expect(nonces.size).toBe(32);
    for (const nonce of nonces) {
      expect(nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(Buffer.from(nonce!, "base64url")).toHaveLength(16);
    }
  });

  it("verifies its own binding and returns the nonce", () => {
    const binding = signCheckoutBinding(OWNER, CREATED_MS)!;
    expect(verifyCheckoutBinding(binding, CREATED_MS)).toEqual({
      ok: true,
      userId: OWNER,
      issuedAtMs: Math.floor(CREATED_MS / 1000) * 1000,
      nonce: binding.nonce,
    });
  });

  it("does not sign without a dedicated, long enough secret", () => {
    vi.stubEnv("BILLING_CUSTOM_DATA_SECRET", "");
    expect(signCheckoutBinding(OWNER)).toBeNull();
    vi.stubEnv("BILLING_CUSTOM_DATA_SECRET", "short");
    expect(signCheckoutBinding(OWNER)).toBeNull();
    vi.stubEnv("BILLING_CUSTOM_DATA_SECRET", "pdl_ntfset_webhook_secret_value");
    expect(signCheckoutBinding(OWNER)).toBeNull();
  });

  it("rejects a non-UUID user id, a bad nonce and non-object customData", () => {
    expect(signCheckoutBinding("not-a-uuid")).toBeNull();
    expect(signCheckoutBinding(OWNER, CREATED_MS, "bad nonce")).toBeNull();
    expect(verifyCheckoutBinding("user_id", CREATED_MS)).toMatchObject({ ok: false });
    expect(
      verifyCheckoutBinding({ ...sign(OWNER, CREATED_MS), ts: 1.5 }, CREATED_MS),
    ).toMatchObject({ ok: false, reason: "malformed" });
  });
});
