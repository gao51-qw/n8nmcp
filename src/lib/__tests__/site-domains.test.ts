import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MCP_ENDPOINT_URL,
  canonicalUrl,
  normalizeHost,
  siteUrl,
  surfaceFromHost,
} from "@/lib/site-domains";

describe("site domain helpers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("normalizes hosts and strips ports", () => {
    expect(normalizeHost("mcp.n8nworkflow.com:3000")).toBe("mcp.n8nworkflow.com");
    expect(normalizeHost(" DOCS.N8NWORKFLOW.COM ")).toBe("docs.n8nworkflow.com");
  });

  it("maps production subdomains to surfaces", () => {
    expect(surfaceFromHost("mcp.n8nworkflow.com")).toBe("mcp");
    expect(surfaceFromHost("mcp.n8nworkflow.com:3000")).toBe("mcp");
    expect(surfaceFromHost("docs.n8nworkflow.com")).toBe("docs");
    expect(surfaceFromHost("blog.n8nworkflow.com")).toBe("blog");
    expect(surfaceFromHost("dashboard.n8nworkflow.com")).toBe("dashboard");
  });

  it("falls back unknown hosts to the MCP marketing surface", () => {
    expect(surfaceFromHost("localhost:3000")).toBe("mcp");
    expect(siteUrl("mcp")).toBe("https://mcp.n8nworkflow.com");
    expect(canonicalUrl("/tools", "docs")).toBe("https://docs.n8nworkflow.com/tools");
  });

  it("exposes the canonical MCP endpoint", () => {
    expect(MCP_ENDPOINT_URL).toBe("https://mcp.n8nworkflow.com/mcp");
  });

  it("derives deployable hosts from public surface URLs", async () => {
    vi.stubEnv("NEXT_PUBLIC_MCP_SITE_URL", "https://mcp.example.test");
    vi.stubEnv("NEXT_PUBLIC_DOCS_URL", "https://docs.example.test");
    vi.stubEnv("NEXT_PUBLIC_BLOG_URL", "https://blog.example.test");
    vi.stubEnv("NEXT_PUBLIC_DASHBOARD_URL", "https://app.example.test");
    vi.resetModules();

    const configuredDomains = await import("@/lib/site-domains");

    expect(configuredDomains.surfaceFromHost("mcp.example.test")).toBe("mcp");
    expect(configuredDomains.surfaceFromHost("docs.example.test")).toBe("docs");
    expect(configuredDomains.surfaceFromHost("blog.example.test")).toBe("blog");
    expect(configuredDomains.surfaceFromHost("app.example.test")).toBe("dashboard");
  });
});
