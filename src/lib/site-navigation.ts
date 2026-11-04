// Shared navigation targets for the public (marketing) surfaces.
//
// Production serves four hosts from one Next.js app (see `src/proxy.ts`):
// the docs, blog and dashboard hosts rewrite "/" to their own section, so
// cross-surface links must be absolute. When every surface resolves to the
// same origin (local development, single-host previews) the proxy never
// rewrites, so the same targets are reached through their path prefix on
// the one origin instead.

import { canonicalUrl, siteUrl, type SiteSurface } from "@/lib/site-domains";

export const GITHUB_URL = "https://github.com/czlonkowski/n8n-mcp";

export type SiteNavLink = {
  label: string;
  href: string;
  external?: boolean;
};

function cleanPath(path: string): string {
  const withSlash = path.startsWith("/") ? path : `/${path}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
}

const SECONDARY_SURFACES = ["docs", "blog", "dashboard"] as const;

function sharesMainOrigin(surface: SiteSurface): boolean {
  return siteUrl(surface) === siteUrl("mcp");
}

/** True when the app is served from one origin only (dev, single-host previews). */
function isSingleOrigin(surface: SiteSurface): boolean {
  if (surface !== "mcp") return sharesMainOrigin(surface);
  return SECONDARY_SURFACES.every(sharesMainOrigin);
}

/** Link to `path` on `surface`, absolute across hosts or path-prefixed on one origin. */
export function surfaceHref(surface: SiteSurface, path = "/"): string {
  const clean = cleanPath(path);
  if (!isSingleOrigin(surface)) return canonicalUrl(clean, surface);
  if (surface === "mcp") return clean;
  return clean === "/" ? `/${surface}` : `/${surface}${clean}`;
}

/** The sign-in page lives at `/login` on both the dashboard host and the main host. */
export function loginHref(): string {
  return isSingleOrigin("dashboard") ? "/login" : canonicalUrl("/login", "dashboard");
}

export function buildPrimaryNav(): SiteNavLink[] {
  return [
    { label: "Pricing", href: surfaceHref("mcp", "/pricing") },
    { label: "Docs", href: surfaceHref("docs") },
    { label: "FAQ", href: surfaceHref("docs", "/faq") },
    { label: "Blog", href: surfaceHref("blog") },
    { label: "GitHub", href: GITHUB_URL, external: true },
  ];
}

export type FooterSection = { title: string; links: SiteNavLink[] };

export function buildFooterSections(): FooterSection[] {
  return [
    {
      title: "Product",
      links: [
        { label: "Pricing", href: surfaceHref("mcp", "/pricing") },
        { label: "Documentation", href: surfaceHref("docs") },
        { label: "Getting started", href: surfaceHref("docs", "/getting-started") },
        { label: "MCP tools", href: surfaceHref("docs", "/tools") },
      ],
    },
    {
      title: "Resources",
      links: [
        { label: "Blog", href: surfaceHref("blog") },
        { label: "FAQ", href: surfaceHref("docs", "/faq") },
        { label: "Security model", href: surfaceHref("docs", "/security") },
        { label: "llms.txt", href: surfaceHref("mcp", "/llms.txt") },
      ],
    },
    {
      title: "Community",
      links: [
        { label: "GitHub", href: GITHUB_URL, external: true },
        {
          label: "Model Context Protocol",
          href: "https://modelcontextprotocol.io",
          external: true,
        },
        { label: "n8n", href: "https://n8n.io", external: true },
      ],
    },
  ];
}
