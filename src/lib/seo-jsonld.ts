// Shared JSON-LD builders. Returned strings are dropped into
// head().scripts[].children — the head plugin handles escaping.

const SITE = "https://n8nmcp.lovable.app";
const ORG = {
  "@type": "Organization",
  name: "n8n-mcp",
  url: SITE,
  logo: `${SITE}/favicon.ico`,
};

export function buildBreadcrumbJsonLd(
  trail: Array<{ name: string; path: string }>,
): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: `${SITE}${t.path}`,
    })),
  });
}

export function buildDocsTechArticleJsonLd(opts: {
  title: string;
  description: string;
  path: string;
  inLanguage?: string;
}): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: opts.title,
    description: opts.description,
    inLanguage: opts.inLanguage ?? "en",
    author: ORG,
    publisher: ORG,
    mainEntityOfPage: `${SITE}${opts.path}`,
  });
}

export function buildWebSiteJsonLd(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "n8n-mcp",
    url: SITE,
    publisher: ORG,
  });
}