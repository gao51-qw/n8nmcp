// The `Domain` attribute shared by every site surface (mcp., docs., blog.,
// dashboard.), so a sign-in on one host is visible on all of them. Used by
// the auth route handlers for the HttpOnly session cookies and by the browser
// only to delete legacy JavaScript-readable session cookies.
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isLocalHost(host: string): boolean {
  return (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    IPV4.test(host) ||
    host.includes(":") ||
    !host.includes(".")
  );
}

/**
 * The longest label suffix that every configured surface host shares (e.g.
 * `.n8nworkflow.com`). Returns undefined (a host-only cookie) for localhost,
 * IPs, a single origin, hosts without a common registrable suffix, or a
 * request served outside that suffix.
 */
export function sharedCookieDomain(
  hosts: readonly string[],
  currentHost: string,
): string | undefined {
  const current = currentHost.trim().toLowerCase();
  const unique = Array.from(new Set(hosts.map((host) => host.trim().toLowerCase())));
  if (isLocalHost(current) || unique.length < 2 || unique.some(isLocalHost)) return undefined;

  const labelSets = unique.map((host) => host.split(".").reverse());
  const common: string[] = [];
  for (let i = 0; ; i++) {
    const label = labelSets[0][i];
    if (!label || !labelSets.every((labels) => labels[i] === label)) break;
    common.push(label);
  }
  if (common.length < 2) return undefined;

  const suffix = common.reverse().join(".");
  if (current !== suffix && !current.endsWith(`.${suffix}`)) return undefined;
  return `.${suffix}`;
}
