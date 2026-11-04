// scripts/7b-add-community-nodes.ts
// Add community nodes to an already-built data/nodes.db (run after the
// official build and before stats):
//   - verified nodes from n8n's reviewed list (.tmp/community/discovery.json)
//   - with --with-parsed: popular unreviewed packages, downloaded at the
//     discovered version, SRI-checked, extracted (files only) and parsed
//     statically; package code is never run
// Everything happens in one transaction and the community quality gate runs
// before commit, so a failed run leaves the official database untouched.
//
// Usage: tsx scripts/7b-add-community-nodes.ts [--with-parsed] [--limit-parsed=N] [--skip-gate]
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  assertCommunityQuality,
  COMMUNITY_SCHEMA_SQL,
  communityPackageRows,
  parsedNodeRows,
  verifiedNodeRows,
  type CommunityNodeRow,
} from "../src/community-db.js";
import { downloadVerifyExtract, npmVersionDist } from "../src/community-fetch.js";
import type { CommunityCandidate, VerifiedCommunityNode } from "../src/community-sources.js";
import { essentialsOf } from "../src/node-essentials.js";
import { parseNodePackage, type ParsedNode } from "../src/node-package-parser.js";

const ROOT = resolve(process.cwd());
const DB_PATH = resolve(process.env.DB_PATH ?? join(ROOT, "data/nodes.db"));
const DISCOVERY = resolve(ROOT, ".tmp/community/discovery.json");
const PKG_DIR = resolve(ROOT, ".tmp/community/pkgs");
const CFG = JSON.parse(await readFile(resolve(ROOT, "packages.json"), "utf8"));
const WITH_PARSED = process.argv.includes("--with-parsed");
const SKIP_GATE = process.argv.includes("--skip-gate");
const LIMIT_PARSED = Number(
  process.argv.find((arg) => arg.startsWith("--limit-parsed="))?.split("=")[1] ?? Number.POSITIVE_INFINITY,
);

type Discovery = {
  generatedAt: string;
  verified: VerifiedCommunityNode[];
  candidates: CommunityCandidate[];
};

async function parseCandidates(candidates: readonly CommunityCandidate[]) {
  const nodes: ParsedNode[] = [];
  const packages = new Map<string, { version: string; integrity: string | null }>();
  const integrity = new Map<string, string>();
  const concurrency = 8;
  let failed = 0;

  for (let i = 0; i < candidates.length; i += concurrency) {
    const chunk = candidates.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (candidate) => {
        try {
          const dist = await npmVersionDist(candidate.name, candidate.version);
          const dir = await downloadVerifyExtract(candidate.name, dist, PKG_DIR);
          const parsed = await parseNodePackage({
            name: candidate.name,
            version: candidate.version,
            dir,
            source: "community",
          });
          return { candidate, dist, parsed };
        } catch (error) {
          failed += 1;
          console.warn(`[community] skip ${candidate.name}: ${(error as Error).message}`);
          return null;
        }
      }),
    );
    for (const result of results) {
      if (!result) continue;
      integrity.set(result.candidate.name, result.dist.integrity);
      packages.set(result.candidate.name, {
        version: result.candidate.version,
        integrity: result.dist.integrity,
      });
      nodes.push(...result.parsed.nodes);
    }
    if ((i / concurrency) % 25 === 0) {
      console.log(`[community] parsed ${Math.min(i + concurrency, candidates.length)}/${candidates.length}`);
    }
  }
  console.log(`[community] ${nodes.length} parsed nodes, ${failed} packages skipped`);
  return { nodes, packages, integrity };
}

function ensureCommunityColumns(db: Database.Database): void {
  const columns = new Set(
    (db.prepare("PRAGMA table_info(nodes)").all() as Array<{ name: string }>).map((c) => c.name),
  );
  const add: Array<[string, string]> = [
    ["source", "TEXT NOT NULL DEFAULT 'official'"],
    ["trust_level", "TEXT NOT NULL DEFAULT 'official'"],
    ["package_version", "TEXT"],
    ["package_integrity", "TEXT"],
  ];
  for (const [name, definition] of add) {
    if (!columns.has(name)) db.exec(`ALTER TABLE nodes ADD COLUMN ${name} ${definition}`);
  }
  db.exec(COMMUNITY_SCHEMA_SQL);
}

