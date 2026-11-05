import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  results: [] as Array<{ data?: unknown; error?: unknown }>,
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const builder = () => {
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "delete", "eq", "gt", "maybeSingle"]) {
      chain[method] = (...args: unknown[]) => {
        db.calls.push([method, ...args]);
        return chain;
      };
    }
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(db.results.shift() ?? { data: null, error: null }).then(resolve);
    return chain;
  };
  return { supabaseAdmin: { from: () => builder(), rpc: db.rpc } };
});

vi.mock("@/lib/logger.server", () => ({ log: { warn: vi.fn(), info: vi.fn() } }));

import {
  createMemorySharedState,
  createSupabaseSharedState,
  pruneMcpEphemeralState,
} from "../mcp-shared-state.server";

beforeEach(() => {
  db.calls = [];
  db.results = [];
  db.rpc.mockReset();
  vi.unstubAllEnvs();
});

describe("memory shared state", () => {
  it("issues, completes and takes an elicitation exactly once per user", async () => {
    const state = createMemorySharedState();
    await state.issueElicitation("u1", "e1", "fp", 60_000);
    await expect(state.completeElicitation("u2", "e1", { confirm: true }, 60_000)).resolves.toBe(
      false,
    );
    await expect(state.completeElicitation("u1", "e1", { confirm: true }, 60_000)).resolves.toBe(
      true,
    );
    await expect(state.takeElicitation("u1", "e1")).resolves.toEqual({
      fingerprint: "fp",
      response: { confirm: true },
    });
    await expect(state.takeElicitation("u1", "e1")).resolves.toBeNull();
  });

  it("redeems a nonce once", async () => {
    const state = createMemorySharedState();
    await expect(state.isRedeemed("n1")).resolves.toBe(false);
    await expect(state.redeem("n1", 60_000)).resolves.toBe(true);
    await expect(state.redeem("n1", 60_000)).resolves.toBe(false);
    await expect(state.isRedeemed("n1")).resolves.toBe(true);
  });
});

describe("supabase shared state", () => {
  it("lets the primary key decide which request redeems a nonce", async () => {
    const state = createSupabaseSharedState();
    db.results = [{ error: null }, { error: { code: "23505", message: "duplicate key" } }];
    await expect(state.redeem("n1", 60_000)).resolves.toBe(true);
    await expect(state.redeem("n1", 60_000)).resolves.toBe(false);
    expect(db.calls.find(([method]) => method === "insert")?.[1]).toMatchObject({
      key: "nonce:n1",
      kind: "request_state_nonce",
    });
  });

  it("treats a lookup error as already used (fail closed)", async () => {
    const state = createSupabaseSharedState();
    db.results = [{ data: null, error: { message: "down" } }];
    await expect(state.isRedeemed("n1")).resolves.toBe(true);
  });

  it("takes an elicitation with delete … returning, ignoring expired rows", async () => {
    const state = createSupabaseSharedState();
    db.results = [
      { data: [{ value: { fingerprint: "fp", response: { confirm: true } } }], error: null },
    ];
    await expect(state.takeElicitation("u1", "e1")).resolves.toEqual({
      fingerprint: "fp",
      response: { confirm: true },
    });
    expect(db.calls.map(([method]) => method)).toEqual(["delete", "eq", "gt", "select"]);
    expect(db.calls).toContainEqual(["eq", "key", "elicitation:u1:e1"]);
  });

  it("refuses to complete an elicitation it cannot find", async () => {
    const state = createSupabaseSharedState();
    db.results = [{ data: null, error: null }];
    await expect(state.completeElicitation("u1", "e1", { confirm: true }, 60_000)).resolves.toBe(
      false,
    );
    expect(db.calls.some(([method]) => method === "update")).toBe(false);
  });

  it("stores the answer next to the issued fingerprint", async () => {
    const state = createSupabaseSharedState();
    db.results = [{ data: { value: { fingerprint: "fp" } }, error: null }, { error: null }];
    await expect(state.completeElicitation("u1", "e1", { confirm: true }, 60_000)).resolves.toBe(
      true,
    );
    expect(db.calls.find(([method]) => method === "update")?.[1]).toMatchObject({
      value: { fingerprint: "fp", response: { confirm: true } },
    });
  });
});

describe("pruneMcpEphemeralState", () => {
  it("runs only with the Supabase backend", async () => {
    await expect(pruneMcpEphemeralState()).resolves.toBe(0);
    expect(db.rpc).not.toHaveBeenCalled();

    vi.stubEnv("MCP_SHARED_STATE", "supabase");
    db.rpc.mockResolvedValueOnce({ data: 4, error: null });
    await expect(pruneMcpEphemeralState()).resolves.toBe(4);
    expect(db.rpc).toHaveBeenCalledWith("prune_mcp_ephemeral_state");
  });
});
