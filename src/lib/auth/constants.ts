// Names and lifetimes shared by the browser, the auth route handlers and the
// proxy. The long-lived Supabase refresh token lives only in an HttpOnly
// cookie; the short-lived access token lives only in browser memory
// (src/lib/auth/token-store.ts).

/** HttpOnly cookie holding the Supabase refresh token. */
export const REFRESH_TOKEN_COOKIE = "n8nmcp-rt";

/**
 * The refresh token is only ever needed by the auth endpoints, so the browser
 * sends it nowhere else: not with page loads, assets or the other APIs, and
 * not to other services that share the parent domain (api.<domain>) on any
 * other path.
 */
export const REFRESH_TOKEN_COOKIE_PATH = "/api/auth";

/**
 * HttpOnly marker that a refresh-token cookie was issued. It carries no
 * secret: the proxy only uses it to send a certainly signed-out dashboard
 * visit straight to /login. It needs Path=/ to reach page requests.
 */
export const SESSION_PRESENCE_COOKIE = "n8nmcp-session";

/**
 * Both cookies are rewritten on every refresh, so this is an idle timeout.
 * Supabase's own session limits (time-box, inactivity) still apply.
 */
export const SESSION_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export const AUTH_API = {
  login: "/api/auth/login",
  signup: "/api/auth/signup",
  recover: "/api/auth/recover",
  refresh: "/api/auth/refresh",
  logout: "/api/auth/logout",
  exchange: "/api/auth/exchange",
  password: "/api/auth/password",
} as const;

/** Landing page for email confirmation links (implicit flow fragment). */
export const AUTH_CALLBACK_PATH = "/auth/callback";
