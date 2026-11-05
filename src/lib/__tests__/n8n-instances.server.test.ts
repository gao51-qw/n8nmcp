import { beforeEach, describe, expect, it, vi } from "vitest";

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
    supabaseAdmin: { from: (table: string) => (db.calls.push(["from", table]), builder()) },
  };
});

vi.mock("@/lib/crypto.server", () => ({
  encryptSecret: (plain: string) => ({ ciphertext: `enc(${plain})`, iv: "iv", tag: "tag" }),
}));

vi.mock("@/lib/ssrf-guard.server", () => ({ safeFetchPublicUrl: vi.fn() }));

import {
  checkN8nApiKey,
  createInstance,
  deleteInstance,
  InstanceError,
  normalizeBaseUrl,
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

  it("reports deleting an unknown instance as not found", async () => {
    db.results = [{ data: [], error: null }];
    await expect(deleteInstance("user-1", row.id)).rejects.toMatchObject({ status: 404 });
  });
});