async function main() {
  if (!existsSync(DISCOVERY)) {
    throw new Error(`missing ${DISCOVERY}; run scripts/0-discover-community-packages.ts first`);
  }
  if (!existsSync(DB_PATH)) throw new Error(`missing ${DB_PATH}; build the official database first`);
  const discovery = JSON.parse(await readFile(DISCOVERY, "utf8")) as Discovery;

  const verifiedRows = verifiedNodeRows(discovery.verified);
  const candidates = discovery.candidates.slice(0, LIMIT_PARSED);
  const parsed = WITH_PARSED
    ? await parseCandidates(candidates)
    : { nodes: [], packages: new Map(), integrity: new Map<string, string>() };
  const verifiedTypes = new Set(verifiedRows.map((row) => row.node_type));
  const parsedRows = parsedNodeRows(parsed.nodes, parsed.packages).filter(
    (row) => !verifiedTypes.has(row.node_type),
  );
  const parsedCounts = new Map<string, number>();
  for (const row of parsedRows) {
    parsedCounts.set(row.package_name, (parsedCounts.get(row.package_name) ?? 0) + 1);
  }
  const packageRows = communityPackageRows(
    discovery.verified,
    WITH_PARSED ? candidates : [],
    parsedCounts,
    parsed.integrity,
  );

  const db = new Database(DB_PATH);
  try {
    ensureCommunityColumns(db);
    const insertNode = db.prepare(`
      INSERT OR REPLACE INTO nodes(
        node_type, package_name, display_name, description, category, version,
        is_ai_tool, is_trigger, is_webhook, properties_json, essentials_json, credentials_json,
        documentation, examples_json, source_excerpt, updated_at,
        source, trust_level, package_version, package_integrity
      ) VALUES (
        @node_type, @package_name, @display_name, @description, @category, @version,
        @is_ai_tool, @is_trigger, @is_webhook, @properties_json, @essentials_json, @credentials_json,
        NULL, '[]', @source_excerpt, @updated_at,
        @source, @trust_level, @package_version, @package_integrity
      )`);
    const insertFts = db.prepare(
      `INSERT INTO nodes_fts(node_type, display_name, description, documentation, package_name)
       VALUES (?, ?, ?, '', ?)`,
    );
    const insertPackage = db.prepare(`
      INSERT INTO community_packages(
        package_name, version, trust_level, integrity, weekly_downloads, published_at, node_count, updated_at
      ) VALUES (
        @package_name, @version, @trust_level, @integrity, @weekly_downloads, @published_at, @node_count, @updated_at
      )`);

    const apply = db.transaction(() => {
      db.exec(`
        DELETE FROM nodes_fts WHERE package_name IN (SELECT package_name FROM nodes WHERE source = 'community');
        DELETE FROM nodes WHERE source = 'community';
        DELETE FROM community_packages;
      `);
      const now = new Date().toISOString();
      const insert = (row: CommunityNodeRow) => {
        insertNode.run({ ...row, essentials_json: essentialsOf(row.properties_json), updated_at: now });
        insertFts.run(row.node_type, row.display_name, row.description ?? "", row.package_name);
      };
      verifiedRows.forEach(insert);
      parsedRows.forEach(insert);
      for (const row of packageRows) insertPackage.run({ ...row, updated_at: now });

      const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;
      const counts = {
        communityNodes: count("SELECT COUNT(*) c FROM nodes WHERE source = 'community'"),
        verifiedNodes: count("SELECT COUNT(*) c FROM nodes WHERE trust_level = 'verified'"),
        parsedNodes: count("SELECT COUNT(*) c FROM nodes WHERE trust_level = 'parsed'"),
        listedPackages: count("SELECT COUNT(*) c FROM community_packages WHERE trust_level = 'listed'"),
      };
      console.log(
        `[community] nodes=${counts.communityNodes} verified=${counts.verifiedNodes} ` +
          `parsed=${counts.parsedNodes} packages=${packageRows.length} listed=${counts.listedPackages}`,
      );
      if (!SKIP_GATE) {
        assertCommunityQuality(counts, {
          minCommunityNodes: CFG.community?.min_community_nodes ?? 1500,
          minVerifiedNodes: CFG.community?.min_verified_nodes ?? 300,
        });
      }
    });
    apply();
  } finally {
    db.close();
  }
  console.log(`[community] wrote community nodes into ${DB_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
