import { NextResponse, type NextRequest } from "next/server";
import { normalizeHost, surfaceFromHost } from "@/lib/site-domains";

const PUBLIC_FILE = /\.(?:avif|ico|jpg|jpeg|png|svg|webp|css|js|map|txt|xml)$/;
const NOINDEX = "noindex,nofollow";

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

export function proxy(request: NextRequest) {
  const surface = surfaceFromHost(normalizeHost(request.headers.get("host")));
  const { pathname } = request.nextUrl;

  if (shouldBypass(pathname)) {
    const response = NextResponse.next();
    if (surface === "dashboard") response.headers.set("X-Robots-Tag", NOINDEX);
    return response;
  }

  if (surface === "mcp") {
    if (pathname === "/mcp") return rewriteWithNoIndex(request, "/mcp");
    return NextResponse.next();
  }

  if (surface === "docs") {
    if (pathname === "/") {
      const url = request.nextUrl.clone();
      url.pathname = "/docs";
      return NextResponse.rewrite(url);
    }
    if (pathname === "/tools") {
      const url = request.nextUrl.clone();
      url.pathname = "/docs/tools";
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
    if (pathname === "/login") {
      const response = NextResponse.next();
      response.headers.set("X-Robots-Tag", NOINDEX);
      return response;
    }
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
