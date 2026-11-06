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

function isPrivateIPv4Int(n: number): boolean {
  const a = n >>> 24;
  const b = (n >>> 16) & 0xff;
  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 (link-local, cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (a === 192 && b === 0 && ((n >>> 8) & 0xff) === 0) return true; // 192.0.0.0/24 (IETF)
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18.0.0/15 (benchmarking, proxy fake-IP)
  if (a >= 224) return true; // 224.0.0.0/4 multicast, 240.0.0.0/4 reserved, broadcast
  return false;
}

function isPrivateIPv4(ip: string): boolean {
  const n = ipv4ToInt(ip);
  return n !== null && isPrivateIPv4Int(n);
}

/** Parses an IPv6 literal (brackets optional) into eight 16-bit groups. */
function parseIPv6(ip: string): number[] | null {
  let text = ip.toLowerCase().replace(/^\[|\]$/g, "");
  if (text.includes("%")) return null; // zone ids never belong in a public URL
  const groups: number[] = [];
  // A trailing dotted quad carries the last 32 bits.
  const dotted = text.match(/^(.*:)(\d{1,3}(?:\.\d{1,3}){3})$/);
  let tail: number[] = [];
  if (dotted) {
    const v4 = ipv4ToInt(dotted[2]);
    if (v4 === null) return null;
    tail = [v4 >>> 16, v4 & 0xffff];
    text = dotted[1].endsWith("::") ? dotted[1] : dotted[1].slice(0, -1);
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const parse = (part: string): number[] | null => {
    if (part === "") return [];
    const out: number[] = [];
    for (const g of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
      out.push(parseInt(g, 16));
    }
    return out;
  };
  const head = parse(halves[0]);
  const rest = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !rest) return null;
  const explicit = head.length + rest.length + tail.length;
  if (halves.length === 1) {
    if (explicit !== 8) return null;
    groups.push(...head, ...tail);
  } else {
    if (explicit > 7) return null;
    groups.push(...head, ...new Array(8 - explicit).fill(0), ...rest, ...tail);
  }
  return groups.length === 8 ? groups : null;
}

/**
 * True for loopback, unspecified, ULA, link-local, site-local and multicast
 * addresses, and for every form that embeds an IPv4 address (mapped,
 * translated, compatible, NAT64, 6to4) whose IPv4 address is private.
 * Unparseable input counts as private so the guard fails closed.
 */
function isPrivateIPv6(ip: string): boolean {
  const g = parseIPv6(ip);
  if (!g) return true;
  const embedded = (hi: number, lo: number) => isPrivateIPv4Int(((hi << 16) | lo) >>> 0);
  const zeroUntil = (end: number) => g.slice(0, end).every((x) => x === 0);

  if (zeroUntil(7) && (g[7] === 0 || g[7] === 1)) return true; // :: and ::1
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 unique local
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local (deprecated)
  if ((g[0] & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (zeroUntil(5) && g[5] === 0xffff) return embedded(g[6], g[7]); // ::ffff:a.b.c.d mapped
  if (zeroUntil(4) && g[4] === 0xffff && g[5] === 0) return embedded(g[6], g[7]); // ::ffff:0:a.b.c.d
  if (zeroUntil(6)) return embedded(g[6], g[7]); // ::a.b.c.d compatible (deprecated)
  if (g[0] === 0x64 && g[1] === 0xff9b) {
    if (g[2] === 1) return true; // 64:ff9b:1::/48 local-use NAT64
    if (g.slice(2, 6).every((x) => x === 0)) return embedded(g[6], g[7]); // 64:ff9b::/96
  }
  if (g[0] === 0x2002) return embedded(g[1], g[2]); // 2002::/16 6to4
  if (g[0] === 0x2001 && g[1] === 0) return true; // 2001::/32 Teredo hides the IPv4 target
  return false;
}

export type DohAnswer = { name: string; type: number; data: string };
export type PublicFetchInit = RequestInit & {
  headers?: HeadersInit;
};

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

export async function safeFetchPublicUrl(
  rawUrl: string,
  init?: PublicFetchInit,
): Promise<Response> {
  await assertPublicUrl(rawUrl);

  const res = await fetch(rawUrl, {
    ...init,
    redirect: "manual",
  });

  if (res.status >= 300 && res.status < 400) {
    throw new Error("Redirects are not allowed for protected outbound requests");
  }

  return res;
}
