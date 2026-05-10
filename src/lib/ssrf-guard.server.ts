// SSRF guard: validates a URL's host is not an internal/private/link-local address.
// Server-only.

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata",
  "metadata.goog",
]);

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    const x = Number(p);
    if (!Number.isInteger(x) || x < 0 || x > 255 || /[^0-9]/.test(p)) return null;
    n = (n << 8) | x;
  }
  return n >>> 0;
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  if (n === null) return false;
  // 0.0.0.0/8
  if ((n >>> 24) === 0) return true;
  // 10.0.0.0/8
  if ((n >>> 24) === 10) return true;
  // 127.0.0.0/8
  if ((n >>> 24) === 127) return true;
  // 169.254.0.0/16 (link-local incl. cloud metadata)
  if ((n >>> 16) === ((169 << 8) | 254)) return true;
  // 172.16.0.0/12
  if ((n >>> 24) === 172 && ((n >>> 20) & 0xf) >= 1 && ((n >>> 20) & 0xf) <= 1) {
    // 172.16-31
  }
  if ((n >>> 24) === 172) {
    const second = (n >>> 16) & 0xff;
    if (second >= 16 && second <= 31) return true;
  }
  // 192.168.0.0/16
  if ((n >>> 16) === ((192 << 8) | 168)) return true;
  // 100.64.0.0/10 (CGNAT)
  if ((n >>> 24) === 100 && ((n >>> 16) & 0xff) >= 64 && ((n >>> 16) & 0xff) <= 127) return true;
  return false;
}

function isPrivateIPv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (lower === "::1" || lower === "::") return true;
  // fc00::/7 (ULA), fe80::/10 (link-local), fd00::/8
  if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true;
  if (/^fe[89ab][0-9a-f]:/.test(lower)) return true;
  // IPv4-mapped (::ffff:a.b.c.d)
  const m = lower.match(/^::ffff:([0-9.]+)$/);
  if (m && isPrivateIPv4(m[1])) return true;
  return false;
}

export type DohAnswer = { name: string; type: number; data: string };

async function dohResolve(hostname: string): Promise<string[]> {
  const out: string[] = [];
  for (const type of ["A", "AAAA"]) {
    try {
      const res = await fetch(
        `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`,
        { headers: { accept: "application/dns-json" }, signal: AbortSignal.timeout(3000) },
      );
      if (!res.ok) continue;
      const json = (await res.json()) as { Answer?: DohAnswer[] };
      for (const a of json.Answer ?? []) {
        if ((type === "A" && a.type === 1) || (type === "AAAA" && a.type === 28)) {
          out.push(a.data);
        }
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

/**
 * Throws if the URL targets a private/internal/link-local address or a blocked host.
 * Performs DNS-over-HTTPS resolution for hostnames.
 */
export async function assertPublicUrl(rawUrl: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new Error("Invalid URL");
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) URLs are allowed");

  const host = u.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("Target host is not allowed");
  }

  // Direct IP literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) {
    if (isPrivateIPv4(host)) throw new Error("Target IP is private/internal");
    return;
  }
  if (host.includes(":")) {
    if (isPrivateIPv6(host)) throw new Error("Target IP is private/internal");
    return;
  }

  // Resolve via DoH and verify
  const ips = await dohResolve(host);
  if (ips.length === 0) {
    // Fall back to allowing if DoH fails — but be conservative: reject.
    throw new Error("Unable to verify target host");
  }
  for (const ip of ips) {
    if (ip.includes(":")) {
      if (isPrivateIPv6(ip)) throw new Error("Target resolves to a private/internal address");
    } else {
      if (isPrivateIPv4(ip)) throw new Error("Target resolves to a private/internal address");
    }
  }
}
