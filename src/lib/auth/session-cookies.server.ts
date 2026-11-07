// The two HttpOnly session cookies set by /api/auth/*.
//
//   n8nmcp-rt=<refresh token>; Path=/api/auth; HttpOnly; SameSite=Lax; [Secure]; [Domain]
//   n8nmcp-session=1;          Path=/;         HttpOnly; SameSite=Lax; [Secure]; [Domain]
//
// Domain is the parent domain shared by every site surface (so one sign-in
// covers mcp., docs., blog. and dashboard.), or host-only on localhost and
// single-origin deployments. Secure follows the request origin's scheme.
import { sharedCookieDomain } from "./cookie-domain";
import {
  REFRESH_TOKEN_COOKIE,
  REFRESH_TOKEN_COOKIE_PATH,
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_PRESENCE_COOKIE,
} from "./constants";
import { parseCookieHeader } from "./legacy-session";
import { normalizeHost, SITE_DOMAINS } from "@/lib/site-domains";

export type CookieContext = { domain?: string; secure: boolean };

const REFRESH_TOKEN_VALUE = /^[\x21-\x7e]{1,2048}$/;
const EXPIRED = "Thu, 01 Jan 1970 00:00:00 GMT";

/** Cookie attributes for a request whose origin has already been validated. */
export function cookieContext(origin: URL): CookieContext {
  return {
    domain: sharedCookieDomain(
      Object.values(SITE_DOMAINS).map((site) => site.host),
      normalizeHost(origin.hostname),
    ),
    secure: origin.protocol === "https:",
  };
}

function serialize(
  name: string,
  value: string,
  options: { path: string; maxAge: number; domain?: string; secure: boolean },
): string {
  const parts = [
    `${name}=${value}`,
    `Path=${options.path}`,
    `Max-Age=${options.maxAge}`,
    ...(options.maxAge === 0 ? [`Expires=${EXPIRED}`] : []),
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (options.domain) parts.push(`Domain=${options.domain}`);
  if (options.secure) parts.push("Secure");
  return parts.join("; ");
}

function cookieSpecs(context: CookieContext) {
  return [
    { name: REFRESH_TOKEN_COOKIE, path: REFRESH_TOKEN_COOKIE_PATH },
    { name: SESSION_PRESENCE_COOKIE, path: "/" },
  ].map((spec) => ({ ...spec, domain: context.domain, secure: context.secure }));
}

/** Set-Cookie values that delete a host-only copy shadowing the shared one. */
function hostOnlyCleanup(context: CookieContext): string[] {
  if (!context.domain) return [];
  return cookieSpecs({ secure: context.secure }).map((spec) =>
    serialize(spec.name, "", { ...spec, maxAge: 0 }),
  );
}

/** Set-Cookie values that store a (rotated) refresh token. */
export function sessionCookieHeaders(refreshToken: string, context: CookieContext): string[] {
  if (!REFRESH_TOKEN_VALUE.test(refreshToken)) throw new Error("Invalid refresh token");
  const [rt, presence] = cookieSpecs(context);
  return [
    ...hostOnlyCleanup(context),
    serialize(rt.name, encodeURIComponent(refreshToken), {
      ...rt,
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    }),
    serialize(presence.name, "1", { ...presence, maxAge: SESSION_COOKIE_MAX_AGE_SECONDS }),
  ];
}

/** Set-Cookie values that delete both cookies (shared and host-only copies). */
export function clearSessionCookieHeaders(context: CookieContext): string[] {
  return [
    ...hostOnlyCleanup(context),
    ...cookieSpecs(context).map((spec) => serialize(spec.name, "", { ...spec, maxAge: 0 })),
  ];
}

export function setSessionCookies(
  response: Response,
  refreshToken: string,
  context: CookieContext,
): Response {
  for (const value of sessionCookieHeaders(refreshToken, context)) {
    response.headers.append("Set-Cookie", value);
  }
  return response;
}

export function clearSessionCookies(response: Response, context: CookieContext): Response {
  for (const value of clearSessionCookieHeaders(context)) {
    response.headers.append("Set-Cookie", value);
  }
  return response;
}

/** The refresh token from the request's cookies, or null when absent or malformed. */
export function readRefreshCookie(request: Request): string | null {
  const raw = parseCookieHeader(request.headers.get("cookie") ?? "").get(REFRESH_TOKEN_COOKIE);
  if (!raw) return null;
  let value: string;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  return REFRESH_TOKEN_VALUE.test(value) ? value : null;
}

/** True when the request carries the presence marker (the refresh cookie is path-scoped). */
export function hasPresenceCookie(request: Request): boolean {
  return parseCookieHeader(request.headers.get("cookie") ?? "").has(SESSION_PRESENCE_COOKIE);
}
