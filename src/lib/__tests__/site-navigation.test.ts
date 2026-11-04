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
