// Client IP for logging, audit and rate-limit keys.
//
// Trust rule: production traffic reaches the app only through aaPanel host
// nginx (deploy/nginx/aapanel/n8nmcp-app-proxy.inc), the app listens on
// 127.0.0.1 only, and nothing sits in front of nginx. nginx sets
// `X-Forwarded-For $proxy_add_x_forwarded_for`, which appends the peer address
// to whatever the client sent, so the right-most entry is the address nginx
// itself observed and is the only one trusted.
//
// `cf-connecting-ip`, `x-real-ip`, `true-client-ip` and the left-most
// `X-Forwarded-For` entries are client-controlled here and are ignored.
// `cf-connecting-ip` is honoured only when TRUST_CLOUDFLARE_HEADERS=true, which
// must be set only when Cloudflare is actually in front of nginx (and the
// origin accepts traffic from Cloudflare only).
//
// If another proxy layer is ever added in front of nginx, the right-most entry
// becomes that proxy's address. Either enable TRUST_CLOUDFLARE_HEADERS (for
// Cloudflare) or configure nginx `set_real_ip_from` for exactly that layer's
// ranges, and revisit this rule. Never enable `real_ip_header` without a
// matching `set_real_ip_from` list: it would make $remote_addr, and therefore
// the right-most entry, client-controlled.

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 =
  /^[0-9a-f:]+(:(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3})?$/i;

type Env = Record<string, string | undefined>;

/** Returns the address when it is a syntactically valid IPv4/IPv6 literal. */
export function normalizeIp(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  let candidate = value.trim();
  // "[2001:db8::1]" or "[2001:db8::1]:443"
  const bracketed = candidate.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketed) candidate = bracketed[1];
  // "203.0.113.7:51234"
  const v4WithPort = candidate.match(/^([\d.]+):\d+$/);
  if (v4WithPort) candidate = v4WithPort[1];
  if (candidate.length > 45) return undefined;
  if (IPV4.test(candidate)) return candidate;
  if (candidate.includes(":") && IPV6.test(candidate)) return candidate.toLowerCase();
  return undefined;
}

function cloudflareTrusted(env: Env): boolean {
  return env.TRUST_CLOUDFLARE_HEADERS?.trim().toLowerCase() === "true";
}

/**
 * The client address observed by the reverse proxy, or undefined when the
 * request carries no trustworthy address (e.g. a direct call in development).
 */
export function clientIp(request: Request, env: Env = process.env): string | undefined {
  if (cloudflareTrusted(env)) {
    const cf = normalizeIp(request.headers.get("cf-connecting-ip"));
    if (cf) return cf;
  }

  const forwarded = request.headers.get("x-forwarded-for");
  if (!forwarded) return undefined;
  const entries = forwarded
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  return normalizeIp(entries.at(-1));
}
