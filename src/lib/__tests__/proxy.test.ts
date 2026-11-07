import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

const SUPABASE_URL = "https://abcdefgh.supabase.co";
/** The HttpOnly presence marker set by /api/auth/* next to the refresh cookie. */
const SESSION_COOKIE = "n8nmcp-session=1";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("CSP_MODE", "");
  vi.stubEnv("CSP_REPORT_URI", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function request(url: string, init: { cookie?: string; headers?: Record<string, string> } = {}) {
  const { host } = new URL(url);
  return new NextRequest(url, {
    headers: { host, ...(init.cookie ? { cookie: init.cookie } : {}), ...init.headers },
  });
}

/** The value of a request header the proxy forwards to rendering. */
function forwarded(response: Response, name: string): string | null {
  const overridden = response.headers.get("x-middleware-override-headers")?.split(",") ?? [];
  return overridden.includes(name) ? response.headers.get(`x-middleware-request-${name}`) : null;
}

function nonceOf(policy: string | null): string | undefined {
  return policy?.match(/'nonce-([^']+)'/)?.[1];
}

describe("domain proxy", () => {
  it("keeps the shared login route on the dashboard domain", () => {
    const request = new NextRequest("https://dashboard.n8nworkflow.com/login?next=%2F", {
      headers: { host: "dashboard.n8nworkflow.com" },
    });

    const response = proxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toBe("noindex,nofollow");
  });

  it.each([
    "/signup",
    "/signup?next=%2Fdashboard%2Fbilling",
    "/forgot-password",
    "/reset-password",
    "/auth/callback",
  ])("serves the account page %s un-rewritten and noindex on the dashboard domain", (path) => {
    const host = "dashboard.n8nworkflow.com";
    const response = proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toBe("noindex,nofollow");
  });

  it("still rewrites look-alike dashboard paths under /dashboard", () => {
    const host = "dashboard.n8nworkflow.com";
    expect(rewriteTarget(host, "/signups")).toBe("/dashboard/signups");
    expect(rewriteTarget(host, "/authx")).toBe("/dashboard/authx");
    expect(rewriteTarget(host, "/billing")).toBe("/dashboard/billing");
  });

  it("marks account pages noindex on the main domain too", () => {
    const host = "mcp.n8nworkflow.com";
    for (const path of ["/login", "/signup", "/forgot-password", "/reset-password"]) {
      const response = proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }));
      expect(response.headers.get("x-middleware-rewrite")).toBeNull();
      expect(response.headers.get("x-robots-tag")).toBe("noindex,nofollow");
    }
    const home = proxy(new NextRequest(`https://${host}/`, { headers: { host } }));
    expect(home.headers.get("x-robots-tag")).toBeNull();
  });

  function rewriteTarget(host: string, path: string): string | null {
    const response = proxy(request(`https://${host}${path}`, { cookie: SESSION_COOKIE }));
    const rewrite = response.headers.get("x-middleware-rewrite");
    return rewrite ? new URL(rewrite).pathname : null;
  }

  it("serves every docs page from the root of the docs domain", () => {
    const host = "docs.n8nworkflow.com";

    expect(rewriteTarget(host, "/")).toBe("/docs");
    expect(rewriteTarget(host, "/tools")).toBe("/docs/tools");
    expect(rewriteTarget(host, "/getting-started")).toBe("/docs/getting-started");
    expect(rewriteTarget(host, "/security")).toBe("/docs/security");
    expect(rewriteTarget(host, "/faq")).toBe("/docs/faq");
    expect(rewriteTarget(host, "/docs/tools")).toBeNull();
  });

  it("leaves the main domain untouched", () => {
    expect(rewriteTarget("mcp.n8nworkflow.com", "/docs/faq")).toBeNull();
    expect(rewriteTarget("mcp.n8nworkflow.com", "/pricing")).toBeNull();
  });

  it("permanently redirects the old main-site FAQ to the docs host", () => {
    const host = "mcp.n8nworkflow.com";
    const response = proxy(
      new NextRequest(`https://${host}/faq?ref=search`, { headers: { host } }),
    );

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("https://docs.n8nworkflow.com/faq?ref=search");
  });

  it("does not redirect the FAQ on the docs host itself", () => {
    const host = "docs.n8nworkflow.com";
    const response = proxy(new NextRequest(`https://${host}/faq`, { headers: { host } }));

    expect(response.headers.get("location")).toBeNull();
    expect(rewriteTarget(host, "/faq")).toBe("/docs/faq");
  });
});

describe("domain proxy on a single origin (next dev)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sends /faq to the in-app docs route instead of looping", async () => {
    for (const name of ["MCP_SITE", "DOCS", "BLOG", "DASHBOARD"]) {
      vi.stubEnv(`NEXT_PUBLIC_${name}_URL`, "http://localhost:3000");
    }
    vi.resetModules();
    const { proxy: devProxy } = await import("@/proxy");

    const response = devProxy(
      new NextRequest("http://localhost:3000/faq", { headers: { host: "localhost:3000" } }),
    );

    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe("http://localhost:3000/docs/faq");
  });
});

