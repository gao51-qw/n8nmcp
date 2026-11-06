import { afterEach, describe, expect, it, vi } from "vitest";

async function loadNavigation(env: Record<string, string | undefined>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) vi.stubEnv(key, "");
    else vi.stubEnv(key, value);
  }
  return import("@/lib/site-navigation");
}

describe("site navigation targets", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("links across the production hosts with absolute URLs", async () => {
    const nav = await loadNavigation({
      NEXT_PUBLIC_MCP_SITE_URL: "https://mcp.example.test",
      NEXT_PUBLIC_DOCS_URL: "https://docs.example.test",
      NEXT_PUBLIC_BLOG_URL: "https://blog.example.test",
      NEXT_PUBLIC_DASHBOARD_URL: "https://dashboard.example.test",
    });

    expect(nav.surfaceHref("mcp")).toBe("https://mcp.example.test");
    expect(nav.surfaceHref("mcp", "pricing")).toBe("https://mcp.example.test/pricing");
    expect(nav.surfaceHref("docs")).toBe("https://docs.example.test");
    expect(nav.surfaceHref("docs", "/tools")).toBe("https://docs.example.test/tools");
    expect(nav.surfaceHref("blog")).toBe("https://blog.example.test");
    expect(nav.surfaceHref("dashboard")).toBe("https://dashboard.example.test");
    expect(nav.loginHref()).toBe("https://dashboard.example.test/login");
  });

  it("falls back to path prefixes when every surface shares one origin", async () => {
    const nav = await loadNavigation({
      NEXT_PUBLIC_MCP_SITE_URL: "http://localhost:3000",
      NEXT_PUBLIC_DOCS_URL: "http://localhost:3000",
      NEXT_PUBLIC_BLOG_URL: "http://localhost:3000",
      NEXT_PUBLIC_DASHBOARD_URL: "http://localhost:3000",
    });

    expect(nav.surfaceHref("mcp")).toBe("/");
    expect(nav.surfaceHref("mcp", "/pricing")).toBe("/pricing");
    expect(nav.surfaceHref("docs")).toBe("/docs");
    expect(nav.surfaceHref("docs", "/tools/")).toBe("/docs/tools");
    expect(nav.surfaceHref("blog")).toBe("/blog");
    expect(nav.surfaceHref("dashboard")).toBe("/dashboard");
    expect(nav.loginHref()).toBe("/login");
  });

  it("only points at routes that exist in the app", async () => {
    const nav = await loadNavigation({
      NEXT_PUBLIC_MCP_SITE_URL: "https://mcp.example.test",
      NEXT_PUBLIC_DOCS_URL: "https://docs.example.test",
      NEXT_PUBLIC_BLOG_URL: "https://blog.example.test",
      NEXT_PUBLIC_DASHBOARD_URL: "https://dashboard.example.test",
    });
    const internal = [
      ...nav.buildPrimaryNav(),
      ...nav.buildFooterSections().flatMap((s) => s.links),
    ]
      .filter((link) => !link.external)
      .map((link) => new URL(link.href));

    // Mirrors the docs-host rewrite in src/proxy.ts and the sitemap surfaces
    // in src/lib/geo-content.ts.
    const allowed: Record<string, string[]> = {
      "mcp.example.test": ["/pricing", "/llms.txt"],
      "docs.example.test": ["/", "/tools", "/getting-started", "/security", "/faq"],
      "blog.example.test": ["/"],
    };

    for (const url of internal) {
      expect(allowed[url.hostname], `unexpected host ${url.hostname}`).toBeDefined();
      expect(allowed[url.hostname], `unexpected path ${url.href}`).toContain(url.pathname);
    }
    for (const link of [
      ...nav.buildPrimaryNav(),
      ...nav.buildFooterSections().flatMap((s) => s.links),
    ]) {
      if (link.external) expect(link.href.startsWith("https://")).toBe(true);
    }
  });
});

describe("auth page links", () => {
  const production = {
    NEXT_PUBLIC_MCP_SITE_URL: "https://mcp.example.test",
    NEXT_PUBLIC_DOCS_URL: "https://docs.example.test",
    NEXT_PUBLIC_BLOG_URL: "https://blog.example.test",
    NEXT_PUBLIC_DASHBOARD_URL: "https://dashboard.example.test",
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("points sign-in, sign-up and password reset at the dashboard host", async () => {
    const nav = await loadNavigation(production);

    expect(nav.signupHref()).toBe("https://dashboard.example.test/signup");
    expect(nav.forgotPasswordHref()).toBe("https://dashboard.example.test/forgot-password");
    expect(nav.loginHref("/dashboard/billing")).toBe(
      "https://dashboard.example.test/login?next=%2Fdashboard%2Fbilling",
    );
    expect(nav.signupHref("/dashboard/billing?plan=pro")).toBe(
      "https://dashboard.example.test/signup?next=%2Fdashboard%2Fbilling%3Fplan%3Dpro",
    );
  });

  it("drops unsafe or default next destinations", async () => {
    const nav = await loadNavigation(production);

    expect(nav.signupHref("https://evil.example")).toBe("https://dashboard.example.test/signup");
    expect(nav.signupHref("//evil.example")).toBe("https://dashboard.example.test/signup");
    expect(nav.loginHref("/dashboard")).toBe("https://dashboard.example.test/login");
    expect(nav.forgotPasswordHref(null)).toBe("https://dashboard.example.test/forgot-password");
  });

  it("uses same-origin paths when every surface shares one origin", async () => {
    const nav = await loadNavigation({
      NEXT_PUBLIC_MCP_SITE_URL: "http://localhost:3000",
      NEXT_PUBLIC_DOCS_URL: "http://localhost:3000",
      NEXT_PUBLIC_BLOG_URL: "http://localhost:3000",
      NEXT_PUBLIC_DASHBOARD_URL: "http://localhost:3000",
    });

    expect(nav.signupHref()).toBe("/signup");
    expect(nav.forgotPasswordHref()).toBe("/forgot-password");
    expect(nav.loginHref("/dashboard/billing")).toBe("/login?next=%2Fdashboard%2Fbilling");
  });

  it("builds absolute Supabase redirect URLs on the dashboard host", async () => {
    const nav = await loadNavigation(production);

    expect(nav.authRedirectUrl("/reset-password")).toBe(
      "https://dashboard.example.test/reset-password",
    );
    expect(nav.authRedirectUrl("/reset-password", "https://mcp.example.test")).toBe(
      "https://dashboard.example.test/reset-password",
    );
    expect(nav.authRedirectUrl("//evil.example/x", "https://dashboard.example.test")).toBe(
      "https://dashboard.example.test/dashboard",
    );
    // An unconfigured origin (preview build, another dev port) returns to itself.
    expect(nav.authRedirectUrl("/dashboard", "http://localhost:4000")).toBe(
      "http://localhost:4000/dashboard",
    );
    expect(nav.authRedirectUrl("/dashboard", "javascript:alert(1)")).toBe(
      "https://dashboard.example.test/dashboard",
    );
  });
});
