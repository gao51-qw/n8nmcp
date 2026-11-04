import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { proxy } from "@/proxy";

describe("domain proxy", () => {
  it("keeps the shared login route on the dashboard domain", () => {
    const request = new NextRequest("https://dashboard.n8nworkflow.com/login?next=%2F", {
      headers: { host: "dashboard.n8nworkflow.com" },
    });

    const response = proxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toBe("noindex,nofollow");
  });

  function rewriteTarget(host: string, path: string): string | null {
    const request = new NextRequest(`https://${host}${path}`, { headers: { host } });
    const rewrite = proxy(request).headers.get("x-middleware-rewrite");
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
