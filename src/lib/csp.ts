// Content-Security-Policy for HTML pages, built per request by `src/proxy.ts`.
//
// The long-lived Supabase refresh token is in an HttpOnly cookie that script
// cannot read, but the short-lived access token is in page memory and the
// page can call /api/auth/* with the user's cookies, so script injection on
// any page is still a session takeover while it runs. The policy therefore
// relies on a per-request nonce plus 'strict-dynamic' instead of
// 'unsafe-inline':
//
// - The proxy sets the policy on the request headers; Next.js reads the
//   'nonce-…' source from it while rendering and stamps that nonce on its own
//   framework, page and inline flight scripts.
// - The proxy also sets `x-nonce`; the root layout passes it to the inline
//   theme <Script>.
// - 'strict-dynamic' lets nonced scripts load further scripts (Next.js chunks,
//   Paddle.js) and makes CSP3 browsers ignore the host allowlist, which stays
//   only as a fallback for older browsers.
//
// The reverse proxy owns the transport headers (HSTS); the app owns the
// policy. CSP_MODE=report is an emergency switch that sends the same policy
// as Content-Security-Policy-Report-Only.

export type CspMode = "enforce" | "report";

export type CspHeaderName = "Content-Security-Policy" | "Content-Security-Policy-Report-Only";

export type ContentSecurityPolicyOptions = {
  nonce: string;
  /** `next dev`: allows 'unsafe-eval' (React debugging) and ws: (HMR). */
  isDev: boolean;
  /** NEXT_PUBLIC_SUPABASE_URL; falls back to https://*.supabase.co. */
  supabaseUrl?: string;
  /** NEXT_PUBLIC_SENTRY_DSN; its ingest host is added to connect-src. */
  sentryDsn?: string;
  /** CSP_REPORT_URI; sent as report-uri when it is a valid http(s) URL. */
  reportUri?: string;
};

export type ContentSecurityPolicy = {
  name: CspHeaderName;
  value: string;
  nonce: string;
};

const SUPABASE_FALLBACK = { http: "https://*.supabase.co", ws: "wss://*.supabase.co" };
const PADDLE_CDN = "https://cdn.paddle.com";
const PADDLE_ANY = "https://*.paddle.com";
const SENTRY = ["https://*.sentry.io", "https://*.ingest.sentry.io"];

/** Base64 of 16 random bytes: matches the 'nonce-…' pattern Next.js parses. */
export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const NONCE = /^[A-Za-z0-9+/_-]+={0,2}$/;

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function parseUrl(value: string | undefined): URL | null {
  if (!value) return null;
  try {
    return new URL(value.trim());
  } catch {
    return null;
  }
}

/** https/wss origins for the Supabase API; plain http only for a local stack. */
export function supabaseSources(supabaseUrl: string | undefined): { http: string; ws: string } {
  const url = parseUrl(supabaseUrl);
  if (!url) return SUPABASE_FALLBACK;
  if (url.protocol === "https:") return { http: url.origin, ws: `wss://${url.host}` };
  if (url.protocol === "http:" && isLocalHost(url.hostname)) {
    return { http: url.origin, ws: `ws://${url.host}` };
  }
  return SUPABASE_FALLBACK;
}

/** The https origin of the Sentry ingest host named in a DSN, if any. */
export function sentrySource(dsn: string | undefined): string | null {
  const url = parseUrl(dsn);
  return url?.protocol === "https:" ? url.origin : null;
}

function reportSource(reportUri: string | undefined): string | null {
  const url = parseUrl(reportUri);
  if (!url || (url.protocol !== "https:" && url.protocol !== "http:")) return null;
  // A policy value cannot carry separators; URL serialisation escapes spaces,
  // but a ';' or ',' would still split the header.
  const href = url.toString();
  return /[;,\s]/.test(href) ? null : href;
}

function unique(sources: (string | null | false | undefined)[]): string {
  return Array.from(new Set(sources.filter((source): source is string => Boolean(source)))).join(
    " ",
  );
}

export function buildContentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
  if (!NONCE.test(options.nonce)) throw new Error("Invalid CSP nonce");

  const supabase = supabaseSources(options.supabaseUrl);
  const report = reportSource(options.reportUri);

  const directives: [string, string][] = [
    ["default-src", "'self'"],
    [
      "script-src",
      unique([
        "'self'",
        `'nonce-${options.nonce}'`,
        "'strict-dynamic'",
        PADDLE_CDN,
        options.isDev && "'unsafe-eval'",
      ]),
    ],
    ["style-src", unique(["'self'", "'unsafe-inline'", PADDLE_CDN])],
    ["img-src", unique(["'self'", "data:", "blob:", supabase.http, PADDLE_ANY])],
    ["font-src", "'self' data:"],
    [
      "connect-src",
      unique([
        "'self'",
        supabase.http,
        supabase.ws,
        ...SENTRY,
        sentrySource(options.sentryDsn),
        PADDLE_ANY,
        options.isDev && "ws:",
      ]),
    ],
    ["frame-src", PADDLE_ANY],
    ["worker-src", "'self' blob:"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    ["form-action", "'self'"],
    ["frame-ancestors", "'none'"],
  ];

  const parts = directives.map(([name, value]) => `${name} ${value}`);
  if (!options.isDev) parts.push("upgrade-insecure-requests");
  if (report) parts.push(`report-uri ${report}`);
  return parts.join("; ");
}

/** CSP_MODE: anything other than "report" enforces. */
export function cspMode(value: string | undefined): CspMode {
  return value?.trim().toLowerCase() === "report" ? "report" : "enforce";
}

export function cspHeaderName(mode: CspMode): CspHeaderName {
  return mode === "report" ? "Content-Security-Policy-Report-Only" : "Content-Security-Policy";
}

/** The page policy for this process's environment, with a fresh nonce. */
export function contentSecurityPolicyFromEnv(
  env: Record<string, string | undefined> = process.env,
  nonce: string = generateNonce(),
): ContentSecurityPolicy {
  return {
    name: cspHeaderName(cspMode(env.CSP_MODE)),
    nonce,
    value: buildContentSecurityPolicy({
      nonce,
      isDev: env.NODE_ENV === "development",
      supabaseUrl: env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL,
      sentryDsn: env.NEXT_PUBLIC_SENTRY_DSN,
      reportUri: env.CSP_REPORT_URI,
    }),
  };
}
