import { NextResponse, type NextRequest } from "next/server";
import { authSessionCookieKey, hasAuthSessionCookie } from "@/lib/auth-session-cookie";
import { contentSecurityPolicyFromEnv, type ContentSecurityPolicy } from "@/lib/csp";
import { canonicalUrl, normalizeHost, SITE_DOMAINS, surfaceFromHost } from "@/lib/site-domains";

const PUBLIC_FILE = /\.(?:avif|ico|jpg|jpeg|png|svg|webp|css|js|map|txt|xml)$/;
const NOINDEX = "noindex,nofollow";

/**
 * Account pages shared by every surface. On the dashboard host they are
 * served as-is (not rewritten under /dashboard), and they are never indexed.
 */
const AUTH_PAGES = new Set(["/login", "/signup", "/forgot-password", "/reset-password"]);

function isAuthPage(pathname: string): boolean {
  return AUTH_PAGES.has(pathname) || pathname === "/auth" || pathname.startsWith("/auth/");
}

function shouldBypass(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname === "/favicon.ico" ||
    pathname === "/icon" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/llms.txt" ||
    pathname === "/opengraph-image" ||
    PUBLIC_FILE.test(pathname)
  );
}

/**
 * Non-page routes that still pass through the surface routing below (the MCP
 * endpoint and OAuth discovery documents). They return JSON or streams, so
 * they get no page policy and no nonce.
 */
function skipsPagePolicy(pathname: string): boolean {
  return (
    pathname === "/mcp" || pathname.startsWith("/mcp/") || pathname.startsWith("/.well-known/")
  );
}

function isDashboardPath(pathname: string): boolean {
  return pathname === "/dashboard" || pathname.startsWith("/dashboard/");
}

/** Request headers forwarded to rendering (the CSP and nonce), if any. */
type Forward = { request: { headers: Headers } } | undefined;

function forwardPolicy(request: NextRequest, policy: ContentSecurityPolicy): Forward {
  const headers = new Headers(request.headers);
  // Next.js reads the nonce from the request's CSP header (either name) and
  // the root layout reads x-nonce. Drop any client-sent copies first.
  headers.delete("content-security-policy");
  headers.delete("content-security-policy-report-only");
  headers.set(policy.name, policy.value);
  headers.set("x-nonce", policy.nonce);
  return { request: { headers } };
}

function pass(forward: Forward, noindex = false): NextResponse {
  const response = NextResponse.next(forward);
  if (noindex) response.headers.set("X-Robots-Tag", NOINDEX);
  return response;
}

function rewrite(
  request: NextRequest,
  pathname: string,
  forward: Forward,
  noindex = false,
): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  const response = NextResponse.rewrite(url, forward);
  if (noindex) response.headers.set("X-Robots-Tag", NOINDEX);
  return response;
}

/**
 * The FAQ moved from the main site (mcp.<host>/faq) to the docs host
 * (docs.<host>/faq). Keep old links and search results working with a
 * permanent redirect. When every surface shares one origin (`next dev`),
 * redirecting to docs/faq on the same host would loop, so go straight to the
 * app route instead.
 */
function redirectMovedFaq(request: NextRequest): NextResponse {
  const singleOrigin = SITE_DOMAINS.docs.host === SITE_DOMAINS.mcp.host;
  const target = singleOrigin
    ? new URL("/docs/faq", request.nextUrl)
    : new URL(canonicalUrl("/faq", "docs"));
  target.search = request.nextUrl.search;
  return NextResponse.redirect(target, 301);
}

/**
 * A dashboard visit without the HttpOnly session marker (`n8nmcp-session`,
 * set by /api/auth/* next to the refresh-token cookie) goes straight to the
 * sign-in page on the same host instead of rendering a spinner first. During
 * the migration window a legacy JavaScript-readable `sb-*-auth-token` cookie
 * also counts; the page then exchanges it for the HttpOnly cookies. This is a
 * presence check only: a present but expired or forged cookie still reaches
 * the dashboard, whose client-side guard validates the session.
 *
 * `next` is the path the visitor asked for (on the dashboard host that is the
 * external path, e.g. /billing, not the rewritten /dashboard/billing), which
 * getSafeLoginDestination accepts and the login page navigates back to.
 */
function signedOutRedirect(request: NextRequest, noindex: boolean): NextResponse | null {
  const key = authSessionCookieKey(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL,
  );
  const names = request.cookies.getAll().map((cookie) => cookie.name);
  if (hasAuthSessionCookie(names, key)) return null;

  const target = request.nextUrl.clone();
  target.pathname = "/login";
  target.search = "";
  target.searchParams.set("next", `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.redirect(target, 307);
  response.headers.set("Cache-Control", "private, no-store");
  if (noindex) response.headers.set("X-Robots-Tag", NOINDEX);
  return response;
}

function route(
  request: NextRequest,
  surface: ReturnType<typeof surfaceFromHost>,
  forward: Forward,
): NextResponse {
  const { pathname } = request.nextUrl;

  if (surface === "mcp") {
    if (isAuthPage(pathname)) return pass(forward, true);
    if (pathname === "/mcp") return rewrite(request, "/mcp", forward, true);
    if (pathname === "/faq") return redirectMovedFaq(request);
    // Production serves the dashboard on its own host, but /dashboard also
    // exists on this host (and is the only way in on a single origin).
    if (isDashboardPath(pathname)) return signedOutRedirect(request, false) ?? pass(forward);
    return pass(forward);
  }

  if (surface === "docs") {
    // Every docs page lives under /docs in the app tree; the docs host exposes
    // them at the root (docs.<host>/getting-started), matching the sitemap,
    // llms.txt and the canonical URLs each page declares.
    if (!pathname.startsWith("/docs")) {
      return rewrite(request, `/docs${pathname === "/" ? "" : pathname}`, forward);
    }
    return pass(forward);
  }

  if (surface === "blog") {
    if (pathname === "/") return rewrite(request, "/blog", forward);
    if (!pathname.startsWith("/blog")) return rewrite(request, `/blog${pathname}`, forward);
    return pass(forward);
  }

  if (surface === "dashboard") {
    if (isAuthPage(pathname)) return pass(forward, true);
    const redirect = skipsPagePolicy(pathname) ? null : signedOutRedirect(request, true);
    if (redirect) return redirect;
    if (!pathname.startsWith("/dashboard")) {
      return rewrite(request, `/dashboard${pathname === "/" ? "" : pathname}`, forward, true);
    }
    return pass(forward, true);
  }

  return pass(forward);
}

export function proxy(request: NextRequest) {
  const surface = surfaceFromHost(normalizeHost(request.headers.get("host")));
  const { pathname } = request.nextUrl;

  if (shouldBypass(pathname)) {
    const response = NextResponse.next();
    if (surface === "dashboard") response.headers.set("X-Robots-Tag", NOINDEX);
    return response;
  }

  const policy = skipsPagePolicy(pathname)
    ? null
    : contentSecurityPolicyFromEnv({
        NODE_ENV: process.env.NODE_ENV,
        CSP_MODE: process.env.CSP_MODE,
        CSP_REPORT_URI: process.env.CSP_REPORT_URI,
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
        SUPABASE_URL: process.env.SUPABASE_URL,
        NEXT_PUBLIC_SENTRY_DSN: process.env.NEXT_PUBLIC_SENTRY_DSN,
      });

  const response = route(request, surface, policy ? forwardPolicy(request, policy) : undefined);
  if (policy && !response.headers.has("location")) {
    response.headers.set(policy.name, policy.value);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
