import { headers } from "next/headers";
import type { MetadataRoute } from "next";
import { canonicalUrl, siteUrl, surfaceFromHost, type SiteSurface } from "@/lib/site-domains";

const aiBots = [
  "GPTBot",
  "ChatGPT-User",
  "OAI-SearchBot",
  "ClaudeBot",
  "anthropic-ai",
  "Claude-Web",
  "PerplexityBot",
  "Perplexity-User",
  "Google-Extended",
  "GoogleOther",
  "CCBot",
  "Applebot-Extended",
];

export function buildRobots(surface: SiteSurface): MetadataRoute.Robots {
  if (surface === "dashboard") {
    return {
      rules: [{ userAgent: "*", disallow: "/" }],
      sitemap: canonicalUrl("/sitemap.xml", surface),
    };
  }

  if (surface === "mcp") {
    const disallow = ["/mcp", "/api", "/health"];
    return {
      rules: [
        { userAgent: "*", allow: "/", disallow },
        ...aiBots.map((userAgent) => ({ userAgent, allow: "/", disallow })),
      ],
      sitemap: `${siteUrl("mcp")}/sitemap.xml`,
    };
  }

  return {
    rules: [{ userAgent: "*", allow: "/" }],
    sitemap: canonicalUrl("/sitemap.xml", surface),
  };
}

export default async function robots(): Promise<MetadataRoute.Robots> {
  const surface = surfaceFromHost((await headers()).get("host"));
  return buildRobots(surface);
}
