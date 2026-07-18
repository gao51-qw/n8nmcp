import { canonicalUrl, siteUrl, SITE_DOMAINS, type SiteSurface } from "@/lib/site-domains";
import { SITE_CONTACT_EMAIL } from "@/lib/site-contact";

export const SITE = siteUrl("mcp");

function organization(surface: SiteSurface = "mcp") {
  const url = siteUrl(surface);
  return {
    "@type": "Organization",
    name: "n8n-mcp",
    url,
    logo: `${SITE_DOMAINS.mcp.url}/favicon.ico`,
    contactPoint: {
      "@type": "ContactPoint",
      contactType: "security",
      email: SITE_CONTACT_EMAIL,
    },
    sameAs: [
      process.env.NEXT_PUBLIC_GITHUB_URL,
      process.env.NEXT_PUBLIC_LINKEDIN_URL,
      process.env.NEXT_PUBLIC_X_URL,
      process.env.NEXT_PUBLIC_YOUTUBE_URL,
    ].filter(Boolean),
  };
}

export function buildBreadcrumbJsonLd(
  trail: Array<{ name: string; path: string }>,
  surface: SiteSurface = "mcp",
): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: trail.map((t, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: t.name,
      item: canonicalUrl(t.path, surface),
    })),
  });
}

export function buildDocsTechArticleJsonLd(opts: {
  title: string;
  description: string;
  path: string;
  inLanguage?: string;
  surface?: SiteSurface;
}): string {
  const surface = opts.surface ?? "docs";
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "TechArticle",
    headline: opts.title,
    description: opts.description,
    inLanguage: opts.inLanguage ?? "en",
    author: organization(surface),
    publisher: organization(surface),
    mainEntityOfPage: canonicalUrl(opts.path, surface),
  });
}

export function buildWebSiteJsonLd(surface: SiteSurface = "mcp"): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: "n8n-mcp",
    url: siteUrl(surface),
    publisher: organization(surface),
  });
}

export function buildSoftwareApplicationJsonLd(): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "n8n-mcp",
    description:
      "Hosted MCP gateway that connects self-hosted n8n workflows to Claude, ChatGPT, Cursor, VS Code and other MCP-compatible AI clients.",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    url: SITE,
    publisher: organization("mcp"),
    offers: [
      {
        "@type": "Offer",
        name: "Free",
        price: "0",
        priceCurrency: "USD",
      },
    ],
  });
}

export function buildOrganizationJsonLd(surface: SiteSurface = "mcp"): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    ...organization(surface),
  });
}

export function buildFaqPageJsonLd(items: Array<{ q: string; a: string }>): string {
  return JSON.stringify({
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  });
}
