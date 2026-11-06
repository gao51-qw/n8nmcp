import { describe, expect, it, vi } from "vitest";
import {
  AUTH_COOKIE_MAX_AGE_SECONDS,
  createChunkedCookieStorage,
  sharedCookieDomain,
  supabaseStorageKey,
  type CookieJar,
} from "../client";

/** Minimal browser cookie jar: honours Domain, Max-Age=0 and Secure. */
function fakeJar(host: string) {
  const store = new Map<string, { name: string; value: string; domain: string | null }>();
  const writes: string[] = [];
  const jar: CookieJar = {
    read: () =>
      Array.from(store.values())
        .filter((c) => !c.domain || host === c.domain.slice(1) || host.endsWith(c.domain))
        .map((c) => `${c.name}=${c.value}`)
        .join("; "),
    write: (cookie) => {
      writes.push(cookie);
      const [pair, ...attrs] = cookie.split(";").map((part) => part.trim());
      const index = pair.indexOf("=");
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      const attr = (key: string) =>
        attrs.find((a) => a.toLowerCase().startsWith(`${key.toLowerCase()}=`))?.split("=")[1];
      const domain = attr("Domain") ?? null;
      const id = `${name}|${domain ?? ""}`;
      if (attr("Max-Age") === "0") store.delete(id);
      else store.set(id, { name, value, domain });
    },
  };
  return { jar, store, writes };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: vi.fn((key: string) => data.get(key) ?? null),
    removeItem: vi.fn((key: string) => void data.delete(key)),
  };
}

const KEY = "sb-abcdefgh-auth-token";
const PRODUCTION_HOSTS = [
  "mcp.n8nworkflow.com",
  "docs.n8nworkflow.com",
  "blog.n8nworkflow.com",
  "dashboard.n8nworkflow.com",
];

describe("sharedCookieDomain", () => {
  it("uses the parent domain shared by every surface", () => {
    expect(sharedCookieDomain(PRODUCTION_HOSTS, "dashboard.n8nworkflow.com")).toBe(
      ".n8nworkflow.com",
    );
    expect(sharedCookieDomain(PRODUCTION_HOSTS, "docs.n8nworkflow.com")).toBe(".n8nworkflow.com");
    expect(
      sharedCookieDomain(["app.eu.example.com", "docs.eu.example.com"], "app.eu.example.com"),
    ).toBe(".eu.example.com");
    expect(sharedCookieDomain(["example.com", "dashboard.example.com"], "example.com")).toBe(
      ".example.com",
    );
  });

  it("falls back to a host-only cookie for local and single-origin setups", () => {
    expect(sharedCookieDomain(["localhost", "localhost"], "localhost")).toBeUndefined();
    expect(sharedCookieDomain(PRODUCTION_HOSTS, "localhost")).toBeUndefined();
    expect(sharedCookieDomain(PRODUCTION_HOSTS, "127.0.0.1")).toBeUndefined();
    expect(
      sharedCookieDomain(["app.test.localhost", "docs.test.localhost"], "app.test.localhost"),
    ).toBeUndefined();
    expect(sharedCookieDomain(["mcp.example.com"], "mcp.example.com")).toBeUndefined();
  });

  it("refuses a suffix that is too broad or does not contain the page", () => {
    // Only the TLD is shared: Domain=.com would be rejected by the browser.
    expect(sharedCookieDomain(["a.example.com", "b.other.com"], "a.example.com")).toBeUndefined();
    // A preview host outside the configured domain keeps a host-only cookie.
    expect(sharedCookieDomain(PRODUCTION_HOSTS, "preview.vercel-like.app")).toBeUndefined();
    expect(sharedCookieDomain(PRODUCTION_HOSTS, "eviln8nworkflow.com")).toBeUndefined();
  });
});

describe("supabaseStorageKey", () => {
  it("matches the supabase-js default key so old sessions are found", () => {
    expect(supabaseStorageKey("https://abcdefgh.supabase.co")).toBe(KEY);
  });
});

