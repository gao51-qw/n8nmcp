import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = { data: unknown; error: unknown };

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  rpc: vi.fn(),
  results: {} as Record<string, QueryResult>,
  calls: [] as Array<{ table: string; method: string; args: unknown[] }>,
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(() => "sentry-event"),
}));

vi.mock("@/lib/support/auth.server", () => ({
  requireSupportUser: mocks.requireUser,
}));

vi.mock("@/lib/logger.server", () => ({
  getRequestId: () => "request-usage-1",
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("@/integrations/supabase/client.server", () => {
  function builder(table: string) {
    const result = () => mocks.results[table] ?? { data: null, error: null };
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "gte", "order", "limit"]) {
      chain[method] = (...args: unknown[]) => {
        mocks.calls.push({ table, method, args });
        return chain;
      };
    }
    chain.maybeSingle = () => Promise.resolve(result());
    chain.then = (resolve: (value: QueryResult) => unknown, reject?: (error: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return chain;
  }
  return {
    supabaseAdmin: {
      rpc: mocks.rpc,
      from: (table: string) => {
        mocks.calls.push({ table, method: "from", args: [table] });
        return builder(table);
      },
    },
  };
});

const USER_ID = "10000000-0000-4000-8000-000000000001";

function request(query = "") {
  return new Request(`https://example.test/api/dashboard/usage${query}`, {
    headers: { authorization: "Bearer session-token" },
  });
}

describe("dashboard usage route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.calls = [];
    mocks.requireUser.mockResolvedValue({ userId: USER_ID, email: "user@example.com" });
    mocks.rpc.mockResolvedValue({ data: 42, error: null });
    mocks.results = {
      subscriptions: { data: { tier: "pro", status: "active" }, error: null },
      usage_daily: {
        data: [
          { day: "2026-11-05", mcp_calls: 7 },
          { day: "2026-11-06", mcp_calls: 42 },
        ],
        error: null,
      },
      mcp_call_logs: {
        data: [
          {
            id: "log-1",
            tool_name: "n8n_list_workflows",
            status: "ok",
            latency_ms: 120,
            created_at: "2026-11-06T10:00:00.000Z",
            error_message: null,
          },
          {
            id: "log-2",
            tool_name: "n8n_update_partial_workflow",
            status: "error",
            latency_ms: 80,
            created_at: "2026-11-06T09:00:00.000Z",
            error_message: "x".repeat(1000),
          },
        ],
        error: null,
      },
    };
  });

  it("returns quota, tier, daily counts and recent calls for the signed-in user", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-06T12:00:00.000Z"));
    const { GET } = await import("../route");

    const response = await GET(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("request-usage-1");
    const body = (await response.json()) as { usage: Record<string, unknown> };
    expect(body.usage).toMatchObject({
      tier: "pro",
      tierLabel: "Pro",
      subscriptionStatus: "active",
      used: 42,
      limit: 100_000,
      unlimited: false,
      remaining: 99_958,
      resetsAt: "2026-11-07T00:00:00.000Z",
    });
    const daily = body.usage.daily as Array<{ day: string; calls: number }>;
    expect(daily).toHaveLength(14);
    expect(daily[0]).toEqual({ day: "2026-10-24", calls: 0 });
    expect(daily.at(-2)).toEqual({ day: "2026-11-05", calls: 7 });
    expect(daily.at(-1)).toEqual({ day: "2026-11-06", calls: 42 });
    const recent = body.usage.recentCalls as Array<{ id: string; error_message: string | null }>;
    expect(recent.map((call) => call.id)).toEqual(["log-1", "log-2"]);
    expect(recent[1].error_message?.length).toBeLessThanOrEqual(300);

    expect(mocks.rpc).toHaveBeenCalledWith("get_today_mcp_usage", { _user_id: USER_ID });
    for (const table of ["subscriptions", "usage_daily", "mcp_call_logs"]) {
      expect(mocks.calls).toContainEqual({ table, method: "eq", args: ["user_id", USER_ID] });
    }
    expect(mocks.calls).toContainEqual({ table: "mcp_call_logs", method: "limit", args: [25] });
  });

  it("falls back to the free tier when a paid subscription is not active", async () => {
    mocks.results.subscriptions = { data: { tier: "pro", status: "canceled" }, error: null };
    mocks.rpc.mockResolvedValue({ data: 150, error: null });
    const { GET } = await import("../route");

    const body = (await (await GET(request())).json()) as { usage: Record<string, unknown> };

    expect(body.usage).toMatchObject({ tier: "free", limit: 100, used: 150, remaining: 0 });
  });

  it("treats a user without a subscription row as free", async () => {
    mocks.results.subscriptions = { data: null, error: null };
    const { GET } = await import("../route");

    const body = (await (await GET(request())).json()) as { usage: Record<string, unknown> };

    expect(body.usage).toMatchObject({ tier: "free", subscriptionStatus: null, limit: 100 });
  });

  it("honours a bounded recent-call limit", async () => {
    const { GET } = await import("../route");

    const response = await GET(request("?recent=10"));

    expect(response.status).toBe(200);
    expect(mocks.calls).toContainEqual({ table: "mcp_call_logs", method: "limit", args: [10] });
  });

  it("rejects an out-of-range recent-call limit before querying", async () => {
    const { GET } = await import("../route");

    const response = await GET(request("?recent=1000"));

    expect(response.status).toBe(400);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request", requestId: "request-usage-1" },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("returns a structured 401 when the session is missing", async () => {
    mocks.requireUser.mockRejectedValue(
      Response.json(
        { error: { code: "authentication_required", message: "Authentication required" } },
        { status: 401 },
      ),
    );
    const { GET } = await import("../route");

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "authentication_required",
        message: "Authentication required",
        requestId: "request-usage-1",
      },
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails closed with a safe message when a usage query errors", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "relation does not exist" } });
    const { GET } = await import("../route");

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("usage_unavailable");
    expect(body.error.message).not.toContain("relation");
  });

  it("maps unexpected failures to a generic 500 without leaking details", async () => {
    mocks.rpc.mockRejectedValue(new Error("connection string postgres://secret"));
    const { GET } = await import("../route");

    const response = await GET(request());

    expect(response.status).toBe(500);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("internal_error");
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
