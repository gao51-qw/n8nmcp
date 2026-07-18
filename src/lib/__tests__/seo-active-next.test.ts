import { describe, expect, it } from "vitest";
import { metadata } from "@/app/layout";
import { buildRobots } from "@/app/robots";
import { buildSitemap } from "@/app/sitemap";
import { GET as getMcpGet } from "@/app/mcp/route";
import {
  SITE,
  buildFaqPageJsonLd,
  buildOrganizationJsonLd,
  buildSoftwareApplicationJsonLd,
  buildWebSiteJsonLd,
} from "@/lib/seo-jsonld";
import { homepageFaq } from "@/lib/geo-content";
import { MCP_ENDPOINT_URL, canonicalUrl, siteUrl } from "@/lib/site-domains";

describe("active Next SEO surface", () => {
  it("defines canonical metadata and social image assets for the MCP product surface", () => {
    expect(metadata.metadataBase?.toString()).toBe(`${siteUrl("mcp")}/`);
    expect(metadata.alternates).toMatchObject({ canonical: "/" });
    expect(metadata.openGraph).toMatchObject({
      url: "/",
      siteName: "n8n-mcp",
      type: "website",
    });
    expect(metadata.twitter).toMatchObject({
      card: "summary_large_image",
      images: ["/opengraph-image"],
    });
  });

  it("builds host-aware robots rules", () => {
    const mcp = buildRobots("mcp");
    const dashboard = buildRobots("dashboard");

    expect(mcp.sitemap).toBe(`${siteUrl("mcp")}/sitemap.xml`);
    expect(JSON.stringify(mcp.rules)).toContain("/mcp");
    expect(JSON.stringify(mcp.rules)).toContain("/api");
    expect(JSON.stringify(mcp.rules)).toContain("GPTBot");
    expect(JSON.stringify(dashboard.rules)).toContain('"disallow":"/"');
  });

  it("keeps MCP sitemap scoped to marketing URLs", () => {
    const urls = buildSitemap("mcp").map((entry) => entry.url);

    expect(urls).toContain(siteUrl("mcp"));
    expect(urls).toContain(canonicalUrl("/pricing", "mcp"));
    expect(urls).not.toContain(MCP_ENDPOINT_URL);
    expect(urls).not.toContain(canonicalUrl("/api/public/mcp", "mcp"));
  });

  it("builds docs, blog and dashboard sitemap surfaces", () => {
    const docs = buildSitemap("docs").map((entry) => entry.url);
    const blog = buildSitemap("blog").map((entry) => entry.url);
    const dashboard = buildSitemap("dashboard").map((entry) => entry.url);

    expect(docs).toContain(siteUrl("docs"));
    expect(docs).toContain(canonicalUrl("/getting-started", "docs"));
    expect(docs).toContain(canonicalUrl("/security", "docs"));
    expect(docs).toContain(canonicalUrl("/faq", "docs"));
    expect(docs).toContain(canonicalUrl("/tools", "docs"));
    expect(blog).toContain(siteUrl("blog"));
    expect(blog.some((url) => url.startsWith(`${siteUrl("blog")}/`))).toBe(true);
    expect(dashboard).toEqual([]);
  });

  it("marks the MCP endpoint noindex", async () => {
    const response = await getMcpGet(new Request(`${SITE}/mcp`));

    expect(response.status).toBe(405);
    expect(response.headers.get("X-Robots-Tag")).toBe("noindex,nofollow");
  });

  it("builds website, organization, software and FAQ JSON-LD", () => {
    expect(SITE).toBe(siteUrl("mcp"));
    expect(JSON.parse(buildWebSiteJsonLd())).toMatchObject({
      "@type": "WebSite",
      url: siteUrl("mcp"),
    });
    expect(JSON.parse(buildSoftwareApplicationJsonLd())).toMatchObject({
      "@type": "SoftwareApplication",
      name: "n8n-mcp",
      applicationCategory: "DeveloperApplication",
    });
    expect(JSON.parse(buildOrganizationJsonLd("docs"))).toMatchObject({
      "@type": "Organization",
      url: siteUrl("docs"),
    });
    expect(JSON.parse(buildFaqPageJsonLd([...homepageFaq]))).toMatchObject({
      "@type": "FAQPage",
    });
  });
});
