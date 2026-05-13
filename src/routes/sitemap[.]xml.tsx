import { createFileRoute } from "@tanstack/react-router";
import { getAllPosts } from "@/lib/blog";
import { LOCALES, DEFAULT_LOCALE } from "@/i18n/config";
import { LOCALE_HREFLANG, localizedUrl } from "@/lib/seo-i18n";

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
  { path: "/terms", changefreq: "yearly", priority: "0.3" },
  { path: "/privacy", changefreq: "yearly", priority: "0.3" },
];

// Auth-only pages stay un-localised — kept out of hreflang loop.
const NON_I18N_PAGES: Array<{ path: string; changefreq: string; priority: string }> = [
  { path: "/login", changefreq: "yearly", priority: "0.3" },
  { path: "/signup", changefreq: "yearly", priority: "0.5" },
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: () => {
        const lastmod = new Date().toISOString().slice(0, 10);
        const i18nPages = [
          ...PAGES,
          ...getAllPosts().map((p) => ({
            path: `/blog/${p.slug}`,
            changefreq: "monthly",
            priority: "0.6",
          })),
        ];

        // For each logical i18n path, emit one <url> per locale, each with
        // an embedded <xhtml:link> set pointing at every other locale plus
        // x-default → English. This is the format Google uses to discover
        // localised alternates. https://developers.google.com/search/docs/specialty/international/localized-versions
        const i18nBlocks = i18nPages.flatMap((p) =>
          LOCALES.map((locale) => {
            const alternates = LOCALES.map(
              (l) =>
                `    <xhtml:link rel="alternate" hreflang="${LOCALE_HREFLANG[l]}" href="${localizedUrl(p.path, l)}" />`,
            ).join("\n");
            return (
              `  <url>\n` +
              `    <loc>${localizedUrl(p.path, locale)}</loc>\n` +
              `    <lastmod>${lastmod}</lastmod>\n` +
              `    <changefreq>${p.changefreq}</changefreq>\n` +
              `    <priority>${p.priority}</priority>\n` +
              alternates + `\n` +
              `    <xhtml:link rel="alternate" hreflang="x-default" href="${localizedUrl(p.path, DEFAULT_LOCALE)}" />\n` +
              `  </url>`
            );
          }),
        );

        const nonI18nBlocks = NON_I18N_PAGES.map(
          (p) =>
            `  <url>\n` +
            `    <loc>${localizedUrl(p.path, DEFAULT_LOCALE)}</loc>\n` +
            `    <lastmod>${lastmod}</lastmod>\n` +
            `    <changefreq>${p.changefreq}</changefreq>\n` +
            `    <priority>${p.priority}</priority>\n` +
            `  </url>`,
        );

        const body =
          `<?xml version="1.0" encoding="UTF-8"?>\n` +
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n` +
          `        xmlns:xhtml="http://www.w3.org/1999/xhtml">\n` +
          `${[...i18nBlocks, ...nonI18nBlocks].join("\n")}\n` +
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
