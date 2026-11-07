import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  results: [] as Array<{ data?: unknown; error?: unknown; count?: number }>,
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const builder = () => {
    const chain: Record<string, unknown> = {};
    for (const method of [
      "select",
      "eq",
      "order",
      "insert",
      "update",
      "delete",
      "single",
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
  return {
    supabaseAdmin: {
      from: (table: string) => (db.calls.push(["from", table]), builder()),
      rpc: (fn: string, args: unknown) => {
        db.calls.push(["rpc", fn, args]);
        return Promise.resolve(db.results.shift() ?? { data: null, error: null });
      },
    },
  };
});

vi.mock("@/lib/crypto.server", () => ({
  encryptSecret: (plain: string) => ({ ciphertext: `enc(${plain})`, iv: "iv", tag: "tag" }),
  decryptSecret: ({ ciphertext }: { ciphertext: string }) => {
    const match = /^enc\((.*)\)$/.exec(ciphertext);
    if (!match) throw new Error("Unsupported state or unable to authenticate data");
    return match[1];
  },
}));

vi.mock("@/lib/ssrf-guard.server", () => ({ safeFetchPublicUrl: vi.fn() }));

import {
  checkN8nApiKey,
  createInstance,
  deleteInstance,
  InstanceError,
  listInstances,
  normalizeBaseUrl,
  recheckInstance,
  setDefaultInstance,
  setNativeMcpToken,
} from "../n8n-instances.server";
import { NativeMcpError } from "../n8n-native-mcp.server";

const row = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Prod",
  base_url: "https://n8n.example.com",
  status: "ok",
  last_checked_at: "now",
  created_at: "then",
  is_default: true,
  mcp_token_encrypted: "enc(token)",
  mcp_capabilities: { tools: ["execute_workflow"] },
  mcp_checked_at: "now",
};

const okFetch = vi.fn(async () => new Response("{}", { status: 200 }));
const discover = vi.fn(async () => ({
  protocolVersion: "2025-03-26",
  tools: ["execute_workflow"],
  checkedAt: "now",
}));

beforeEach(() => {
  db.calls = [];
  db.results = [];
  vi.clearAllMocks();
});

function inserted() {
  return db.calls.find(([method]) => method === "insert")?.[1] as Record<string, unknown>;
}

describe("normalizeBaseUrl", () => {
  it.each([
    ["https://n8n.example.com/", "https://n8n.example.com"],
    ["https://n8n.example.com/api/v1", "https://n8n.example.com"],
    ["https://example.com/n8n/", "https://example.com/n8n"],
  ])("%s → %s", (input, expected) => {
    expect(normalizeBaseUrl(input)).toBe(expected);
  });

  it.each([
    "",
    "ftp://n8n.example.com",
    "https://user:pw@n8n.example.com",
    "https://n8n.example.com/?x=1",
    "not a url",
  ])("rejects %j", (input) => {
    expect(() => normalizeBaseUrl(input)).toThrow(InstanceError);
  });
});

describe("checkN8nApiKey", () => {
  it("calls the Public API with the key and maps a rejection", async () => {
    const reject = vi.fn(async () => new Response("", { status: 401 }));
    await expect(checkN8nApiKey("https://n8n.example.com", "key", reject)).rejects.toThrow(
      /rejected the API key/,
    );
    expect(reject).toHaveBeenCalledWith(
      "https://n8n.example.com/api/v1/workflows?limit=1",
      expect.objectContaining({ headers: expect.objectContaining({ "X-N8N-API-KEY": "key" }) }),
    );
  });
});

