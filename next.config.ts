import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { withSentryConfig } from "@sentry/nextjs";

const DEV_ORIGIN = "http://localhost:3000";

/**
 * Browser bundles only see NEXT_PUBLIC_* variables. Local `.env` files often
 * carry the server-side names only, so fall back to those for the Supabase
 * client; and in `next dev` point every site surface at the dev origin so
 * navigation and canonical URLs stay on localhost instead of production.
 */
function publicEnv(phase: string): Record<string, string> {
  const isDev = phase === PHASE_DEVELOPMENT_SERVER;
  const candidates: Record<string, string | undefined> = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.SUPABASE_PUBLISHABLE_KEY,
    NEXT_PUBLIC_MCP_SITE_URL:
      process.env.NEXT_PUBLIC_MCP_SITE_URL ?? (isDev ? DEV_ORIGIN : undefined),
    NEXT_PUBLIC_DOCS_URL: process.env.NEXT_PUBLIC_DOCS_URL ?? (isDev ? DEV_ORIGIN : undefined),
    NEXT_PUBLIC_BLOG_URL: process.env.NEXT_PUBLIC_BLOG_URL ?? (isDev ? DEV_ORIGIN : undefined),
    NEXT_PUBLIC_DASHBOARD_URL:
      process.env.NEXT_PUBLIC_DASHBOARD_URL ?? (isDev ? DEV_ORIGIN : undefined),
  };
  return Object.fromEntries(
    Object.entries(candidates).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

/**
 * Response headers the app sends on every route, so it does not depend on the
 * reverse proxy for them. Pages also get a per-request nonce
 * Content-Security-Policy from src/proxy.ts (see src/lib/csp.ts). HSTS is
 * left to the TLS terminator, which knows whether the request came over HTTPS.
 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
];

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default (phase: string) =>
  withSentryConfig(
    { ...nextConfig, env: publicEnv(phase) },
    {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      widenClientFileUpload: true,
    },
  );
