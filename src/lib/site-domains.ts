export type SiteSurface = "mcp" | "docs" | "blog" | "dashboard";

export type SiteDomain = {
  host: string;
  url: string;
  index: boolean;
};

function cleanOrigin(value: string | undefined, fallback: string): string {
  return (value || fallback).replace(/\/+$/, "");
}

function configuredDomain(value: string | undefined, fallback: string): SiteDomain {
  const url = cleanOrigin(value, fallback);
  return {
    host: new URL(url).hostname,
    url,
    index: true,
  };
}

export const SITE_DOMAINS: Record<SiteSurface, SiteDomain> = {
  mcp: configuredDomain(process.env.NEXT_PUBLIC_MCP_SITE_URL, "https://mcp.n8nworkflow.com"),
  docs: configuredDomain(process.env.NEXT_PUBLIC_DOCS_URL, "https://docs.n8nworkflow.com"),
  blog: configuredDomain(process.env.NEXT_PUBLIC_BLOG_URL, "https://blog.n8nworkflow.com"),
  dashboard: {
    ...configuredDomain(process.env.NEXT_PUBLIC_DASHBOARD_URL, "https://dashboard.n8nworkflow.com"),
    index: false,
  },
};

export const MCP_ENDPOINT_URL = cleanOrigin(
  process.env.NEXT_PUBLIC_MCP_ENDPOINT_URL,
  `${SITE_DOMAINS.mcp.url}/mcp`,
);

export const DEFAULT_SURFACE: SiteSurface = "mcp";

export function normalizeHost(host: string | null | undefined): string {
  if (!host) return "";
  return host.trim().toLowerCase().replace(/:\d+$/, "");
}

export function surfaceFromHost(host: string | null | undefined): SiteSurface {
  const normalized = normalizeHost(host);
  const match = (Object.keys(SITE_DOMAINS) as SiteSurface[]).find(
    (surface) => SITE_DOMAINS[surface].host === normalized,
  );
  return match ?? DEFAULT_SURFACE;
}

export function siteUrl(surface: SiteSurface = DEFAULT_SURFACE): string {
  return SITE_DOMAINS[surface].url;
}

export function canonicalUrl(pathname = "/", surface: SiteSurface = DEFAULT_SURFACE): string {
  const cleanPath = pathname.startsWith("/") ? pathname : `/${pathname}`;
  return cleanPath === "/" ? siteUrl(surface) : `${siteUrl(surface)}${cleanPath}`;
}
