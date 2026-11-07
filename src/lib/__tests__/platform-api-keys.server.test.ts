import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  calls: [] as Array<[string, ...unknown[]]>,
  results: [] as Array<{ data?: unknown; error?: unknown; count?: number }>,
  deleteUser: vi.fn(),
  storageList: vi.fn(),
  storageRemove: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const builder = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of [
      "select",
      "insert",
      "update",
      "delete",
      "eq",
      "is",
      "order",
      "single",
      "maybeSingle",
    ]) {
      chain[method] = (...args: unknown[]) => {
        db.calls.push([`${table}.${method}`, ...args]);
        return chain;
      };
    }
    chain.then = (resolve: (value: unknown) => unknown) =>
      Promise.resolve(db.results.shift() ?? { data: null, error: null }).then(resolve);
    return chain;
  };
  return {
    supabaseAdmin: {
      from: (table: string) => builder(table),
      auth: { admin: { deleteUser: db.deleteUser } },
      storage: {
        from: (bucket: string) => ({
          list: (...args: unknown[]) => {
            db.calls.push([`storage.${bucket}.list`, ...args]);
            return db.storageList(...args);
          },
          remove: (...args: unknown[]) => {
            db.calls.push([`storage.${bucket}.remove`, ...args]);
            return db.storageRemove(...args);
          },
        }),
      },
    },
  };
});

import { createApiKey, revokeApiKey } from "../platform-api-keys.server";
import { deleteOwnAccount, deleteUserAccount } from "../account-deletion.server";

beforeEach(() => {
  db.calls = [];
  db.results = [];
  db.deleteUser.mockReset().mockResolvedValue({ error: null });
  db.storageList.mockReset().mockResolvedValue({ data: [], error: null });
  db.storageRemove.mockReset().mockResolvedValue({ data: [], error: null });
});

function call(name: string) {
  return db.calls.find(([method]) => method === name);
}

describe("platform API keys", () => {
  it("stores only the hash and prefix and returns the full key once", async () => {
    db.results = [
      { count: 0, error: null },
      { data: { id: "k1", name: "Laptop", key_prefix: "nmcp_abcdefg" }, error: null },
    ];

    const { key, secret } = await createApiKey("user-1", " Laptop ");

    const inserted = call("platform_api_keys.insert")?.[1] as Record<string, string>;
    expect(secret).toMatch(/^nmcp_[A-Za-z0-9_-]{40,}$/);
    expect(inserted).toMatchObject({ user_id: "user-1", name: "Laptop" });
    expect(inserted.key_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(inserted.key_prefix).toBe(secret.slice(0, 12));
    expect(JSON.stringify(inserted)).not.toContain(secret);
    expect(key).toEqual({ id: "k1", name: "Laptop", key_prefix: "nmcp_abcdefg" });
  });

  it("caps active keys and requires a name", async () => {
    await expect(createApiKey("user-1", "")).rejects.toMatchObject({ status: 400 });
    db.results = [{ count: 20, error: null }];
    await expect(createApiKey("user-1", "One more")).rejects.toMatchObject({ status: 409 });
  });

  it("revokes only the caller's active key", async () => {
    db.results = [{ data: [], error: null }];
    await expect(revokeApiKey("user-2", "k1")).rejects.toMatchObject({ status: 404 });
    expect(db.calls).toContainEqual(["platform_api_keys.eq", "user_id", "user-2"]);
    expect(db.calls).toContainEqual(["platform_api_keys.is", "revoked_at", null]);
  });
});

describe("account deletion", () => {
  const user = { userId: "user-1", email: "Ada@Example.com" };

  it("requires the account email to be typed", async () => {
    await expect(deleteOwnAccount(user, "someone@else.com")).rejects.toMatchObject({ status: 400 });
    await expect(deleteOwnAccount(user, undefined)).rejects.toMatchObject({ status: 400 });
    expect(db.deleteUser).not.toHaveBeenCalled();
  });

  it("refuses while a paid subscription is running", async () => {
    db.results = [{ data: { tier: "pro", status: "active" }, error: null }];
    await expect(deleteOwnAccount(user, "ada@example.com")).rejects.toMatchObject({ status: 409 });
    expect(call("account_deletion_requests.insert")).toBeUndefined();
    expect(db.deleteUser).not.toHaveBeenCalled();
  });

  it("records the request, deletes the data, then the sign-in", async () => {
    db.results = [
      { data: { tier: "free", status: "active" }, error: null },
      { data: { id: "req-1" }, error: null },
      ...Array.from({ length: 6 }, () => ({ error: null })),
      { error: null },
    ];

    await deleteOwnAccount(user, " ada@example.com ");

    expect(call("account_deletion_requests.insert")?.[1]).toEqual({
      user_id: "user-1",
      reason: "self-service",
    });
    expect(db.deleteUser).toHaveBeenCalledWith("user-1");
    expect(call("account_deletion_requests.update")?.[1]).toMatchObject({
      processed_at: expect.any(String),
    });
  });

  it("deletes support tickets explicitly (no cascade from auth.users) and their uploads", async () => {
    db.storageList.mockImplementation(async (prefix: string) => ({
      error: null,
      data:
        prefix === "user-1"
          ? [
              { name: "ticket-a", id: null },
              { name: "stray.txt", id: "obj-0" },
            ]
          : prefix === "user-1/ticket-a"
            ? [
                { name: "log.txt", id: "obj-1" },
                { name: "shot.png", id: "obj-2" },
              ]
            : [],
    }));

    await deleteUserAccount({ userId: "user-1" });

    expect(db.calls).toContainEqual(["support_tickets.delete"]);
    expect(db.calls).toContainEqual(["support_tickets.eq", "user_id", "user-1"]);
    expect(db.storageRemove).toHaveBeenCalledExactlyOnceWith([
      "user-1/ticket-a/log.txt",
      "user-1/ticket-a/shot.png",
      "user-1/stray.txt",
    ]);
    // Uploads go before the sign-in so a storage failure keeps the account.
    expect(db.deleteUser).toHaveBeenCalledWith("user-1");
  });

  it("keeps the sign-in when the uploads cannot be removed", async () => {
    db.storageList.mockResolvedValue({ data: [{ name: "a.txt", id: "obj-1" }], error: null });
    db.storageRemove.mockResolvedValue({ data: null, error: { message: "storage down" } });

    await expect(deleteUserAccount({ userId: "user-1" })).rejects.toThrow(/storage down/);
    expect(db.deleteUser).not.toHaveBeenCalled();
  });

  it("keeps the sign-in when any data step fails", async () => {
    db.results = [{ error: null }, { error: { message: "permission denied" } }];
    const failure = deleteUserAccount({ userId: "user-1" });
    await expect(failure).rejects.toThrow(/auth user kept/);
    // The failed step is named so operators can see what was left behind.
    await expect(failure).rejects.toThrow(/permission denied/);
    expect(db.deleteUser).not.toHaveBeenCalled();
    expect(db.storageRemove).not.toHaveBeenCalled();
  });
});
