// Community node discovery: pure parsing and selection logic.
//
// Two first-party sources:
// - api.n8n.io/api/community-nodes: the community nodes n8n has reviewed
//   ("verified"). Each entry carries the vetted npm version, its SRI checksum
//   and the full node description, so verified nodes need no package code.
// - registry.npmjs.org search by the `n8n-community-node-package` keyword:
//   every published community package, with download counts. Popular, recent
//   packages that n8n has not reviewed become candidates for static parsing.
// scripts/0-discover-community-packages.ts does the network I/O.

export const N8N_COMMUNITY_NODES_API = "https://api.n8n.io/api/community-nodes";
export const NPM_SEARCH_API = "https://registry.npmjs.org/-/v1/search";
export const COMMUNITY_KEYWORD = "n8n-community-node-package";

/** npm package names n8n accepts for community nodes. */
export const COMMUNITY_PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?n8n-nodes-[a-z0-9._-]+$/i;
const SRI = /^sha(?:256|384|512)-[A-Za-z0-9+/]+={0,2}$/;

export type VerifiedCommunityNode = {
  /** Workflow node type, `<package>.<node>`. */
  nodeType: string;
  packageName: string;
  npmVersion: string;
  /** SRI of the reviewed tarball. */
  checksum: string;
  displayName: string;
  description: string | null;
  isOfficialNode: boolean;
  downloads: number;
  updatedAt: string | null;
  nodeDescription: Record<string, unknown>;
};

export type NpmSearchPackage = {
  name: string;
  version: string;
  publishedAt: string | null;
  weeklyDownloads: number;
  description: string | null;
};

export type CommunityCandidate = NpmSearchPackage & { reason: "popular" };

export type CandidatePolicy = {
  now: Date;
  maxAgeMonths: number;
  minWeeklyDownloads: number;
  maxPackages: number;
  blacklist: readonly string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * One page of the n8n community-nodes API (Strapi shape: `{ data, meta }`,
 * entries with or without an `attributes` wrapper). Unpublished entries and
 * entries without a usable package name, version, SRI checksum or node
 * description are dropped.
 */
export function parseVerifiedPage(json: unknown): {
  nodes: VerifiedCommunityNode[];
  pageCount: number;
} {
  if (!isRecord(json) || !Array.isArray(json.data)) {
    throw new Error("n8n community-nodes API: unexpected response shape");
  }
  const pagination = isRecord(json.meta) && isRecord(json.meta.pagination) ? json.meta.pagination : {};
  const pageCount = typeof pagination.pageCount === "number" ? pagination.pageCount : 1;

  const nodes: VerifiedCommunityNode[] = [];
  for (const item of json.data) {
    const entry = isRecord(item) && isRecord(item.attributes) ? item.attributes : item;
    if (!isRecord(entry) || entry.isPublished === false) continue;
    const packageName = str(entry.packageName);
    const npmVersion = str(entry.npmVersion);
    const checksum = str(entry.checksum);
    const nodeDescription = isRecord(entry.nodeDescription) ? entry.nodeDescription : null;
    if (!packageName || !COMMUNITY_PACKAGE_NAME.test(packageName)) continue;
    if (!npmVersion || !checksum || !SRI.test(checksum) || !nodeDescription) continue;

    const name = str(entry.name) ?? str(nodeDescription.name);
    if (!name) continue;
    const nodeType = name.startsWith(`${packageName}.`) ? name : `${packageName}.${name.split(".").at(-1)}`;
    nodes.push({
      nodeType,
      packageName,
      npmVersion,
      checksum,
      displayName: str(entry.displayName) ?? str(nodeDescription.displayName) ?? nodeType,
      description: str(entry.description) ?? str(nodeDescription.description),
      isOfficialNode: entry.isOfficialNode === true,
      downloads: typeof entry.numberOfDownloads === "number" ? entry.numberOfDownloads : 0,
      updatedAt: str(entry.updatedAt),
      nodeDescription,
    });
  }
  return { nodes, pageCount };
}

/** One page of the npm search API. */
export function parseNpmSearchPage(json: unknown): { packages: NpmSearchPackage[]; total: number } {
  if (!isRecord(json) || !Array.isArray(json.objects)) {
    throw new Error("npm search API: unexpected response shape");
  }
  const packages: NpmSearchPackage[] = [];
  for (const object of json.objects) {
    if (!isRecord(object) || !isRecord(object.package)) continue;
    const pkg = object.package;
    const name = str(pkg.name);
    const version = str(pkg.version);
    if (!name || !version) continue;
    const downloads = isRecord(object.downloads) ? object.downloads : {};
    packages.push({
      name,
      version,
      publishedAt: str(pkg.date),
      weeklyDownloads: typeof downloads.weekly === "number" ? downloads.weekly : 0,
      description: str(pkg.description),
    });
  }
  return { packages, total: typeof json.total === "number" ? json.total : packages.length };
}

function monthsBefore(date: Date, months: number): Date {
  const result = new Date(date);
  result.setUTCMonth(result.getUTCMonth() - months);
  return result;
}

/**
 * Picks npm packages worth parsing: valid community names, not blacklisted,
 * not already covered by the verified list, published within the age window
 * and above the weekly download floor. Most-downloaded first, capped.
 */
export function selectCommunityCandidates(
  packages: readonly NpmSearchPackage[],
  verifiedPackages: ReadonlySet<string>,
  policy: CandidatePolicy,
): CommunityCandidate[] {
  const cutoff = monthsBefore(policy.now, policy.maxAgeMonths).getTime();
  const blacklist = new Set(policy.blacklist);
  const byName = new Map<string, NpmSearchPackage>();
  for (const pkg of packages) {
    if (!COMMUNITY_PACKAGE_NAME.test(pkg.name) || blacklist.has(pkg.name)) continue;
    if (verifiedPackages.has(pkg.name)) continue;
    if (pkg.weeklyDownloads < policy.minWeeklyDownloads) continue;
    const published = pkg.publishedAt ? Date.parse(pkg.publishedAt) : Number.NaN;
    if (!Number.isFinite(published) || published < cutoff) continue;
    if (!byName.has(pkg.name)) byName.set(pkg.name, pkg);
  }
  return [...byName.values()]
    .sort((a, b) => b.weeklyDownloads - a.weeklyDownloads || a.name.localeCompare(b.name))
    .slice(0, policy.maxPackages)
    .map((pkg) => ({ ...pkg, reason: "popular" as const }));
}

/** Keeps one entry per node type, preferring the most recently updated. */
export function dedupeVerifiedNodes(nodes: readonly VerifiedCommunityNode[]): VerifiedCommunityNode[] {
  const byType = new Map<string, VerifiedCommunityNode>();
  for (const node of nodes) {
    const current = byType.get(node.nodeType);
    if (!current || (node.updatedAt ?? "") > (current.updatedAt ?? "")) byType.set(node.nodeType, node);
  }
  return [...byType.values()].sort((a, b) => a.nodeType.localeCompare(b.nodeType));
}
