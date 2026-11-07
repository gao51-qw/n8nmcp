import { describe, expect, it, vi } from "vitest";
import {
  clearLegacySession,
  hasLegacySession,
  legacySessionKey,
  readLegacyRefreshToken,
  refreshTokenFromSessionJson,
  supabaseStorageKey,
  type CookieJar,
} from "../legacy-session";

const KEY = "sb-abcdefgh-auth-token";

/** Minimal browser cookie jar: honours Domain and Max-Age=0. */
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
      const attr = (key: string) =>
        attrs.find((a) => a.toLowerCase().startsWith(`${key.toLowerCase()}=`))?.split("=")[1];
      const domain = attr("Domain") ?? null;
      const id = `${name}|${domain ?? ""}`;
      if (attr("Max-Age") === "0") store.delete(id);
      else store.set(id, { name, value: pair.slice(index + 1), domain });
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
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
}

/** The legacy client's cookie encoding: `base64-` + base64url(JSON). */
function encode(value: string): string {
  return "base64-" + Buffer.from(value, "utf8").toString("base64url");
}

const SESSION = JSON.stringify({
  access_token: "expired-access",
  refresh_token: "legacy-refresh-1",
  user: { id: "u1", user_metadata: { name: "Zoë" } },
});

describe("legacy session key", () => {
  it("matches the supabase-js default key", () => {
    expect(supabaseStorageKey("https://abcdefgh.supabase.co")).toBe(KEY);
    expect(legacySessionKey("https://abcdefgh.supabase.co")).toBe(KEY);
    expect(legacySessionKey(undefined)).toBeNull();
    expect(legacySessionKey("not a url")).toBeNull();
  });
});

describe("readLegacyRefreshToken", () => {
  it("reads an unchunked legacy cookie", () => {
    expect(
      readLegacyRefreshToken({ key: KEY, cookieHeader: `a=1; ${KEY}=${encode(SESSION)}` }),
    ).toBe("legacy-refresh-1");
  });

  it("joins chunked legacy cookies", () => {
    const encoded = encode(SESSION);
    const header = [
      `${KEY}.1=${encoded.slice(40)}`,
      `${KEY}.0=${encoded.slice(0, 40)}`,
      "theme=dark",
    ].join("; ");
    expect(readLegacyRefreshToken({ key: KEY, cookieHeader: header })).toBe("legacy-refresh-1");
  });

  it("falls back to the localStorage session (v2 and v1 shapes)", () => {
    expect(
      readLegacyRefreshToken({
        key: KEY,
        cookieHeader: "",
        storage: memoryStorage({ [KEY]: SESSION }),
      }),
    ).toBe("legacy-refresh-1");
    expect(
      readLegacyRefreshToken({
        key: KEY,
        cookieHeader: "",
        storage: memoryStorage({
          "supabase.auth.token": JSON.stringify({ currentSession: { refresh_token: "v1-rt" } }),
        }),
      }),
    ).toBe("v1-rt");
  });

  it("ignores garbage and never throws on blocked storage", () => {
    expect(readLegacyRefreshToken({ key: KEY, cookieHeader: `${KEY}=base64-%%%` })).toBeNull();
    expect(refreshTokenFromSessionJson("{not json")).toBeNull();
    expect(refreshTokenFromSessionJson(JSON.stringify({ refresh_token: "has space" }))).toBeNull();
    const blocked = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(readLegacyRefreshToken({ key: KEY, cookieHeader: "", storage: blocked })).toBeNull();
    expect(readLegacyRefreshToken({ key: null, cookieHeader: `${KEY}=${encode(SESSION)}` })).toBe(
      null,
    );
  });
});

describe("clearLegacySession", () => {
  it("deletes every chunk on the parent domain and host-only, plus localStorage", () => {
    const { jar, store, writes } = fakeJar("dashboard.n8nworkflow.com");
    jar.write(`${KEY}.0=part0; Path=/; Max-Age=100; Domain=.n8nworkflow.com`);
    jar.write(`${KEY}.1=part1; Path=/; Max-Age=100; Domain=.n8nworkflow.com`);
    jar.write(`${KEY}.0=hostonly; Path=/; Max-Age=100`);
    jar.write(`${KEY}-code-verifier=v; Path=/; Max-Age=100`);
    jar.write("theme=dark; Path=/; Max-Age=100");
    const storage = memoryStorage({ [KEY]: SESSION, "sb-other-auth-token": "{}", keep: "1" });
    expect(hasLegacySession({ key: KEY, cookieHeader: jar.read(), storage })).toBe(true);

    clearLegacySession({ key: KEY, jar, storage, domain: ".n8nworkflow.com", secure: true });

    expect(Array.from(store.values()).map((c) => c.name)).toEqual(["theme"]);
    expect(storage.data.has(KEY)).toBe(false);
    expect(storage.data.has("sb-other-auth-token")).toBe(false);
    expect(storage.data.get("keep")).toBe("1");
    expect(writes.filter((w) => w.includes("Max-Age=0")).every((w) => w.includes("Secure"))).toBe(
      true,
    );
    expect(hasLegacySession({ key: KEY, cookieHeader: jar.read(), storage })).toBe(false);
  });

  it("never throws when the cookie jar or storage is blocked", () => {
    const jar: CookieJar = {
      read: () => {
        throw new Error("blocked");
      },
      write: () => {
        throw new Error("blocked");
      },
    };
    expect(() => clearLegacySession({ key: KEY, jar, storage: null, secure: false })).not.toThrow();
  });
});
