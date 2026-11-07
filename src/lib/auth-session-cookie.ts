// Presence check for the proxy's signed-out redirect. It never validates the
// session: it only lets the proxy skip rendering the dashboard for a visitor
// who is certainly signed out. The client still restores and verifies the
// session through /api/auth/refresh.
//
// Signed in means either:
// - the HttpOnly `n8nmcp-session` marker set next to the refresh-token cookie
//   by /api/auth/* (the refresh cookie itself is scoped to Path=/api/auth and
//   never reaches page requests), or
// - during the migration window, a legacy JavaScript-readable Supabase cookie
//   (`<key>` or its first chunk `<key>.0`), which the browser exchanges for
//   the HttpOnly cookies and deletes on its first page load.
import { SESSION_PRESENCE_COOKIE } from "@/lib/auth/constants";
import { legacySessionKey } from "@/lib/auth/legacy-session";

export { SESSION_PRESENCE_COOKIE } from "@/lib/auth/constants";

/** Any project's default supabase-js key, used when no Supabase URL is configured. */
const ANY_SUPABASE_KEY = /^sb-[A-Za-z0-9-]+-auth-token(?:\.0)?$/;

/** The legacy auth storage key (cookie name) for a Supabase URL, or null if it is unusable. */
export function authSessionCookieKey(supabaseUrl: string | undefined): string | null {
  return legacySessionKey(supabaseUrl);
}

/** True when an unchunked legacy `<key>` or its first chunk `<key>.0` is present. */
export function hasLegacySessionCookie(names: Iterable<string>, key: string | null): boolean {
  for (const name of names) {
    if (key ? name === key || name === `${key}.0` : ANY_SUPABASE_KEY.test(name)) return true;
  }
  return false;
}

/** True when the presence marker or (migration window) a legacy session cookie is present. */
export function hasAuthSessionCookie(names: Iterable<string>, legacyKey: string | null): boolean {
  const list = Array.from(names);
  return list.includes(SESSION_PRESENCE_COOKIE) || hasLegacySessionCookie(list, legacyKey);
}

/** Cookie names in a `Cookie` header or `document.cookie` string. */
export function cookieNames(cookieHeader: string): string[] {
  return cookieHeader
    .split(";")
    .filter((part) => part.indexOf("=") > 0)
    .map((part) => part.slice(0, part.indexOf("=")).trim());
}
