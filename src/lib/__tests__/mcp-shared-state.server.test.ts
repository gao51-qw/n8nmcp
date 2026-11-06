import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  results: [] as Array<{ data?: unknown; error?: unknown }>,
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const builder = () => {
    const chain: Record<string, unknown> = {};
    for (const method of [
      "select",
      "insert",
      "update",
      "upsert",
      "delete",
      "eq",
      "gt",
      "maybeSingle",
    ]) {
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

describe("memory shared state: session capabilities", () => {
  it("stores capabilities per user and session, replacing on re-initialize", async () => {
    const state = createMemorySharedState();
    await state.setSessionCapabilities("u1", "s1", { elicitation: true }, 60_000);
    await expect(state.getSessionCapabilities("u1", "s1")).resolves.toEqual({ elicitation: true });
    await expect(state.getSessionCapabilities("u2", "s1")).resolves.toBeNull();
    await expect(state.getSessionCapabilities("u1", "s2")).resolves.toBeNull();

    await state.setSessionCapabilities("u1", "s1", { elicitation: false }, 60_000);
    await expect(state.getSessionCapabilities("u1", "s1")).resolves.toEqual({ elicitation: false });
  });

  it("expires capabilities after their TTL", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    try {
      nowSpy.mockReturnValue(1_000_000);
      const state = createMemorySharedState();
      await state.setSessionCapabilities("u1", "s1", { elicitation: true }, 60_000);
      nowSpy.mockReturnValue(1_000_000 + 60_001);
      await expect(state.getSessionCapabilities("u1", "s1")).resolves.toBeNull();
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("is bounded: the oldest session is evicted first", async () => {
    const state = createMemorySharedState(50_000, 2);
    await state.setSessionCapabilities("u1", "a", { elicitation: true }, 60_000);
    await state.setSessionCapabilities("u1", "b", { elicitation: true }, 60_000);
    await state.setSessionCapabilities("u1", "c", { elicitation: true }, 60_000);
    await expect(state.getSessionCapabilities("u1", "a")).resolves.toBeNull();
    await expect(state.getSessionCapabilities("u1", "c")).resolves.toEqual({ elicitation: true });
  });

  it("keeps only boolean capability flags", async () => {
    const state = createMemorySharedState();
    await state.setSessionCapabilities(
      "u1",
      "s1",
      { elicitation: "yes", sampling: true, other: 1 } as never,
      60_000,
    );
    await expect(state.getSessionCapabilities("u1", "s1")).resolves.toEqual({ sampling: true });
  });
});

describe("supabase shared state", () => {
  it("upserts session capabilities under a hashed, bounded key", async () => {
    const state = createSupabaseSharedState();
    const sessionId = "x".repeat(5_000);
    db.results = [{ error: null }];
    await state.setSessionCapabilities("u1", sessionId, { elicitation: true }, 60_000);

    const upsert = db.calls.find(([method]) => method === "upsert");
    const row = upsert?.[1] as { key: string; kind: string; user_id: string; value: unknown };
    expect(row).toMatchObject({
      kind: "session_capabilities",
      user_id: "u1",
      value: { elicitation: true },
    });
    expect(row.key).toMatch(/^session:u1:[A-Za-z0-9_-]{43}$/);
    expect(row.key).not.toContain(sessionId);
    expect(upsert?.[2]).toEqual({ onConflict: "key" });
  });

  it("throws when the capabilities cannot be stored", async () => {
    const state = createSupabaseSharedState();
    db.results = [{ error: { message: "down" } }];
    await expect(
      state.setSessionCapabilities("u1", "s1", { elicitation: true }, 60_000),
    ).rejects.toThrow("Could not store the session capabilities");
  });

  it("reads live session capabilities and treats errors as none (fail closed)", async () => {
    const state = createSupabaseSharedState();
    db.results = [
      { data: { value: { elicitation: true } }, error: null },
      { data: null, error: { message: "down" } },
    ];
    await expect(state.getSessionCapabilities("u1", "s1")).resolves.toEqual({ elicitation: true });
    expect(db.calls.map(([method]) => method)).toEqual(["select", "eq", "gt", "maybeSingle"]);
    await expect(state.getSessionCapabilities("u1", "s1")).resolves.toBeNull();
  });

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
