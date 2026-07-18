import { headers } from "next/headers";
import type { MetadataRoute } from "next";
import { activeSeoPagesBySurface } from "@/lib/geo-content";
import { getBlogPosts } from "@/lib/blog-content.server";
import { canonicalUrl, surfaceFromHost, type SiteSurface } from "@/lib/site-domains";

export function buildSitemap(surface: SiteSurface, now = new Date()): MetadataRoute.Sitemap {
  if (surface === "dashboard") return [];

  const basePages = activeSeoPagesBySurface[surface].map((page) => ({
    url: canonicalUrl(page.path, surface),
    lastModified: now,
    changeFrequency: page.changeFrequency,
    priority: page.priority,
  }));

  if (surface !== "blog") return basePages;

  const posts = getBlogPosts().map((post) => ({
    url: canonicalUrl(`/${post.slug}`, "blog"),
    lastModified: new Date(post.updated ?? post.date),
    changeFrequency: "monthly" as const,
    priority: 0.65,
  }));

  return [...basePages, ...posts];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const surface = surfaceFromHost((await headers()).get("host"));
  return buildSitemap(surface);
}
