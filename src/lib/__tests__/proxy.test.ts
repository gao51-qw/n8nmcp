import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
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
});
