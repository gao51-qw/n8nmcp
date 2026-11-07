// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CookieJar } from "../legacy-session";

const SUPABASE_URL = "https://abcdefgh.supabase.co";
const KEY = "sb-abcdefgh-auth-token";
const SESSION = JSON.stringify({ access_token: "old", refresh_token: "legacy-rt" });
const EXCHANGED = {
  access_token: "fresh-access",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "u1" },
};

function encode(value: string): string {
  return "base64-" + Buffer.from(value, "utf8").toString("base64url");
}

/** A cookie jar that honours Max-Age=0, like document.cookie. */
function memoryJar(initial: Record<string, string> = {}) {
  const cookies = new Map(Object.entries(initial));
  const jar: CookieJar = {
    read: () => Array.from(cookies, ([name, value]) => `${name}=${value}`).join("; "),
    write: (cookie) => {
      const [pair, ...attributes] = cookie.split(";").map((part) => part.trim());
      const index = pair.indexOf("=");
      if (attributes.includes("Max-Age=0")) cookies.delete(pair.slice(0, index));
      else cookies.set(pair.slice(0, index), pair.slice(index + 1));
    },
  };
  return { jar, cookies };
}

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    removeItem: (key: string) => void data.delete(key),
    key: (index: number) => Array.from(data.keys())[index] ?? null,
    get length() {
      return data.size;
    },
  };
}

async function load() {
  vi.resetModules();
  return import("../browser-session.client");
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("bootstrapBrowserSession", () => {
  it("exchanges an email-link fragment and strips it from the address bar first", async () => {
    window.history.replaceState(
      null,
      "",
      "/auth/callback?next=%2Fdashboard#access_token=link-access&refresh_token=link-rt&type=signup",
    );
    const { bootstrapBrowserSession, getEmailLinkStatus } = await load();
    let hashDuringExchange = "unset";
    const exchange = vi.fn(async () => {
      hashDuringExchange = window.location.hash;
      return EXCHANGED as never;
    });

    const session = await bootstrapBrowserSession({
      jar: memoryJar().jar,
      storage: memoryStorage(),
      supabaseUrl: SUPABASE_URL,
      exchange,
    });

    expect(exchange).toHaveBeenCalledWith({
      access_token: "link-access",
      refresh_token: "link-rt",
    });
    expect(hashDuringExchange).toBe("");
    expect(window.location.pathname + window.location.search).toBe(
      "/auth/callback?next=%2Fdashboard",
    );
    expect(session?.access_token).toBe("fresh-access");
    expect(getEmailLinkStatus()).toBe("exchanged");
  });

  it("reports a rejected email link", async () => {
    window.history.replaceState(null, "", "/reset-password#access_token=a&refresh_token=b");
    const { bootstrapBrowserSession, getEmailLinkStatus } = await load();

    const session = await bootstrapBrowserSession({
      jar: memoryJar().jar,
      storage: memoryStorage(),
      supabaseUrl: SUPABASE_URL,
      exchange: vi.fn(async () => {
        throw new Error("401");
      }),
    });

    expect(session).toBeNull();
    expect(getEmailLinkStatus()).toBe("failed");
    expect(window.location.hash).toBe("");
  });

  it("migrates a legacy chunked cookie once and deletes every chunk", async () => {
    const encoded = encode(SESSION);
    const { jar, cookies } = memoryJar({
      [`${KEY}.0`]: encoded.slice(0, 20),
      [`${KEY}.1`]: encoded.slice(20),
      theme: "dark",
    });
    const { bootstrapBrowserSession } = await load();
    const exchange = vi.fn(async () => EXCHANGED as never);

    const session = await bootstrapBrowserSession({
      jar,
      storage: memoryStorage(),
      supabaseUrl: SUPABASE_URL,
      exchange,
    });

    expect(exchange).toHaveBeenCalledWith({ refresh_token: "legacy-rt" });
    expect(session?.access_token).toBe("fresh-access");
    expect(Array.from(cookies.keys())).toEqual(["theme"]);
  });

  it("migrates a localStorage session and removes it", async () => {
    const storage = memoryStorage({ [KEY]: SESSION });
    const { bootstrapBrowserSession } = await load();
    const exchange = vi.fn(async () => EXCHANGED as never);

    await bootstrapBrowserSession({
      jar: memoryJar().jar,
      storage,
      supabaseUrl: SUPABASE_URL,
      exchange,
    });

    expect(exchange).toHaveBeenCalledWith({ refresh_token: "legacy-rt" });
    expect(storage.data.size).toBe(0);
  });

  it("still deletes the legacy copies when the exchange is rejected (401)", async () => {
    const { jar, cookies } = memoryJar({ [KEY]: encode(SESSION) });
    const storage = memoryStorage({ [KEY]: SESSION });
    const { bootstrapBrowserSession } = await load();

    const session = await bootstrapBrowserSession({
      jar,
      storage,
      supabaseUrl: SUPABASE_URL,
      exchange: vi.fn(async () => {
        throw new Error("401");
      }),
    });

    expect(session).toBeNull();
    expect(cookies.size).toBe(0);
    expect(storage.data.size).toBe(0);
  });

  it("does nothing without a fragment or legacy session", async () => {
    const { bootstrapBrowserSession } = await load();
    const exchange = vi.fn();
    expect(
      await bootstrapBrowserSession({
        jar: memoryJar({ theme: "dark" }).jar,
        storage: memoryStorage(),
        supabaseUrl: SUPABASE_URL,
        exchange,
      }),
    ).toBeNull();
    expect(exchange).not.toHaveBeenCalled();
  });
});

describe("signOut", () => {
  it("posts the access token to /api/auth/logout and clears the in-memory session", async () => {
    const fetchMock = vi.fn(async () => Response.json({ ok: true, revoked: true }));
    vi.stubGlobal("fetch", fetchMock);
    const { authStore, signOut } = await load();
    authStore().setSession(EXCHANGED as never);

    await signOut();

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/auth/logout");
    expect(init.method).toBe("POST");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer fresh-access");
    expect(authStore().getSnapshot().session).toBeNull();
  });

  it("clears the in-memory session even when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("offline");
      }),
    );
    const { authStore, signOut } = await load();
    authStore().setSession(EXCHANGED as never);

    await signOut();

    expect(authStore().getSnapshot().session).toBeNull();
  });
});
