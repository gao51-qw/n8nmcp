// Rows for community nodes and packages in data/nodes.db.
//
// Trust levels:
//   official  core n8n packages built from the n8n-io/n8n repository
//   verified  reviewed by n8n (api.n8n.io); schema taken from n8n's own record
//   parsed    not reviewed by n8n; schema read statically from the npm tarball
//             after its SRI was checked
//   listed    (packages only) known community package without a readable
//             node schema; validation warns instead of erroring
import type { CommunityCandidate, VerifiedCommunityNode } from "./community-sources.js";
import { parsedNodeFromDescription, type ParsedNode } from "./node-package-parser.js";

export type NodeTrustLevel = "official" | "verified" | "parsed";
export type PackageTrustLevel = "verified" | "parsed" | "listed";

export type CommunityNodeRow = ParsedNode & {
  source: "community";
  trust_level: Exclude<NodeTrustLevel, "official">;
  package_version: string;
  package_integrity: string | null;
};

export type CommunityPackageRow = {
  package_name: string;
  version: string;
  trust_level: PackageTrustLevel;
  integrity: string | null;
  weekly_downloads: number | null;
  published_at: string | null;
  node_count: number;
};

export const COMMUNITY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS community_packages (
    package_name TEXT PRIMARY KEY,
    version TEXT NOT NULL,
    trust_level TEXT NOT NULL CHECK (trust_level IN ('verified', 'parsed', 'listed')),
    integrity TEXT,
    weekly_downloads INTEGER,
    published_at TEXT,
    node_count INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_community_packages_trust ON community_packages(trust_level);
`;

export function verifiedNodeRows(verified: readonly VerifiedCommunityNode[]): CommunityNodeRow[] {
  return verified.map((node) => {
    const description: Record<string, unknown> = {
      ...node.nodeDescription,
      name: node.nodeType,
      displayName: node.displayName,
    };
    if (node.description && !description.description) description.description = node.description;
    return {
      ...parsedNodeFromDescription(
        { name: node.packageName, version: node.npmVersion },
        description,
        `api.n8n.io/community-nodes/${node.nodeType}`,
      ),
      node_type: node.nodeType,
      source: "community" as const,
      trust_level: "verified" as const,
      package_version: node.npmVersion,
      package_integrity: node.checksum,
    };
  });
}

export function parsedNodeRows(
  parsed: readonly ParsedNode[],
  packages: ReadonlyMap<string, { version: string; integrity: string | null }>,
): CommunityNodeRow[] {
  return parsed.flatMap((node) => {
    const pkg = packages.get(node.package_name);
    if (!pkg) return [];
    return [
      {
        ...node,
        source: "community" as const,
        trust_level: "parsed" as const,
        package_version: pkg.version,
        package_integrity: pkg.integrity,
      },
    ];
  });
}

/**
 * One row per community package: verified packages from n8n, then each
 * candidate as parsed (it produced nodes) or listed (it did not).
 */
export function communityPackageRows(
  verified: readonly VerifiedCommunityNode[],
  candidates: readonly CommunityCandidate[],
  parsedNodeCounts: ReadonlyMap<string, number>,
  candidateIntegrity: ReadonlyMap<string, string>,
): CommunityPackageRow[] {
  const rows = new Map<string, CommunityPackageRow>();
  for (const node of verified) {
    const current = rows.get(node.packageName);
    rows.set(node.packageName, {
      package_name: node.packageName,
      version: node.npmVersion,
      trust_level: "verified",
      integrity: node.checksum,
      weekly_downloads: null,
      published_at: node.updatedAt,
      node_count: (current?.node_count ?? 0) + 1,
    });
  }
  for (const candidate of candidates) {
    if (rows.has(candidate.name)) continue;
    const nodeCount = parsedNodeCounts.get(candidate.name) ?? 0;
    rows.set(candidate.name, {
      package_name: candidate.name,
      version: candidate.version,
      trust_level: nodeCount > 0 ? "parsed" : "listed",
      integrity: candidateIntegrity.get(candidate.name) ?? null,
      weekly_downloads: candidate.weeklyDownloads,
      published_at: candidate.publishedAt,
      node_count: nodeCount,
    });
  }
  return [...rows.values()].sort((a, b) => a.package_name.localeCompare(b.package_name));
}

export type CommunityQualityPolicy = { minCommunityNodes: number; minVerifiedNodes: number };

export function assertCommunityQuality(
  counts: { communityNodes: number; verifiedNodes: number },
  policy: CommunityQualityPolicy,
): void {
  const problems: string[] = [];
  if (counts.communityNodes < policy.minCommunityNodes) {
    problems.push(`community nodes ${counts.communityNodes} < ${policy.minCommunityNodes}`);
  }
  if (counts.verifiedNodes < policy.minVerifiedNodes) {
    problems.push(`verified nodes ${counts.verifiedNodes} < ${policy.minVerifiedNodes}`);
  }
  if (problems.length > 0) {
    throw new Error(`Community quality gate failed: ${problems.join("; ")}`);
  }
}