describe("createInstance", () => {
  it("checks the key and the MCP token, then stores both encrypted", async () => {
    db.results = [
      { count: 0, error: null },
      { data: row, error: null },
    ];

    const instance = await createInstance(
      "user-1",
      { name: "Prod", base_url: "https://n8n.example.com/", api_key: "key", mcp_token: "token" },
      { fetchImpl: okFetch, discover },
    );

    expect(okFetch).toHaveBeenCalled();
    expect(discover).toHaveBeenCalledWith(
      expect.objectContaining({ baseUrl: "https://n8n.example.com", token: "token" }),
    );
    expect(inserted()).toMatchObject({
      user_id: "user-1",
      base_url: "https://n8n.example.com",
      api_key_encrypted: "enc(key)",
      mcp_token_encrypted: "enc(token)",
      mcp_capabilities: { protocolVersion: "2025-03-26", tools: ["execute_workflow"] },
    });
    expect(JSON.stringify(instance)).not.toMatch(/enc\(|"key"|"token"/);
    expect(instance.native_mcp).toEqual({
      configured: true,
      tools: ["execute_workflow"],
      checked_at: "now",
    });
  });

  it("does not store anything when the MCP token is rejected", async () => {
    db.results = [{ count: 0, error: null }];
    const rejected = vi.fn(async () => {
      throw new NativeMcpError("unauthorized", "nope");
    });

    await expect(
      createInstance(
        "user-1",
        { name: "Prod", base_url: "https://n8n.example.com", api_key: "key", mcp_token: "bad" },
        { fetchImpl: okFetch, discover: rejected },
      ),
    ).rejects.toThrow(/rejected the MCP access token/);
    expect(inserted()).toBeUndefined();
  });

  it("enforces the per-account limit", async () => {
    db.results = [{ count: 20, error: null }];
    await expect(
      createInstance(
        "user-1",
        { name: "x", base_url: "https://n8n.example.com", api_key: "k" },
        { fetchImpl: okFetch },
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(okFetch).not.toHaveBeenCalled();
  });
});

describe("setNativeMcpToken and deleteInstance", () => {
  it("clears the token and its capabilities", async () => {
    db.results = [
      { data: { id: row.id, base_url: row.base_url }, error: null },
      { data: { ...row, mcp_token_encrypted: null, mcp_capabilities: {} }, error: null },
    ];

    const instance = await setNativeMcpToken("user-1", row.id, null, { discover });

    expect(discover).not.toHaveBeenCalled();
    expect(db.calls.find(([method]) => method === "update")?.[1]).toMatchObject({
      mcp_token_encrypted: null,
      mcp_token_iv: null,
      mcp_token_tag: null,
      mcp_capabilities: {},
    });
    expect(instance.native_mcp.configured).toBe(false);
  });

  it("refuses instances of other users", async () => {
    db.results = [{ data: null, error: null }];
    await expect(setNativeMcpToken("user-2", row.id, "token", { discover })).rejects.toMatchObject({
      status: 404,
    });
    expect(db.calls).toContainEqual(["eq", "user_id", "user-2"]);
  });

  it("deletes through the database function", async () => {
    db.results = [{ data: true, error: null }];

    await expect(deleteInstance("user-1", row.id)).resolves.toBeUndefined();

    expect(db.calls).toEqual([
      ["rpc", "delete_n8n_instance", { _user_id: "user-1", _instance_id: row.id }],
    ]);
  });

  it("reports deleting an unknown instance as not found", async () => {
    db.results = [{ data: false, error: null }];
    await expect(deleteInstance("user-1", row.id)).rejects.toMatchObject({ status: 404 });
  });

  it("fails closed when the database function errors", async () => {
    db.results = [{ data: null, error: { code: "42501", message: "denied" } }];
    await expect(deleteInstance("user-1", row.id)).rejects.toMatchObject({
      status: 500,
      message: "Could not delete the instance",
    });
    expect(db.calls.some(([method]) => method === "delete")).toBe(false);
  });

  it("deletes the row directly while the database function does not exist yet", async () => {
    db.results = [
      { data: null, error: { code: "PGRST202", message: "missing" } },
      { data: [{ id: row.id }], error: null },
    ];

    await deleteInstance("user-1", row.id);

    expect(db.calls).toContainEqual(["delete"]);
    expect(db.calls).toContainEqual(["eq", "id", row.id]);
    expect(db.calls).toContainEqual(["eq", "user_id", "user-1"]);
  });
});

describe("retrying lost database races", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const deadlock = { data: null, error: { code: "40P01", message: "deadlock detected" } };
  const serialization = {
    data: null,
    error: { code: "40001", message: "could not serialize access" },
  };
  const rpcCalls = () => db.calls.filter(([method]) => method === "rpc");

  it.each([
    ["a deadlock", deadlock],
    ["a serialization failure", serialization],
  ])("retries set_default once after %s", async (_label, conflict) => {
    db.results = [conflict, { data: true, error: null }, { data: row, error: null }];

    const pending = setDefaultInstance("user-1", row.id);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toMatchObject({ id: row.id, is_default: true });
    expect(rpcCalls()).toHaveLength(2);
  });

  it.each([
    ["a deadlock", deadlock],
    ["a serialization failure", serialization],
  ])("retries delete once after %s", async (_label, conflict) => {
    db.results = [conflict, { data: true, error: null }];

    const pending = deleteInstance("user-1", row.id);
    await vi.runAllTimersAsync();

    await expect(pending).resolves.toBeUndefined();
    expect(rpcCalls()).toEqual([
      ["rpc", "delete_n8n_instance", { _user_id: "user-1", _instance_id: row.id }],
      ["rpc", "delete_n8n_instance", { _user_id: "user-1", _instance_id: row.id }],
    ]);
  });

  it("waits a short jittered pause before the retry", async () => {
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    db.results = [deadlock, { data: true, error: null }];

    const pending = deleteInstance("user-1", row.id);
    await vi.advanceTimersByTimeAsync(49);
    expect(rpcCalls()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(rpcCalls()).toHaveLength(2);
    random.mockRestore();
  });

  it("retries only once and then fails closed", async () => {
    db.results = [deadlock, deadlock];

    const pending = setDefaultInstance("user-1", row.id);
    const outcome = expect(pending).rejects.toMatchObject({
      status: 500,
      message: "Could not change the MCP instance",
    });
    await vi.runAllTimersAsync();
    await outcome;
    expect(rpcCalls()).toHaveLength(2);
  });

  it("does not retry other errors", async () => {
    db.results = [{ data: null, error: { code: "23505", message: "duplicate" } }];

    await expect(deleteInstance("user-1", row.id)).rejects.toMatchObject({ status: 500 });
    expect(rpcCalls()).toHaveLength(1);
  });

  it("reports a retried delete of an instance that is gone as not found", async () => {
    db.results = [deadlock, { data: false, error: null }];

    const pending = deleteInstance("user-1", row.id);
    const outcome = expect(pending).rejects.toMatchObject({ status: 404 });
    await vi.runAllTimersAsync();
    await outcome;
  });
});

describe("default instance", () => {
  it("lists is_default for every instance", async () => {
    db.results = [
      {
        data: [row, { ...row, id: "22222222-2222-2222-2222-222222222222", is_default: false }],
        error: null,
      },
    ];

    const instances = await listInstances("user-1");

    expect(instances.map((instance) => instance.is_default)).toEqual([true, false]);
    expect(String(db.calls.find(([method]) => method === "select")?.[1])).toContain("is_default");
  });

  it("reads a missing is_default as not the default", async () => {
    const { is_default: _ignored, ...legacy } = row;
    db.results = [{ data: [legacy], error: null }];

    const [instance] = await listInstances("user-1");

    expect(instance.is_default).toBe(false);
  });

  it("switches the default through the database function and returns the instance", async () => {
    db.results = [
      { data: true, error: null },
      { data: row, error: null },
    ];

    const instance = await setDefaultInstance("user-1", row.id);

    expect(db.calls).toContainEqual([
      "rpc",
      "set_default_n8n_instance",
      { _user_id: "user-1", _instance_id: row.id },
    ]);
    expect(db.calls).toContainEqual(["eq", "user_id", "user-1"]);
    expect(instance).toMatchObject({ id: row.id, is_default: true });
    expect(JSON.stringify(instance)).not.toMatch(/enc\(/);
  });

  it("reports an instance of another user as not found", async () => {
    db.results = [{ data: false, error: null }];

    await expect(setDefaultInstance("user-2", row.id)).rejects.toMatchObject({ status: 404 });
    expect(db.calls.some(([method]) => method === "from")).toBe(false);
  });

  it("fails closed when the database function errors", async () => {
    db.results = [{ data: null, error: { code: "PGRST202", message: "missing" } }];

    await expect(setDefaultInstance("user-1", row.id)).rejects.toMatchObject({
      status: 500,
      message: "Could not change the MCP instance",
    });
  });
});

describe("recheckInstance", () => {
  const stored = {
    id: row.id,
    base_url: row.base_url,
    api_key_encrypted: "enc(key)",
    api_key_iv: "iv",
    api_key_tag: "tag",
  };

  function updated() {
    return db.calls.find(([method]) => method === "update")?.[1] as Record<string, unknown>;
  }

  it("records a working key as ok with a fresh check time", async () => {
    db.results = [
      { data: stored, error: null },
      { data: { ...row, status: "ok" }, error: null },
    ];

    const result = await recheckInstance("user-1", row.id, { fetchImpl: okFetch });

    expect(okFetch).toHaveBeenCalledWith(
      "https://n8n.example.com/api/v1/workflows?limit=1",
      expect.objectContaining({ headers: expect.objectContaining({ "X-N8N-API-KEY": "key" }) }),
    );
    expect(updated()).toMatchObject({ status: "ok", last_checked_at: expect.any(String) });
    expect(result.error).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/enc\(|"key"/);
  });

  it("records a rejected key as error and returns the reason", async () => {
    db.results = [
      { data: stored, error: null },
      { data: { ...row, status: "error" }, error: null },
    ];
    const reject = vi.fn(async () => new Response("", { status: 401 }));

    const result = await recheckInstance("user-1", row.id, { fetchImpl: reject });

    expect(updated()).toMatchObject({ status: "error" });
    expect(result).toMatchObject({
      error: "n8n rejected the API key",
      instance: { status: "error" },
    });
  });

  it("refuses instances of other users and unreadable keys", async () => {
    db.results = [{ data: null, error: null }];
    await expect(recheckInstance("user-2", row.id, { fetchImpl: okFetch })).rejects.toMatchObject({
      status: 404,
    });

    db.results = [{ data: { ...stored, api_key_encrypted: "garbage" }, error: null }];
    await expect(recheckInstance("user-1", row.id, { fetchImpl: okFetch })).rejects.toMatchObject({
      status: 500,
      message: expect.stringContaining("can no longer be read"),
    });
    expect(okFetch).not.toHaveBeenCalled();
  });
});
