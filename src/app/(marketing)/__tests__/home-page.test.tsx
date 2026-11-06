// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("home page hero", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("leads with signup and docs, and shows the endpoint as copyable text", async () => {
    vi.stubEnv("NEXT_PUBLIC_MCP_SITE_URL", "https://mcp.example.test");
    vi.stubEnv("NEXT_PUBLIC_DOCS_URL", "https://docs.example.test");
    vi.stubEnv("NEXT_PUBLIC_BLOG_URL", "https://blog.example.test");
    vi.stubEnv("NEXT_PUBLIC_DASHBOARD_URL", "https://dashboard.example.test");
    vi.stubEnv("NEXT_PUBLIC_MCP_ENDPOINT_URL", "");
    vi.resetModules();
    const { default: HomePage } = await import("../page");
    const doc = new DOMParser().parseFromString(renderToStaticMarkup(<HomePage />), "text/html");
    const links = Array.from(doc.querySelectorAll("a")).map((a) => ({
      text: a.textContent?.trim() ?? "",
      href: a.getAttribute("href") ?? "",
    }));

    expect(links.find((l) => l.text === "Get started")?.href).toBe(
      "https://dashboard.example.test/signup",
    );
    expect(links.find((l) => l.text === "Read the setup guide")?.href).toBe(
      "https://docs.example.test/getting-started",
    );
    // The endpoint answers GET with 405, so it is shown, not linked.
    expect(links.some((l) => l.href.endsWith("/mcp"))).toBe(false);
    expect(doc.querySelector('code[aria-label="MCP endpoint URL"]')?.textContent).toBe(
      "https://mcp.example.test/mcp",
    );
    // GEO content and structured data stay on the page.
    expect(doc.querySelectorAll('script[type="application/ld+json"]').length).toBe(4);
    expect(doc.body.textContent).toContain("What is n8n-mcp?");
  });
});
