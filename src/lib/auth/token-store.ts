// In-memory holder for the short-lived Supabase access token.
//
// The refresh token never reaches JavaScript: it lives in the HttpOnly
// `n8nmcp-rt` cookie and only /api/auth/* can use it. This store keeps the
// access token in memory, refreshes it through /api/auth/refresh before it
// expires, and shares one refresh between concurrent callers:
//
// - in one tab, every caller awaits the same in-flight promise;
// - across tabs of the same origin, refreshes run under a Web Lock and tabs
//   share the result over a BroadcastChannel, so a tab that waited for the
//   lock reuses the token another tab just received instead of rotating the
//   refresh token again.
//
// It is framework-free and takes its side effects as dependencies so it can
// be tested without a browser; src/lib/auth/browser-session.client.ts wires
// the browser singleton.
import type { User } from "@supabase/supabase-js";

export type AuthSession = {
  access_token: string;
  /** Unix seconds. */
  expires_at: number;
  user: User;
};

export type RefreshOutcome =
  | { kind: "session"; session: AuthSession }
  /** The server has no usable session (no cookie, or it was rejected). */
  | { kind: "signed_out" }
  /**
   * Network or server failure: the session may still be valid. The server
   * may suggest when to retry (its `Retry-After`); otherwise retryDelayMs.
   */
  | { kind: "error"; retryAfterMs?: number };

export type AuthBroadcast =
  { type: "session"; session: AuthSession; persisted: boolean } | { type: "signed_out" };

export type AuthBroadcastChannel = {
  post(message: AuthBroadcast): void;
  subscribe(listener: (message: AuthBroadcast) => void): () => void;
};

export type AuthSnapshot = {
  session: AuthSession | null;
  /** True until the first bootstrap (exchange or refresh) has settled. */
  loading: boolean;
  /**
   * True when the current session came back from /api/auth/refresh, which
   * proves the browser stored and sent the HttpOnly cookie.
   */
  persisted: boolean;
};

export type TokenStoreDeps = {
  refreshRequest(): Promise<RefreshOutcome>;
  /** Runs once before the first refresh (email-link exchange, legacy migration). */
  bootstrap?(): Promise<AuthSession | null>;
  now?(): number;
  setTimer?(callback: () => void, ms: number): unknown;
  clearTimer?(handle: unknown): void;
  /** Serialises refreshes across tabs (navigator.locks); optional. */
  withLock?<T>(task: () => Promise<T>): Promise<T>;
  channel?: AuthBroadcastChannel | null;
  /** Refresh this long before expiry (capped at half the token lifetime). */
  refreshMarginMs?: number;
  /** A token closer than this to expiry is refreshed before it is handed out. */
  minValidityMs?: number;
  /** Retry delay after a failed (network/server) refresh. */
  retryDelayMs?: number;
};

export type AuthTokenStore = {
  getSnapshot(): AuthSnapshot;
  subscribe(listener: () => void): () => void;
  /** Bootstraps once; later calls return the same promise. */
  start(): Promise<AuthSession | null>;
  /** A usable access token, refreshed first when it is about to expire. */
  getAccessToken(): Promise<string | null>;
  /** Rotates the refresh cookie and returns the new session (deduplicated). */
  refresh(): Promise<AuthSession | null>;
  /** Adopts a session returned by login, sign-up or exchange. */
  setSession(session: AuthSession, options?: { persisted?: boolean }): void;
  /** Forgets the session here and in the other tabs. */
  clear(): void;
  /** True once the cookie is proven to round-trip (refreshes once if needed). */
  ensurePersisted(): Promise<boolean>;
  dispose(): void;
};

const DEFAULT_MARGIN_MS = 90_000;
const DEFAULT_MIN_VALIDITY_MS = 30_000;
const DEFAULT_RETRY_MS = 15_000;

