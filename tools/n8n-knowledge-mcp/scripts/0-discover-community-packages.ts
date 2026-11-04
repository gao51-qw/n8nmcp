// scripts/0-discover-community-packages.ts
// Discover community nodes from first-party sources (no package code is
// downloaded here):
//   - api.n8n.io community-nodes: nodes n8n has reviewed (trust: verified)
//   - npm search by keyword: popular, recent packages n8n has not reviewed
//     (candidates for SRI-verified download + static parsing in step 1/2)
// Output: .tmp/community/discovery.json
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  COMMUNITY_KEYWORD,
  dedupeVerifiedNodes,
  N8N_COMMUNITY_NODES_API,
  NPM_SEARCH_API,
  parseNpmSearchPage,
  parseVerifiedPage,
  selectCommunityCandidates,
  type NpmSearchPackage,
  type VerifiedCommunityNode,
} from "../src/community-sources.js";

const ROOT = resolve(process.cwd());
const OUT_DIR = resolve(ROOT, ".tmp/community");
const OUT = resolve(OUT_DIR, "discovery.json");
const CFG = JSON.parse(await readFile(resolve(ROOT, "packages.json"), "utf8"));
const COMMUNITY = CFG.community ?? {};

const VERIFIED_PAGE_SIZE = 250;
const NPM_PAGE_SIZE = 250;
// npm keeps paging past its reported total; stop on a short batch or here.
const NPM_HARD_CAP = 25_000;

async function getJson(url: string, attempts = 3): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      await new Promise((done) => setTimeout(done, attempt * 1_000));
    }
  }
  throw lastError;
}

async function fetchVerifiedNodes(): Promise<VerifiedCommunityNode[]> {
  const nodes: VerifiedCommunityNode[] = [];
  let pageCount = 1;
  for (let page = 1; page <= pageCount; page += 1) {
    const url = `${N8N_COMMUNITY_NODES_API}?pagination%5BpageSize%5D=${VERIFIED_PAGE_SIZE}&pagination%5Bpage%5D=${page}`;
    const parsed = parseVerifiedPage(await getJson(url));
    pageCount = parsed.pageCount;
    nodes.push(...parsed.nodes);
    console.log(`[discover] n8n verified page ${page}/${pageCount}: ${parsed.nodes.length} nodes`);
  }
  return dedupeVerifiedNodes(nodes);
}

async function searchNpm(): Promise<{ packages: NpmSearchPackage[]; total: number }> {
  const byName = new Map<string, NpmSearchPackage>();
  let total = 0;
  for (let from = 0; from < NPM_HARD_CAP; from += NPM_PAGE_SIZE) {
    const url = `${NPM_SEARCH_API}?text=keywords:${encodeURIComponent(COMMUNITY_KEYWORD)}&size=${NPM_PAGE_SIZE}&from=${from}`;
    const page = parseNpmSearchPage(await getJson(url));
    total = Math.max(total, page.total);
    const before = byName.size;
    for (const pkg of page.packages) if (!byName.has(pkg.name)) byName.set(pkg.name, pkg);
    if (from % 2_500 === 0) console.log(`[discover] npm from=${from}: ${byName.size} unique packages`);
    if (page.packages.length < NPM_PAGE_SIZE || byName.size === before) break;
  }
  return { packages: [...byName.values()], total };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const verified = await fetchVerifiedNodes();
  const verifiedPackages = new Set(verified.map((node) => node.packageName));
  console.log(`[discover] ${verified.length} verified nodes in ${verifiedPackages.size} packages`);

  const npm = await searchNpm();
  const policy = {
    now: new Date(),
    maxAgeMonths: COMMUNITY.max_age_months ?? 24,
    minWeeklyDownloads: COMMUNITY.min_weekly_downloads ?? 50,
    maxPackages: COMMUNITY.max_parsed_packages ?? 1500,
    blacklist: COMMUNITY.blacklist ?? [],
  };
  const candidates = selectCommunityCandidates(npm.packages, verifiedPackages, policy);
  console.log(
    `[discover] npm: ${npm.packages.length} packages (reported total ${npm.total}); ` +
      `${candidates.length} candidates for static parsing`,
  );

  await writeFile(
    OUT,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      policy: { ...policy, now: policy.now.toISOString() },
      npmPackages: npm.packages.length,
      verified,
      candidates,
    }),
  );
  console.log(`[discover] wrote ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