describe("page Content-Security-Policy", () => {
  it("sends an enforced nonce policy on pages and forwards the same nonce to rendering", () => {
    const response = proxy(request("https://mcp.n8nworkflow.com/pricing"));
    const policy = response.headers.get("content-security-policy");

    expect(policy).toContain("'strict-dynamic'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(response.headers.get("content-security-policy-report-only")).toBeNull();

    const nonce = nonceOf(policy);
    expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
    expect(forwarded(response, "x-nonce")).toBe(nonce);
    expect(forwarded(response, "content-security-policy")).toBe(policy);
  });

  it("mints a new nonce for every request", () => {
    const first = nonceOf(
      proxy(request("https://mcp.n8nworkflow.com/")).headers.get("content-security-policy"),
    );
    const second = nonceOf(
      proxy(request("https://mcp.n8nworkflow.com/")).headers.get("content-security-policy"),
    );
    expect(first).toBeTruthy();
    expect(first).not.toBe(second);
  });

  it("carries the policy through surface rewrites", () => {
    for (const url of [
      "https://docs.n8nworkflow.com/getting-started",
      "https://blog.n8nworkflow.com/",
      "https://dashboard.n8nworkflow.com/billing",
    ]) {
      const response = proxy(request(url, { cookie: SESSION_COOKIE }));
      expect(response.headers.get("x-middleware-rewrite"), url).not.toBeNull();
      const nonce = nonceOf(response.headers.get("content-security-policy"));
      expect(nonce, url).toBeTruthy();
      expect(forwarded(response, "x-nonce"), url).toBe(nonce);
    }
  });

  it("covers the account pages too", () => {
    const response = proxy(request("https://dashboard.n8nworkflow.com/login"));
    expect(nonceOf(response.headers.get("content-security-policy"))).toBeTruthy();
  });

  it("replaces a nonce or policy the client sent", () => {
    const response = proxy(
      request("https://mcp.n8nworkflow.com/", {
        headers: {
          "x-nonce": "attacker",
          "content-security-policy": "script-src 'nonce-attacker'",
          "content-security-policy-report-only": "script-src 'nonce-attacker'",
        },
      }),
    );
    const nonce = nonceOf(response.headers.get("content-security-policy"));
    expect(forwarded(response, "x-nonce")).toBe(nonce);
    expect(forwarded(response, "content-security-policy")).not.toContain("attacker");
    expect(forwarded(response, "content-security-policy-report-only")).toBeNull();
  });

  it("switches to Report-Only with CSP_MODE=report", () => {
    vi.stubEnv("CSP_MODE", "report");
    const response = proxy(request("https://mcp.n8nworkflow.com/"));
    const policy = response.headers.get("content-security-policy-report-only");

    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(nonceOf(policy)).toBeTruthy();
    expect(forwarded(response, "content-security-policy-report-only")).toBe(policy);
    expect(forwarded(response, "x-nonce")).toBe(nonceOf(policy));
  });

  it("adds report-uri from CSP_REPORT_URI", () => {
    vi.stubEnv("CSP_REPORT_URI", "https://csp.example.com/report");
    const policy = proxy(request("https://mcp.n8nworkflow.com/")).headers.get(
      "content-security-policy",
    );
    expect(policy).toContain("report-uri https://csp.example.com/report");
  });

  it.each([
    "/api/dashboard/account",
    "/_next/static/chunks/main.js",
    "/_next/webpack-hmr",
    "/favicon.ico",
    "/icon",
    "/robots.txt",
    "/sitemap.xml",
    "/llms.txt",
    "/opengraph-image",
    "/logo.png",
    "/mcp",
    "/.well-known/oauth-protected-resource",
  ])("skips the page policy for %s", (path) => {
    const response = proxy(request(`https://mcp.n8nworkflow.com${path}`));
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("content-security-policy-report-only")).toBeNull();
    expect(forwarded(response, "x-nonce")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps the MCP endpoint rewrite and noindex", () => {
    const response = proxy(request("https://mcp.n8nworkflow.com/mcp"));
    expect(new URL(response.headers.get("x-middleware-rewrite")!).pathname).toBe("/mcp");
    expect(response.headers.get("x-robots-tag")).toBe("noindex,nofollow");
  });
});

describe("signed-out dashboard redirect (dashboard host)", () => {
  const host = "https://dashboard.n8nworkflow.com";

  it("sends a visit without a session cookie to /login with the external path as next", () => {
    const response = proxy(request(`${host}/billing?tab=invoices&x=1`));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe(host);
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/billing?tab=invoices&x=1");
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("content-security-policy")).toBeNull();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex,nofollow");
  });

  it("keeps the OAuth consent query, the dashboard root and prefixed paths", () => {
    const consent = proxy(request(`${host}/oauth/consent?authorization_id=abc`));
    expect(new URL(consent.headers.get("location")!).searchParams.get("next")).toBe(
      "/oauth/consent?authorization_id=abc",
    );

    const root = proxy(request(`${host}/`));
    expect(new URL(root.headers.get("location")!).searchParams.get("next")).toBe("/");

    const prefixed = proxy(request(`${host}/dashboard/usage`));
    expect(new URL(prefixed.headers.get("location")!).searchParams.get("next")).toBe(
      "/dashboard/usage",
    );
  });

  it.each(["n8nmcp-session=1", "other=1; n8nmcp-session=1"])(
    "renders the dashboard when the HttpOnly presence marker is present (%s)",
    (cookie) => {
      const response = proxy(request(`${host}/billing`, { cookie }));
      expect(response.headers.get("location")).toBeNull();
      expect(new URL(response.headers.get("x-middleware-rewrite")!).pathname).toBe(
        "/dashboard/billing",
      );
    },
  );

  it.each([
    "sb-abcdefgh-auth-token.0=base64-a; sb-abcdefgh-auth-token.1=b",
    "sb-abcdefgh-auth-token=base64-a",
    "other=1; sb-abcdefgh-auth-token.0=base64-a",
  ])("still accepts a legacy session cookie during the migration window (%s)", (cookie) => {
    const response = proxy(request(`${host}/billing`, { cookie }));
    expect(response.headers.get("location")).toBeNull();
    expect(new URL(response.headers.get("x-middleware-rewrite")!).pathname).toBe(
      "/dashboard/billing",
    );
  });

  it.each([
    "sb-abcdefgh-auth-token.1=b",
    "sb-otherproj-auth-token.0=base64-a",
    "sb-abcdefgh-auth-token-code-verifier=x",
    "n8nmcp-sessionx=1",
    "n8nmcp-rt=rt",
  ])("treats an unrelated or partial cookie as signed out (%s)", (cookie) => {
    const response = proxy(request(`${host}/billing`, { cookie }));
    expect(response.status).toBe(307);
  });

  it.each([
    "/login",
    "/login?next=%2Fbilling",
    "/signup",
    "/forgot-password",
    "/reset-password",
    "/auth/callback",
    "/auth/callback?next=%2Fbilling",
    "/api/auth/refresh",
    "/api/dashboard/account",
    "/.well-known/oauth-protected-resource",
  ])("never redirects %s", (path) => {
    const response = proxy(request(`${host}${path}`));
    expect(response.headers.get("location")).toBeNull();
  });

  it("accepts any Supabase session cookie when no Supabase URL is configured", () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_URL", "");
    const withCookie = proxy(request(`${host}/billing`, { cookie: "sb-zzz-auth-token.0=a" }));
    expect(withCookie.headers.get("location")).toBeNull();
    expect(proxy(request(`${host}/billing`)).status).toBe(307);
  });
});

