// Same-origin (CSRF) and rate-limit guards for the /api/auth endpoints.
//
// The refresh cookie is SameSite=Lax and scoped to /api/auth, and every
// endpoint additionally requires:
// - `Sec-Fetch-Site: same-origin` whenever the browser sends it (all current
//   browsers do), so neither another site nor a sibling subdomain can call
//   the endpoints with the user's cookies;
// - an `Origin` header naming exactly this host, and a host that is one of the
//   configured site surfaces (plus localhost outside production);
// - `Content-Type: application/json`, which a cross-origin form cannot send
//   and which forces a CORS preflight that the app never answers.
import { clientIp } from "@/lib/client-ip.server";
import { createExpiringStore } from "@/lib/expiring-store";
import { HttpError } from "@/lib/http/api-response.server";
import { normalizeHost, SITE_DOMAINS } from "@/lib/site-domains";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function crossSite(): HttpError {
  return new HttpError(403, "cross_site_request", "Cross-site request rejected");
}

function allowedHostname(hostname: string, env: Record<string, string | undefined>): boolean {
  const host = hostname.toLowerCase();
  if (Object.values(SITE_DOMAINS).some((site) => site.host === host)) return true;
  return env.NODE_ENV !== "production" && (LOCAL_HOSTS.has(host) || host.endsWith(".localhost"));
}

/** The request's own `host[:port]` as the browser addressed it. */
function requestHost(request: Request): string {
  const header = request.headers.get("host")?.trim().toLowerCase();
  if (header) return header;
  return new URL(request.url).host.toLowerCase();
}

/**
 * Rejects anything that is not a same-origin JSON POST from a configured
 * site host. Returns the validated origin (used for cookie `Secure` and for
 * email-link redirect URLs).
 */
export function assertSameOriginJson(
  request: Request,
  env: Record<string, string | undefined> = process.env,
): URL {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") throw crossSite();

  const originHeader = request.headers.get("origin");
  if (!originHeader || originHeader === "null") throw crossSite();
  let origin: URL;
  try {
    origin = new URL(originHeader);
  } catch {
    throw crossSite();
  }
  if (origin.protocol !== "https:" && origin.protocol !== "http:") throw crossSite();
  if (origin.host.toLowerCase() !== requestHost(request)) throw crossSite();
  if (!allowedHostname(normalizeHost(origin.hostname), env)) throw crossSite();
  if (
    env.NODE_ENV === "production" &&
    origin.protocol !== "https:" &&
    !LOCAL_HOSTS.has(origin.hostname)
  ) {
    throw crossSite();
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!/^application\/json\s*(?:;|$)/i.test(contentType)) {
    throw new HttpError(415, "unsupported_media_type", "Send the request as JSON");
  }
  return origin;
}

export type RateLimitRule = { limit: number; windowMs: number };

export const AUTH_RATE_LIMITS = {
  login: { limit: 20, windowMs: 10 * 60_000 },
  loginEmail: { limit: 10, windowMs: 10 * 60_000 },
  signup: { limit: 5, windowMs: 10 * 60_000 },
  recover: { limit: 5, windowMs: 15 * 60_000 },
  recoverEmail: { limit: 3, windowMs: 15 * 60_000 },
  refresh: { limit: 120, windowMs: 5 * 60_000 },
  exchange: { limit: 20, windowMs: 10 * 60_000 },
  logout: { limit: 30, windowMs: 5 * 60_000 },
  password: { limit: 10, windowMs: 15 * 60_000 },
} satisfies Record<string, RateLimitRule>;

type Bucket = { count: number; resetAt: number };

// Process-local fixed windows: one store keyed by client IP and one keyed by
// account email, so spraying emails cannot evict the IP buckets. Supabase
// Auth's own rate limits stay in force behind these.
type BucketStore = ReturnType<typeof createExpiringStore<Bucket>>;

const newStore = (): BucketStore => createExpiringStore<Bucket>({ maxEntries: 20_000 });
let byIp = newStore();
let byAccount = newStore();

function consume(store: BucketStore, key: string, rule: RateLimitRule, now: number): boolean {
  const bucket = store.get(key, now);
  if (!bucket) {
    store.set(key, { count: 1, resetAt: now + rule.windowMs }, rule.windowMs, now);
    return true;
  }
  if (bucket.count >= rule.limit) return false;
  bucket.count += 1;
  return true;
}

function tooMany(): HttpError {
  return new HttpError(429, "rate_limited", "Too many attempts. Wait a few minutes and try again.");
}

/** Counts one attempt for the caller's IP; throws a 429 HttpError over the limit. */
export function limitByIp(
  request: Request,
  name: keyof typeof AUTH_RATE_LIMITS,
  now = Date.now(),
): void {
  const ip = clientIp(request) ?? "unknown";
  if (!consume(byIp, `${name}:${ip}`, AUTH_RATE_LIMITS[name], now)) throw tooMany();
}

/** Counts one attempt for an account identifier (lower-cased email). */
export function limitByAccount(
  name: keyof typeof AUTH_RATE_LIMITS,
  account: string,
  now = Date.now(),
): void {
  const key = `${name}:${account.trim().toLowerCase()}`;
  if (!consume(byAccount, key, AUTH_RATE_LIMITS[name], now)) throw tooMany();
}

/** Test hook: forget every bucket. */
export function resetAuthRateLimits(): void {
  byIp = newStore();
  byAccount = newStore();
}

/** The `Authorization: Bearer` token, or null. */
export function bearerToken(request: Request): string | null {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  return token && /^[\x21-\x7e]{1,8192}$/.test(token) ? token : null;
}
