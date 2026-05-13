import { createFileRoute } from "@tanstack/react-router";
import { getAllPosts } from "@/lib/blog";

const SITE = "https://n8nmcp.lovable.app";
const PAGES: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/pricing", changefreq: "monthly", priority: "0.8" },
  { path: "/docs", changefreq: "weekly", priority: "0.8" },
  { path: "/docs/getting-started", changefreq: "monthly", priority: "0.7" },
  { path: "/docs/concepts", changefreq: "monthly", priority: "0.7" },
  { path: "/docs/clients", changefreq: "monthly", priority: "0.7" },
  { path: "/docs/api-keys", changefreq: "monthly", priority: "0.7" },
  { path: "/docs/n8n-instances", changefreq: "monthly", priority: "0.7" },
  { path: "/docs/tools", changefreq: "monthly", priority: "0.7" },
  { path: "/docs/quotas", changefreq: "monthly", priority: "0.7" },
  { path: "/docs/security", changefreq: "monthly", priority: "0.7" },
  { path: "/faq", changefreq: "monthly", priority: "0.6" },
  { path: "/blog", changefreq: "weekly", priority: "0.7" },
  { path: "/login", changefreq: "yearly", priority: "0.3" },
  { path: "/signup", changefreq: "yearly", priority: "0.5" },
  { path: "/terms", changefreq: "yearly", priority: "0.3" },
  { path: "/privacy", changefreq: "yearly", priority: "0.3" },
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const lastmod = new Date().toISOString().slice(0, 10);
        const allPages = [
          ...PAGES,
          ...getAllPosts().map((p) => ({
            path: `/blog/${p.slug}`,
            changefreq: "monthly",
            priority: "0.6",
          })),
        ];
        const urls = allPages.map(
          (p) =>
            `  <url>\n` +
            `    <loc>${SITE}${p.path}</loc>\n` +
            `    <lastmod>${lastmod}</lastmod>\n` +
            `    <changefreq>${p.changefreq}</changefreq>\n` +
            `    <priority>${p.priority}</priority>\n` +
            `  </url>`,
        ).join("\n");

        const body =
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
          `${urls}\n` +
          `</urlset>\n`;

        return new Response(body, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