describe("signed-out dashboard redirect (main host)", () => {
  it("redirects /dashboard paths without a session cookie and leaves other pages alone", () => {
    const response = proxy(request("https://mcp.n8nworkflow.com/dashboard/api-keys?new=1"));
    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.origin).toBe("https://mcp.n8nworkflow.com");
    expect(location.pathname).toBe("/login");
    expect(location.searchParams.get("next")).toBe("/dashboard/api-keys?new=1");

    for (const path of ["/", "/pricing", "/dashboards", "/login", "/signup"]) {
      expect(
        proxy(request(`https://mcp.n8nworkflow.com${path}`)).headers.get("location"),
        path,
      ).toBeNull();
    }
  });
});

describe("signed-out dashboard redirect on a single origin (next dev)", () => {
  afterEach(() => {
    vi.resetModules();
  });

  async function devProxy() {
    for (const name of ["MCP_SITE", "DOCS", "BLOG", "DASHBOARD"]) {
      vi.stubEnv(`NEXT_PUBLIC_${name}_URL`, "http://localhost:3000");
    }
    vi.resetModules();
    return (await import("@/proxy")).proxy;
  }

  it("redirects /dashboard without a cookie and passes with one", async () => {
    const run = await devProxy();

    const signedOut = run(request("http://localhost:3000/dashboard/billing?x=1"));
    expect(signedOut.status).toBe(307);
    expect(signedOut.headers.get("location")).toBe(
      "http://localhost:3000/login?next=%2Fdashboard%2Fbilling%3Fx%3D1",
    );

    const signedIn = run(
      request("http://localhost:3000/dashboard/billing", { cookie: SESSION_COOKIE }),
    );
    expect(signedIn.headers.get("location")).toBeNull();
    expect(nonceOf(signedIn.headers.get("content-security-policy"))).toBeTruthy();

    for (const path of ["/", "/login?next=%2Fdashboard", "/signup", "/docs", "/blog"]) {
      expect(run(request(`http://localhost:3000${path}`)).headers.get("location"), path).toBeNull();
    }
  });
});
