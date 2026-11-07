// getDefaultInstance: MCP works with the instance the user chose (is_default),
// falling back to the oldest one.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Query = { ops: Array<[string, ...unknown[]]> };

const db = vi.hoisted(() => ({
  queries: [] as Query[],
  results: [] as Array<{ data: unknown; error: unknown }>,
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const builder = (table: string) => {
    const query: Query = { ops: [["from", table]] };
    db.queries.push(query);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "eq", "order", "limit"]) {
      chain[method] = (...args: unknown[]) => {
        query.ops.push([method, ...args]);
        return chain;
      };
    }
    chain.maybeSingle = () => {
      query.ops.push(["maybeSingle"]);
      return Promise.resolve(db.results.shift() ?? { data: null, error: null });
    };
    return chain;
  };
  return { supabaseAdmin: { from: builder, rpc: vi.fn() } };
});

vi.mock("../crypto.server", () => ({
  decryptSecret: vi.fn(({ ciphertext }: { ciphertext: string }) => `plain(${ciphertext})`),
  hashPlatformApiKey: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(() => "sentry-event") }));

vi.mock("@/lib/logger.server", () => ({
  getRequestId: () => "request-1",
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getDefaultInstance } from "../mcp.server";

const row = {
  id: "instance-2",
  name: "Staging",
  base_url: "https://staging.example.com",
  api_key_encrypted: "key",
  api_key_iv: "i",
  api_key_tag: "t",
  mcp_token_encrypted: null,
  mcp_token_iv: null,
  mcp_token_tag: null,
  mcp_capabilities: {},
};

function orders(query: Query) {
  return query.ops.filter(([op]) => op === "order").map(([, ...args]) => args);
}

beforeEach(() => {
  db.queries = [];
  db.results = [];
});

describe("getDefaultInstance", () => {
  it("orders by is_default first and created_at second, in one query", async () => {
    db.results = [{ data: row, error: null }];

    const instance = await getDefaultInstance("user-1");

    expect(db.queries).toHaveLength(1);
    expect(db.queries[0].ops).toContainEqual(["eq", "user_id", "user-1"]);
    expect(orders(db.queries[0])).toEqual([
      ["is_default", { ascending: false }],
      ["created_at", { ascending: true }],
    ]);
    expect(instance).toMatchObject({ id: "instance-2", api_key: "plain(key)", native: null });
  });

  it("returns null when the user has no instance", async () => {
    db.results = [{ data: null, error: null }];
    await expect(getDefaultInstance("user-1")).resolves.toBeNull();
  });

  it("falls back to the oldest instance while is_default does not exist yet", async () => {
    db.results = [
      { data: null, error: { code: "42703", message: "column is_default does not exist" } },
      { data: row, error: null },
    ];

    const instance = await getDefaultInstance("user-1");

    expect(db.queries).toHaveLength(2);
    expect(orders(db.queries[1])).toEqual([["created_at", { ascending: true }]]);
    expect(instance?.id).toBe("instance-2");
  });

  it("does not retry on other errors", async () => {
    db.results = [{ data: null, error: { code: "57014", message: "timeout" } }];

    await expect(getDefaultInstance("user-1")).resolves.toBeNull();
    expect(db.queries).toHaveLength(1);
  });
});