export function createAuthTokenStore(deps: TokenStoreDeps): AuthTokenStore {
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer =
    deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const marginMs = deps.refreshMarginMs ?? DEFAULT_MARGIN_MS;
  const minValidityMs = deps.minValidityMs ?? DEFAULT_MIN_VALIDITY_MS;
  const retryDelayMs = deps.retryDelayMs ?? DEFAULT_RETRY_MS;

  let snapshot: AuthSnapshot = { session: null, loading: true, persisted: false };
  let version = 0;
  let timer: unknown = null;
  let inflight: Promise<AuthSession | null> | null = null;
  let started: Promise<AuthSession | null> | null = null;
  const listeners = new Set<() => void>();

  function emit(next: AuthSnapshot) {
    snapshot = next;
    for (const listener of Array.from(listeners)) listener();
  }

  function msLeft(session: AuthSession): number {
    return session.expires_at * 1000 - now();
  }

  function cancelTimer() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  function schedule(delayMs: number) {
    cancelTimer();
    timer = setTimer(
      () => {
        timer = null;
        void refresh();
      },
      Math.max(0, delayMs),
    );
  }

  function scheduleProactive(session: AuthSession) {
    const left = msLeft(session);
    schedule(left - Math.min(marginMs, left / 2));
  }

  function apply(session: AuthSession, persisted: boolean, broadcast: boolean) {
    version++;
    emit({ session, loading: snapshot.loading, persisted });
    scheduleProactive(session);
    if (broadcast) deps.channel?.post({ type: "session", session, persisted });
  }

  function applySignedOut(broadcast: boolean) {
    version++;
    cancelTimer();
    emit({ session: null, loading: snapshot.loading, persisted: false });
    if (broadcast) deps.channel?.post({ type: "signed_out" });
  }

  const unsubscribeChannel = deps.channel?.subscribe((message) => {
    if (message.type === "signed_out") {
      if (snapshot.session) applySignedOut(false);
      return;
    }
    const current = snapshot.session;
    if (current && current.expires_at > message.session.expires_at) return;
    apply(message.session, message.persisted, false);
  });

  function refresh(): Promise<AuthSession | null> {
    if (inflight) return inflight;
    const versionAtCall = version;
    const run = async (): Promise<AuthSession | null> => {
      // Another tab refreshed while this one waited for the lock.
      const current = snapshot.session;
      if (version !== versionAtCall && current && msLeft(current) > marginMs) return current;

      const outcome = await deps.refreshRequest().catch((): RefreshOutcome => ({ kind: "error" }));
      if (outcome.kind === "session") {
        apply(outcome.session, true, true);
        return outcome.session;
      }
      if (outcome.kind === "signed_out") {
        applySignedOut(true);
        return null;
      }
      const kept = snapshot.session;
      if (kept) schedule(outcome.retryAfterMs ?? retryDelayMs);
      return kept && msLeft(kept) > 0 ? kept : null;
    };
    inflight = (deps.withLock ? deps.withLock(run) : run()).finally(() => {
      inflight = null;
    });
    return inflight;
  }

  function start(): Promise<AuthSession | null> {
    if (started) return started;
    started = (async () => {
      try {
        const bootstrapped = await deps.bootstrap?.().catch(() => null);
        if (bootstrapped) {
          apply(bootstrapped, false, true);
          return bootstrapped;
        }
        return await refresh();
      } finally {
        emit({ ...snapshot, loading: false });
      }
    })();
    return started;
  }

  async function getAccessToken(): Promise<string | null> {
    await start();
    const session = snapshot.session;
    if (!session) return null;
    if (msLeft(session) > minValidityMs) return session.access_token;
    return (await refresh())?.access_token ?? null;
  }

  async function ensurePersisted(): Promise<boolean> {
    if (snapshot.session && snapshot.persisted) return true;
    const refreshed = await refresh();
    return Boolean(refreshed && snapshot.persisted);
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    start,
    getAccessToken,
    refresh,
    setSession(session, options) {
      apply(session, options?.persisted ?? false, true);
    },
    clear() {
      applySignedOut(true);
    },
    ensurePersisted,
    dispose() {
      cancelTimer();
      unsubscribeChannel?.();
      listeners.clear();
    },
  };
}
