import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import {
  createAuthTokenStore,
  type AuthBroadcast,
  type AuthSession,
  type RefreshOutcome,
} from "../token-store";

const USER = { id: "user-1", email: "a@example.com" } as unknown as User;
const NOW = Date.UTC(2026, 10, 6, 12, 0, 0);

function session(token: string, lifetimeSeconds = 3600): AuthSession {
  return {
    access_token: token,
    expires_at: Math.floor(Date.now() / 1000) + lifetimeSeconds,
    user: USER,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

/** An in-process stand-in for BroadcastChannel shared by several stores. */
function fakeBus() {
  const listeners = new Set<(message: AuthBroadcast) => void>();
  return () => {
    let own: ((message: AuthBroadcast) => void) | null = null;
    return {
      post(message: AuthBroadcast) {
        for (const listener of listeners) if (listener !== own) listener(message);
      },
      subscribe(listener: (message: AuthBroadcast) => void) {
        own = listener;
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  };
}

/** A FIFO mutex standing in for navigator.locks shared by several stores. */
function fakeLock() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const run = tail.then(task, task);
    tail = run.catch(() => undefined);
    return run;
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("auth token store", () => {
  it("bootstraps from the refresh cookie and stops loading", async () => {
    const refreshRequest = vi.fn(async (): Promise<RefreshOutcome> => ({
      kind: "session",
      session: session("t1"),
    }));
    const store = createAuthTokenStore({ refreshRequest });
    expect(store.getSnapshot()).toMatchObject({ session: null, loading: true });

    await store.start();
    await store.start();

    expect(refreshRequest).toHaveBeenCalledTimes(1);
    expect(store.getSnapshot()).toMatchObject({ loading: false, persisted: true });
    expect(store.getSnapshot().session?.access_token).toBe("t1");
    store.dispose();
  });

  it("uses a bootstrapped (exchanged) session without refreshing first", async () => {
    const refreshRequest = vi.fn(async (): Promise<RefreshOutcome> => ({ kind: "signed_out" }));
    const store = createAuthTokenStore({
      refreshRequest,
      bootstrap: async () => session("exchanged"),
    });

    await store.start();

    expect(refreshRequest).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({ loading: false, persisted: false });
    expect(await store.getAccessToken()).toBe("exchanged");
    store.dispose();
  });

  it("is signed out (not loading) when there is no cookie", async () => {
    const store = createAuthTokenStore({ refreshRequest: async () => ({ kind: "signed_out" }) });
    expect(await store.start()).toBeNull();
    expect(store.getSnapshot()).toEqual({ session: null, loading: false, persisted: false });
    expect(await store.getAccessToken()).toBeNull();
    store.dispose();
  });

  it("refreshes proactively before the access token expires", async () => {
    let n = 0;
    const refreshRequest = vi.fn(async (): Promise<RefreshOutcome> => ({
      kind: "session",
      session: session(`t${++n}`),
    }));
    const store = createAuthTokenStore({ refreshRequest, refreshMarginMs: 90_000 });
    await store.start();
    expect(refreshRequest).toHaveBeenCalledTimes(1);

    // One hour token, refreshed 90 s before expiry.
    await vi.advanceTimersByTimeAsync(3600_000 - 90_000 - 1);
    expect(refreshRequest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refreshRequest).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().session?.access_token).toBe("t2");
    store.dispose();
  });

  it("refreshes a nearly expired token before handing it out", async () => {
    const outcomes: RefreshOutcome[] = [
      { kind: "session", session: session("short", 20) },
      { kind: "session", session: session("long") },
    ];
    const refreshRequest = vi.fn(async () => outcomes.shift()!);
    const store = createAuthTokenStore({ refreshRequest });
    await store.start();

    expect(await store.getAccessToken()).toBe("long");
    expect(refreshRequest).toHaveBeenCalledTimes(2);
    store.dispose();
  });

  it("deduplicates concurrent refreshes in one tab", async () => {
    const gate = deferred<RefreshOutcome>();
    const refreshRequest = vi.fn(() => gate.promise);
    const store = createAuthTokenStore({ refreshRequest });

    const calls = [store.refresh(), store.refresh(), store.refresh()];
    gate.resolve({ kind: "session", session: session("shared") });
    const results = await Promise.all(calls);

    expect(refreshRequest).toHaveBeenCalledTimes(1);
    expect(results.map((r) => r?.access_token)).toEqual(["shared", "shared", "shared"]);
    store.dispose();
  });

  it("reuses another tab's refresh instead of rotating the cookie again", async () => {
    const bus = fakeBus();
    const withLock = fakeLock();
    const gate = deferred<RefreshOutcome>();
    const tabA = createAuthTokenStore({
      refreshRequest: vi.fn(() => gate.promise),
      channel: bus(),
      withLock,
    });
    const tabBRefresh = vi.fn(async (): Promise<RefreshOutcome> => ({ kind: "signed_out" }));
    const tabB = createAuthTokenStore({ refreshRequest: tabBRefresh, channel: bus(), withLock });

    const a = tabA.refresh(); // holds the lock
    const b = tabB.refresh(); // waits for it
    gate.resolve({ kind: "session", session: session("from-a") });

    expect((await a)?.access_token).toBe("from-a");
    expect((await b)?.access_token).toBe("from-a");
    expect(tabBRefresh).not.toHaveBeenCalled();
    expect(tabB.getSnapshot()).toMatchObject({ persisted: true });
    tabA.dispose();
    tabB.dispose();
  });

  it("signs every tab out when the server rejects the cookie", async () => {
    const bus = fakeBus();
    const tabA = createAuthTokenStore({
      refreshRequest: async () => ({ kind: "signed_out" }),
      channel: bus(),
    });
    const tabB = createAuthTokenStore({ refreshRequest: vi.fn(), channel: bus() });
    tabA.setSession(session("a"));
    expect(tabB.getSnapshot().session?.access_token).toBe("a");

    await tabA.refresh();

    expect(tabA.getSnapshot().session).toBeNull();
    expect(tabB.getSnapshot().session).toBeNull();
    tabA.dispose();
    tabB.dispose();
  });

  it("keeps the session and retries after a network failure", async () => {
    const outcomes: RefreshOutcome[] = [
      { kind: "error" },
      { kind: "session", session: session("recovered") },
    ];
    const refreshRequest = vi.fn(async () => outcomes.shift()!);
    const store = createAuthTokenStore({ refreshRequest, retryDelayMs: 15_000 });
    store.setSession(session("current"));

    expect((await store.refresh())?.access_token).toBe("current");
    expect(store.getSnapshot().session?.access_token).toBe("current");

    await vi.advanceTimersByTimeAsync(15_000);
    expect(refreshRequest).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().session?.access_token).toBe("recovered");
    store.dispose();
  });

  it("retries when the server says to, not after the default delay", async () => {
    // /api/auth/refresh answers 5xx with Retry-After: 2 when Supabase did not
    // answer, so a token it may already have rotated is retried while the old
    // one is still inside Supabase's reuse interval.
    const outcomes: RefreshOutcome[] = [
      { kind: "error", retryAfterMs: 2_000 },
      { kind: "session", session: session("recovered") },
    ];
    const refreshRequest = vi.fn(async () => outcomes.shift()!);
    const store = createAuthTokenStore({ refreshRequest, retryDelayMs: 15_000 });
    store.setSession(session("current"));

    await store.refresh();
    await vi.advanceTimersByTimeAsync(1_999);
    expect(refreshRequest).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refreshRequest).toHaveBeenCalledTimes(2);
    expect(store.getSnapshot().session?.access_token).toBe("recovered");
    store.dispose();
  });

  it("treats a thrown refresh as a transient error", async () => {
    const store = createAuthTokenStore({
      refreshRequest: async () => {
        throw new Error("offline");
      },
    });
    store.setSession(session("current"));
    expect((await store.refresh())?.access_token).toBe("current");
    store.dispose();
  });

  it("proves the cookie round-trips once before reporting it persisted", async () => {
    const refreshRequest = vi.fn(async (): Promise<RefreshOutcome> => ({
      kind: "session",
      session: session("rotated"),
    }));
    const store = createAuthTokenStore({ refreshRequest });
    store.setSession(session("from-login"));
    expect(store.getSnapshot().persisted).toBe(false);

    expect(await store.ensurePersisted()).toBe(true);
    expect(await store.ensurePersisted()).toBe(true);
    expect(refreshRequest).toHaveBeenCalledTimes(1);
    store.dispose();
  });

  it("reports a blocked cookie when the round-trip finds no session", async () => {
    const store = createAuthTokenStore({ refreshRequest: async () => ({ kind: "signed_out" }) });
    store.setSession(session("from-login"));
    expect(await store.ensurePersisted()).toBe(false);
    expect(store.getSnapshot().session).toBeNull();
    store.dispose();
  });

  it("notifies subscribers and clears timers on clear()", async () => {
    const refreshRequest = vi.fn(async (): Promise<RefreshOutcome> => ({ kind: "signed_out" }));
    const store = createAuthTokenStore({ refreshRequest });
    const listener = vi.fn();
    store.subscribe(listener);
    store.setSession(session("x"));
    store.clear();

    expect(listener).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4 * 3600_000);
    expect(refreshRequest).not.toHaveBeenCalled();
    store.dispose();
  });
});
