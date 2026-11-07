import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "20000000-0000-4000-8000-000000000002";
const USER_C = "30000000-0000-4000-8000-000000000003";
const USER_D = "40000000-0000-4000-8000-000000000004";
const CRON_SECRET = "billing-cron-secret-value";

type Row = {
  user_id: string;
  billing_provider: string;
  billing_subscription_id: string | null;
  billing_customer_id: string | null;
};

const mocks = vi.hoisted(() => ({
  rows: [] as Array<{
    user_id: string;
    billing_provider: string;
    billing_subscription_id: string | null;
    billing_customer_id: string | null;
  }>,
  authUsers: new Map<string, { id: string; email: string | null }>(),
  writes: [] as string[],
  queries: [] as Array<Array<[string, ...unknown[]]>>,
  subscriptionsGet: vi.fn(),
  customersGet: vi.fn(),
  getUserById: vi.fn(),
  rpc: vi.fn(),
  logCalls: [] as Array<[string, string, unknown]>,
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: (...args: unknown[]) => {
      mocks.writes.push("rpc");
      return mocks.rpc(...args);
    },
    auth: { admin: { getUserById: mocks.getUserById } },
    from: vi.fn((table: string) => {
      const calls: Array<[string, ...unknown[]]> = [["from", table]];
      mocks.queries.push(calls);
      const record =
        (name: string) =>
        (...args: unknown[]) => {
          calls.push([name, ...args]);
          return builder;
        };
      const write =
        (name: string) =>
        (...args: unknown[]) => {
          mocks.writes.push(name);
          calls.push([name, ...args]);
          return builder;
        };
      const builder = {
        select: record("select"),
        eq: record("eq"),
        not: record("not"),
        gt: record("gt"),
        order: record("order"),
        limit: record("limit"),
        update: write("update"),
        insert: write("insert"),
        upsert: write("upsert"),
        delete: write("delete"),
        then: (resolve: (value: { data: Row[]; error: null }) => void) => {
          let rows = [...mocks.rows].sort((a, b) => a.user_id.localeCompare(b.user_id));
          let limit = Infinity;
          for (const [name, ...args] of calls) {
            if (name === "eq") rows = rows.filter((row) => row[args[0] as keyof Row] === args[1]);
            if (name === "not") {
              rows = rows.filter((row) => row[args[0] as keyof Row] !== null);
            }
            if (name === "gt") {
              rows = rows.filter((row) => String(row[args[0] as keyof Row]) > String(args[1]));
            }
            if (name === "limit") limit = Number(args[0]);
          }
          resolve({ data: rows.slice(0, limit), error: null });
        },
      };
      return builder;
    }),
  },
}));

vi.mock("@/lib/logger.server", () => {
  const capture =
    (level: string) =>
    (event: string, fields?: unknown): void => {
      mocks.logCalls.push([level, event, fields]);
    };
  return {
    getRequestId: (request: Request) => request.headers.get("x-request-id") ?? "generated-request",
    log: {
      debug: capture("debug"),
      info: capture("info"),
      warn: capture("warn"),
      error: capture("error"),
    },
  };
});

vi.mock("@/lib/paddle.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paddle.server")>();
  return {
    ...actual,
    getPaddle: () => ({
      subscriptions: { get: mocks.subscriptionsGet },
      customers: { get: mocks.customersGet },
    }),
  };
});

import { POST } from "@/app/api/internal/billing/audit-bindings/route";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const PADDLE_CUSTOMERS: Record<string, string> = {
  ctm_a: "Alice.Owner@Example.com",
  ctm_b: "mallory.attacker@evil.example",
  ctm_d: "dora@example.com",
};

const FULL_EMAILS = [
  "alice.owner@example.com",
  "mallory.attacker@evil.example",
  "bob.victim@corp.example",
  "dora@example.com",
];

