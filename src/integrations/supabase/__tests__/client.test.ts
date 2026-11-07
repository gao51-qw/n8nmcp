// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let token: string | null = null;
  return {
    listeners,
    setToken(next: string | null) {
      token = next;
      for (const listener of listeners) listener();
    },
    getAccessToken: vi.fn(async () => token),
    createClient: vi.fn(),
    setAuth: vi.fn(async () => undefined),
    snapshot: () => ({
      session: token ? { access_token: token, expires_at: 1, user: { id: "u" } } : null,
      loading: false,
      persisted: true,
    }),
  };
});

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/auth/browser-session.client", () => ({
  getAccessToken: mocks.getAccessToken,
  authStore: () => ({
    getSnapshot: mocks.snapshot,
    subscribe: (listener: () => void) => {
      mocks.listeners.add(listener);
      return () => mocks.listeners.delete(listener);
    },
  }),
}));

beforeEach(() => {
  vi.resetModules();
  mocks.listeners.clear();
  mocks.createClient.mockReset();
  mocks.createClient.mockReturnValue({
    realtime: { setAuth: mocks.setAuth },
    from: vi.fn(),
  });
  mocks.setAuth.mockClear();
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefgh.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "pk");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("browser Supabase client", () => {
  it("reads the access token from the in-memory store and never persists a session", async () => {
    const { supabase } = await import("../client");
    void supabase.from;

    expect(mocks.createClient).toHaveBeenCalledTimes(1);
    const [url, key, options] = mocks.createClient.mock.calls[0];
    expect(url).toBe("https://abcdefgh.supabase.co");
    expect(key).toBe("pk");
    // No auth storage options at all: the accessToken option disables
    // supabase.auth.* and with it every place a refresh token could be kept.
    expect(Object.keys(options)).toEqual(["accessToken"]);

    mocks.setToken("token-1");
    expect(await options.accessToken()).toBe("token-1");
    mocks.setToken(null);
    expect(await options.accessToken()).toBeNull();
  });

  it("pushes a changed token to Realtime immediately", async () => {
    const { supabase } = await import("../client");
    void supabase.from;

    mocks.setToken("token-a");
    mocks.setToken("token-a");
    mocks.setToken("token-b");

    expect(mocks.setAuth).toHaveBeenCalledTimes(2);
    expect(mocks.setAuth).toHaveBeenCalledWith();
  });

  it("exposes the public URL and key for the OAuth helpers", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://abcdefgh.supabase.co/");
    const { browserSupabaseConfig } = await import("../client");
    expect(browserSupabaseConfig()).toEqual({ url: "https://abcdefgh.supabase.co", key: "pk" });
  });
});

describe("supabase-js accessToken option (installed version)", () => {
  it("disables supabase.auth so no code path can store a refresh token", async () => {
    const actual =
      await vi.importActual<typeof import("@supabase/supabase-js")>("@supabase/supabase-js");
    const client = actual.createClient("https://abcdefgh.supabase.co", "pk", {
      accessToken: async () => null,
    });
    expect(() => client.auth.getSession()).toThrow(/accessToken option/);
    void client.removeAllChannels();
  });
});