describe("createChunkedCookieStorage", () => {
  it("writes Lax, Secure, Path=/ cookies on the shared domain with a max-age", () => {
    const { jar, writes } = fakeJar("dashboard.n8nworkflow.com");
    const storage = createChunkedCookieStorage({ domain: ".n8nworkflow.com", secure: true, jar });

    storage.setItem(KEY, '{"access_token":"a"}');

    const cookie = writes.find((w) => w.startsWith(`${KEY}=base64-`));
    expect(cookie).toBeDefined();
    expect(cookie).toContain("; Path=/");
    expect(cookie).toContain("; SameSite=Lax");
    expect(cookie).toContain("; Domain=.n8nworkflow.com");
    expect(cookie).toContain("; Secure");
    expect(cookie).toContain(`; Max-Age=${AUTH_COOKIE_MAX_AGE_SECONDS}`);
  });

  it("omits Domain and Secure for a local http origin", () => {
    const { jar, writes } = fakeJar("localhost");
    const storage = createChunkedCookieStorage({ secure: false, jar });

    storage.setItem(KEY, "{}");

    expect(writes.every((w) => !w.includes("Domain="))).toBe(true);
    expect(writes.every((w) => !w.includes("Secure"))).toBe(true);
  });

  it("round-trips unicode values and shares them with sibling subdomains", () => {
    const dashboard = fakeJar("dashboard.n8nworkflow.com");
    const storage = createChunkedCookieStorage({
      domain: ".n8nworkflow.com",
      secure: true,
      jar: dashboard.jar,
    });
    const value = JSON.stringify({ user: { name: "Zoë ✓ 名前" }, access_token: "x" });

    storage.setItem(KEY, value);
    expect(storage.getItem(KEY)).toBe(value);

    // A second jar view from docs. sees the same domain cookies.
    const docsJar: CookieJar = {
      read: () =>
        Array.from(dashboard.store.values())
          .filter((c) => c.domain === ".n8nworkflow.com")
          .map((c) => `${c.name}=${c.value}`)
          .join("; "),
      write: dashboard.jar.write,
    };
    const docs = createChunkedCookieStorage({
      domain: ".n8nworkflow.com",
      secure: true,
      jar: docsJar,
    });
    expect(docs.getItem(KEY)).toBe(value);
  });

  it("chunks values larger than one cookie and cleans stale chunks", () => {
    const { jar, store } = fakeJar("dashboard.n8nworkflow.com");
    const storage = createChunkedCookieStorage({
      domain: ".n8nworkflow.com",
      secure: true,
      jar,
      chunkSize: 100,
    });
    const big = JSON.stringify({ access_token: "a".repeat(900), refresh_token: "r" });

    storage.setItem(KEY, big);
    const names = Array.from(store.values()).map((c) => c.name);
    expect(names).not.toContain(KEY);
    expect(names.length).toBeGreaterThan(5);
    expect(names.every((n) => /\.\d+$/.test(n))).toBe(true);
    expect(Array.from(store.values()).every((c) => c.value.length <= 100)).toBe(true);
    expect(storage.getItem(KEY)).toBe(big);

    // Shrinking back to one cookie removes every chunk.
    storage.setItem(KEY, "{}");
    expect(Array.from(store.values()).map((c) => c.name)).toEqual([KEY]);
    expect(storage.getItem(KEY)).toBe("{}");
  });

  it("keeps real sessions under the browser cookie limit per chunk", () => {
    const { jar, writes } = fakeJar("dashboard.n8nworkflow.com");
    const storage = createChunkedCookieStorage({ domain: ".n8nworkflow.com", secure: true, jar });

    storage.setItem(KEY, JSON.stringify({ access_token: "a".repeat(6000) }));

    for (const cookie of writes) {
      const pair = cookie.split(";")[0];
      expect(pair.length).toBeLessThan(4096);
    }
    expect(storage.getItem(KEY)).toContain("a".repeat(6000));
  });

  it("removes every chunk, host-only leftovers and the legacy copy on removeItem", () => {
    const { jar, store } = fakeJar("dashboard.n8nworkflow.com");
    const legacy = memoryStorage({ [KEY]: "old" });
    const storage = createChunkedCookieStorage({
      domain: ".n8nworkflow.com",
      secure: true,
      jar,
      chunkSize: 50,
      legacyStorage: legacy,
    });
    storage.setItem(KEY, "x".repeat(400));
    // A host-only cookie from before the migration.
    jar.write(`${KEY}=base64-e30; Path=/`);

    storage.removeItem(KEY);

    expect(store.size).toBe(0);
    expect(legacy.data.has(KEY)).toBe(false);
    expect(storage.getItem(KEY)).toBeNull();
  });

  it("returns null for tampered or unencoded cookie values", () => {
    const { jar } = fakeJar("dashboard.n8nworkflow.com");
    const storage = createChunkedCookieStorage({ secure: true, jar });

    jar.write(`${KEY}=not-base64; Path=/`);
    expect(storage.getItem(KEY)).toBeNull();
    jar.write(`${KEY}=base64-%%%; Path=/`);
    expect(storage.getItem(KEY)).toBeNull();
  });

  it("rejects keys that are not safe cookie names", () => {
    const storage = createChunkedCookieStorage({ secure: true, jar: fakeJar("x.example.com").jar });
    expect(() => storage.setItem("bad key;", "v")).toThrow();
  });

  describe("localStorage migration", () => {
    it("moves an existing localStorage session into the cookie once", () => {
      const { jar } = fakeJar("dashboard.n8nworkflow.com");
      const session = JSON.stringify({ access_token: "a", refresh_token: "r" });
      const legacy = memoryStorage({ [KEY]: session });
      const storage = createChunkedCookieStorage({
        domain: ".n8nworkflow.com",
        secure: true,
        jar,
        legacyStorage: legacy,
      });

      expect(storage.getItem(KEY)).toBe(session);
      expect(legacy.data.has(KEY)).toBe(false);

      // The next read comes from the cookie, not localStorage.
      legacy.getItem.mockClear();
      expect(storage.getItem(KEY)).toBe(session);
      expect(legacy.getItem).not.toHaveBeenCalled();
    });

    it("prefers an existing cookie session over a stale localStorage one", () => {
      const { jar } = fakeJar("dashboard.n8nworkflow.com");
      const legacy = memoryStorage({ [KEY]: "stale" });
      const storage = createChunkedCookieStorage({ secure: true, jar, legacyStorage: legacy });
      storage.setItem(KEY, "fresh");

      expect(storage.getItem(KEY)).toBe("fresh");
      expect(legacy.getItem).not.toHaveBeenCalled();
    });

    it("keeps the localStorage copy when the browser refuses the cookie", () => {
      const refusing: CookieJar = { read: () => "", write: () => undefined };
      const legacy = memoryStorage({ [KEY]: "session" });
      const storage = createChunkedCookieStorage({
        secure: true,
        jar: refusing,
        legacyStorage: legacy,
      });

      expect(storage.getItem(KEY)).toBe("session");
      expect(legacy.data.get(KEY)).toBe("session");
    });

    it("survives blocked localStorage", () => {
      const { jar } = fakeJar("dashboard.n8nworkflow.com");
      const storage = createChunkedCookieStorage({
        secure: true,
        jar,
        legacyStorage: {
          getItem: () => {
            throw new Error("SecurityError");
          },
          removeItem: () => {
            throw new Error("SecurityError");
          },
        },
      });

      expect(storage.getItem(KEY)).toBeNull();
      expect(() => storage.removeItem(KEY)).not.toThrow();
    });
  });
});
