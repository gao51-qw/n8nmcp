// The browser's single auth session: the in-memory token store wired to the
// /api/auth endpoints, Web Locks, a BroadcastChannel, the email-link fragment
// exchange and the one-time migration of legacy JavaScript-readable sessions.
//
// Page load (start):
//   1. An implicit-flow email link (`#access_token=…&refresh_token=…`) is
//      stripped from the address bar and exchanged for the HttpOnly cookie.
//   2. Otherwise a legacy `sb-<ref>-auth-token` cookie or localStorage session
//      is exchanged once. Every legacy copy is deleted either way.
//   3. Otherwise /api/auth/refresh rotates the cookie and returns a fresh
//      access token (or reports that there is no session).
import { exchangeRequest, logoutRequest, refreshRequest } from "./auth-api.client";
import { sharedCookieDomain } from "./cookie-domain";
import { fragmentWithoutTokens, parseEmailLinkFragment } from "./email-link";
import {
  clearLegacySession,
  hasLegacySession,
  legacySessionKey,
  readLegacyRefreshToken,
  type CookieJar,
  type LegacyStorage,
} from "./legacy-session";
import {
  createAuthTokenStore,
  type AuthBroadcast,
  type AuthBroadcastChannel,
  type AuthSession,
  type AuthTokenStore,
} from "./token-store";
import { SITE_DOMAINS } from "@/lib/site-domains";

const LOCK_NAME = "n8nmcp-auth-refresh";
const CHANNEL_NAME = "n8nmcp-auth";

export type EmailLinkStatus = "none" | "exchanged" | "failed";

let emailLinkStatus: EmailLinkStatus = "none";

/** Whether this page load carried email-link tokens, and whether they were accepted. */
export function getEmailLinkStatus(): EmailLinkStatus {
  return emailLinkStatus;
}

function browserStorage(): LegacyStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const documentJar: CookieJar = {
  read: () => document.cookie,
  write: (cookie) => {
    document.cookie = cookie;
  },
};

/** Removes token parameters from the address bar without a navigation. */
function stripTokensFromUrl() {
  const { pathname, search, hash } = window.location;
  try {
    window.history.replaceState(
      window.history.state,
      "",
      `${pathname}${search}${fragmentWithoutTokens(hash)}`,
    );
  } catch {
    window.location.hash = fragmentWithoutTokens(hash);
  }
}

export async function bootstrapBrowserSession(
  options: {
    jar?: CookieJar;
    storage?: LegacyStorage | null;
    supabaseUrl?: string;
    exchange?: typeof exchangeRequest;
  } = {},
): Promise<AuthSession | null> {
  const jar = options.jar ?? documentJar;
  const storage = options.storage === undefined ? browserStorage() : options.storage;
  const exchange = options.exchange ?? exchangeRequest;
  const key = legacySessionKey(options.supabaseUrl ?? process.env.NEXT_PUBLIC_SUPABASE_URL);

  const linkTokens = parseEmailLinkFragment(window.location.hash);
  if (linkTokens) stripTokensFromUrl();

  let cookieHeader = "";
  try {
    cookieHeader = jar.read();
  } catch {
    cookieHeader = "";
  }
  const legacyToken = readLegacyRefreshToken({ key, cookieHeader, storage });
  const hadLegacy = legacyToken !== null || hasLegacySession({ key, cookieHeader, storage });

  try {
    if (linkTokens) {
      try {
        const session = await exchange({
          access_token: linkTokens.access_token,
          refresh_token: linkTokens.refresh_token,
        });
        emailLinkStatus = "exchanged";
        return session;
      } catch {
        emailLinkStatus = "failed";
        return null;
      }
    }
    if (legacyToken) {
      return await exchange({ refresh_token: legacyToken }).catch(() => null);
    }
    return null;
  } finally {
    if (hadLegacy) {
      clearLegacySession({
        key,
        jar,
        storage,
        domain: sharedCookieDomain(
          Object.values(SITE_DOMAINS).map((site) => site.host),
          window.location.hostname,
        ),
        secure: window.location.protocol === "https:",
      });
    }
  }
}

function broadcastChannel(): AuthBroadcastChannel | null {
  if (typeof BroadcastChannel === "undefined") return null;
  let channel: BroadcastChannel;
  try {
    channel = new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
  return {
    post(message) {
      try {
        channel.postMessage(message);
      } catch {
        // A closed channel only loses the cross-tab hint.
      }
    },
    subscribe(listener) {
      const handler = (event: MessageEvent<AuthBroadcast>) => {
        const data = event.data;
        if (data && (data.type === "signed_out" || data.type === "session")) listener(data);
      };
      channel.addEventListener("message", handler);
      return () => channel.removeEventListener("message", handler);
    },
  };
}

function webLock(): (<T>(task: () => Promise<T>) => Promise<T>) | undefined {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (!locks?.request) return undefined;
  return <T>(task: () => Promise<T>) => locks.request(LOCK_NAME, task) as Promise<T>;
}

let store: AuthTokenStore | undefined;

/** The browser's auth store (created on first use; never during SSR rendering). */
export function authStore(): AuthTokenStore {
  if (store) return store;
  store = createAuthTokenStore({
    refreshRequest,
    bootstrap: () => bootstrapBrowserSession(),
    withLock: webLock(),
    channel: broadcastChannel(),
  });
  const current = store;
  document.addEventListener("visibilitychange", () => {
    // Background tabs throttle timers; catch up when the tab is shown again.
    if (document.visibilityState === "visible" && current.getSnapshot().session) {
      void current.getAccessToken();
    }
  });
  return store;
}

/** The current access token for API calls, or null when signed out. */
export async function getAccessToken(): Promise<string | null> {
  if (typeof window === "undefined") return null;
  return authStore().getAccessToken();
}

/**
 * Revokes the session server-side and clears both HttpOnly cookies, then
 * forgets the in-memory token here and in the other tabs. The local state is
 * cleared even when the request fails.
 */
export async function signOut(): Promise<void> {
  const current = authStore();
  const token = current.getSnapshot().session?.access_token ?? null;
  try {
    await logoutRequest(token);
  } catch {
    // Offline or already revoked: the local sign-out below still happens.
  } finally {
    current.clear();
  }
}