function row(userId: string, subscriptionId: string, customerId: string): Row {
  return {
    user_id: userId,
    billing_provider: "paddle",
    billing_subscription_id: subscriptionId,
    billing_customer_id: customerId,
  };
}

function audit(query = "", authorization: string | null = `Bearer ${CRON_SECRET}`) {
  return POST(
    new Request(`https://example.test/api/internal/billing/audit-bindings${query}`, {
      method: "POST",
      headers: authorization ? { authorization, "x-request-id": "req-1" } : {},
    }),
  );
}

function auditQueries() {
  return mocks.queries.filter((calls) => calls[0]?.[1] === "subscriptions");
}

beforeEach(() => {
  vi.stubEnv("BILLING_CRON_SECRET", CRON_SECRET);
  vi.stubEnv("PADDLE_API_KEY", "pdl_sdbx_apikey_secret_value");
  mocks.rows = [
    row(USER_A, "sub_a", "ctm_a"),
    row(USER_B, "sub_b", "ctm_b"),
    row(USER_C, "sub_c", "ctm_c"),
    // Not bound to a Paddle subscription: never audited.
    { ...row(USER_D, "sub_d", "ctm_d"), billing_subscription_id: null },
  ];
  mocks.authUsers = new Map([
    [USER_A, { id: USER_A, email: "alice.owner@example.com" }],
    [USER_B, { id: USER_B, email: "bob.victim@corp.example" }],
    [USER_C, { id: USER_C, email: "carol@example.com" }],
  ]);
  mocks.writes = [];
  mocks.queries = [];
  mocks.logCalls = [];
  mocks.rpc.mockReset();
  mocks.subscriptionsGet.mockReset();
  mocks.subscriptionsGet.mockImplementation(async (id: string) => {
    if (id === "sub_c") throw new Error("Paddle API unavailable");
    const customerId = mocks.rows.find(
      (candidate) => candidate.billing_subscription_id === id,
    )?.billing_customer_id;
    return { id, customerId, customData: null };
  });
  mocks.customersGet.mockReset();
  mocks.customersGet.mockImplementation(async (id: string) => ({
    id,
    email: PADDLE_CUSTOMERS[id],
  }));
  mocks.getUserById.mockReset();
  mocks.getUserById.mockImplementation(async (id: string) => {
    const user = mocks.authUsers.get(id);
    return user
      ? { data: { user }, error: null }
      : { data: { user: null }, error: { status: 404, message: "User not found" } };
  });
  vi.mocked(supabaseAdmin.from).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/internal/billing/audit-bindings authentication", () => {
  it.each([null, "Bearer wrong", "Basic billing-cron-secret-value", `Bearer ${CRON_SECRET}x`])(
    "rejects %s",
    async (authorization) => {
      const response = await audit("", authorization);
      expect(response.status).toBe(401);
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
      expect(mocks.subscriptionsGet).not.toHaveBeenCalled();
      expect(mocks.getUserById).not.toHaveBeenCalled();
    },
  );

  it("fails closed when BILLING_CRON_SECRET is unset", async () => {
    vi.stubEnv("BILLING_CRON_SECRET", "");
    const response = await audit("", "Bearer ");
    expect(response.status).toBe(401);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it.each(["?limit=0", "?limit=201", "?limit=abc", "?limit=1.5", "?cursor=not-a-uuid"])(
    "rejects an invalid query %s",
    async (query) => {
      const response = await audit(query);
      expect(response.status).toBe(400);
      expect(supabaseAdmin.from).not.toHaveBeenCalled();
    },
  );

  it("returns 503 when Paddle is not configured", async () => {
    vi.stubEnv("PADDLE_API_KEY", "");
    const response = await audit();
    expect(response.status).toBe(503);
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });
});

describe("binding audit report", () => {
  it("reports email mismatches and lookup errors without writing anything", async () => {
    const response = await audit();

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("req-1");
    expect(await response.json()).toEqual({
      checked: 3,
      mismatches: [{ user_id: USER_B, subscription_id: "sub_b", reason: "email_mismatch" }],
      errors: [
        { user_id: USER_C, subscription_id: "sub_c", reason: "paddle_subscription_lookup_failed" },
      ],
      nextCursor: null,
    });

    // Read-only: no inserts, updates, upserts, deletes or RPCs.
    expect(mocks.writes).toEqual([]);
    expect(mocks.rpc).not.toHaveBeenCalled();
    const [query] = auditQueries();
    expect(query).toEqual(
      expect.arrayContaining([
        ["eq", "billing_provider", "paddle"],
        ["not", "billing_subscription_id", "is", null],
        ["order", "user_id", { ascending: true }],
        ["limit", 50],
      ]),
    );
  });

  it("logs each mismatch with email domains only, never a full email", async () => {
    await audit();

    const mismatches = mocks.logCalls.filter(
      ([, event]) => event === "billing.binding_audit.mismatch",
    );
    expect(mismatches).toEqual([
      [
        "warn",
        "billing.binding_audit.mismatch",
        {
          user_id: USER_B,
          subscription_id: "sub_b",
          reason: "email_mismatch",
          paddle_email_domain: "evil.example",
          account_email_domain: "corp.example",
        },
      ],
    ]);

    const logged = JSON.stringify(mocks.logCalls).toLowerCase();
    for (const email of FULL_EMAILS) {
      expect(logged).not.toContain(email);
      expect(logged).not.toContain(email.split("@")[0]);
    }
    const body = JSON.stringify(await (await audit()).json()).toLowerCase();
    for (const email of FULL_EMAILS) expect(body).not.toContain(email.split("@")[0]);
  });

  it("flags a missing account and customData naming another user", async () => {
    mocks.authUsers.delete(USER_A);
    mocks.subscriptionsGet.mockImplementation(async (id: string) => ({
      id,
      customerId: id === "sub_b" ? "ctm_b" : "ctm_a",
      customData: id === "sub_b" ? { user_id: USER_C } : null,
    }));
    mocks.authUsers.set(USER_B, { id: USER_B, email: "mallory.attacker@evil.example" });
    mocks.rows = mocks.rows.slice(0, 2);

    const body = await (await audit()).json();
    expect(body.mismatches).toEqual([
      { user_id: USER_A, subscription_id: "sub_a", reason: "auth_user_missing" },
      { user_id: USER_B, subscription_id: "sub_b", reason: "custom_data_user_mismatch" },
    ]);
    expect(mocks.writes).toEqual([]);
  });

  it("reports an auth lookup failure as an error, not a mismatch", async () => {
    mocks.getUserById.mockResolvedValue({
      data: { user: null },
      error: { status: 500, message: "upstream" },
    });
    mocks.rows = mocks.rows.slice(0, 1);
    const body = await (await audit()).json();
    expect(body).toMatchObject({
      checked: 1,
      mismatches: [],
      errors: [{ user_id: USER_A, subscription_id: "sub_a", reason: "auth_user_lookup_failed" }],
    });
  });

  it("paginates with a bounded limit and a user_id cursor", async () => {
    const first = await (await audit("?limit=2")).json();
    expect(first.checked).toBe(2);
    expect(first.nextCursor).toBe(USER_B);
    expect(auditQueries()[0]).toEqual(expect.arrayContaining([["limit", 2]]));

    const second = await (await audit(`?limit=2&cursor=${first.nextCursor}`)).json();
    expect(second).toMatchObject({ checked: 1, nextCursor: null });
    expect(auditQueries()[1]).toEqual(expect.arrayContaining([["gt", "user_id", USER_B]]));
    expect(mocks.subscriptionsGet.mock.calls.map(([id]) => id)).toEqual([
      "sub_a",
      "sub_b",
      "sub_c",
    ]);
    expect(mocks.writes).toEqual([]);
  });
});
