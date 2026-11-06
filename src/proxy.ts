import { NextResponse, type NextRequest } from "next/server";
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

function nextWithNoIndex(): NextResponse {
  const response = NextResponse.next();
  response.headers.set("X-Robots-Tag", NOINDEX);
  return response;
}

function shouldBypass(pathname: string): boolean {
  return (
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/api/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    pathname === "/llms.txt" ||
    pathname === "/opengraph-image" ||
    PUBLIC_FILE.test(pathname)
  );
}

function rewriteWithNoIndex(request: NextRequest, pathname: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = pathname;
  const response = NextResponse.rewrite(url);
  response.headers.set("X-Robots-Tag", NOINDEX);
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

export function proxy(request: NextRequest) {
  const surface = surfaceFromHost(normalizeHost(request.headers.get("host")));
  const { pathname } = request.nextUrl;

  if (shouldBypass(pathname)) {
    const response = NextResponse.next();
    if (surface === "dashboard") response.headers.set("X-Robots-Tag", NOINDEX);
    return response;
  }

  if (surface === "mcp") {
    if (isAuthPage(pathname)) return nextWithNoIndex();
    if (pathname === "/mcp") return rewriteWithNoIndex(request, "/mcp");
    if (pathname === "/faq") return redirectMovedFaq(request);
    return NextResponse.next();
  }

  if (surface === "docs") {
    // Every docs page lives under /docs in the app tree; the docs host exposes
    // them at the root (docs.<host>/getting-started), matching the sitemap,
    // llms.txt and the canonical URLs each page declares.
    if (!pathname.startsWith("/docs")) {
      const url = request.nextUrl.clone();
      url.pathname = `/docs${pathname === "/" ? "" : pathname}`;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  if (surface === "blog") {
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/blog";
      return NextResponse.rewrite(url);
    }
    if (!pathname.startsWith("/blog")) {
      const url = request.nextUrl.clone();
      url.pathname = `/blog${pathname}`;
      return NextResponse.rewrite(url);
    }
    return NextResponse.next();
  }

  if (surface === "dashboard") {
    if (isAuthPage(pathname)) return nextWithNoIndex();
    if (!pathname.startsWith("/dashboard")) {
      return rewriteWithNoIndex(request, `/dashboard${pathname === "/" ? "" : pathname}`);
    }
    const response = NextResponse.next();
    response.headers.set("X-Robots-Tag", NOINDEX);
    return response;
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
