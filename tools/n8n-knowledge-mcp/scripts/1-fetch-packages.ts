// scripts/1-fetch-packages.ts
// Pull official n8n nodes from the n8n-io/n8n GitHub repository and the
// community packages selected by scripts/0-discover-community-packages.ts.
// Community tarballs come only from trusted npm hosts and must match their
// SRI before they are extracted; their code is never run (step 2 parses it
// statically). Output: .tmp/pkgs/_index.json.
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  assertOfficialPackageCoverage,
  shouldSkipCommunityPackages,
} from "../src/package-fetch-policy.js";
import { downloadVerifyExtract, npmVersionDist } from "../src/community-fetch.js";

const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const TMP = resolve(ROOT, ".tmp/pkgs");
const DISCOVERY = resolve(ROOT, ".tmp/community/discovery.json");
const CFG = JSON.parse(await readFile(resolve(ROOT, "packages.json"), "utf8"));
const SKIP_COMMUNITY = shouldSkipCommunityPackages(process.argv);

const OFFICIAL_REPO_URL = "https://github.com/n8n-io/n8n.git";
const OFFICIAL_REPO_DIR = join(TMP, "_official_n8n");
const OFFICIAL_PACKAGE_PATHS: Record<string, string> = {
  "n8n-nodes-base": "packages/nodes-base",
  "@n8n/n8n-nodes-langchain": "packages/@n8n/nodes-langchain",
};

type PackageSource = "official-github" | "community";
type PkgRef = {
  name: string;
  version: string;
  source: PackageSource;
};
type IndexedPkg = PkgRef & {
  dir: string;
  monthly_downloads: number | null;
  source_url: string;
};

async function cloneOfficialRepository(): Promise<string> {
  await rm(OFFICIAL_REPO_DIR, { recursive: true, force: true });
  await exec(
    "git",
    ["clone", "--depth=1", "--filter=blob:none", "--sparse", OFFICIAL_REPO_URL, OFFICIAL_REPO_DIR],
    { maxBuffer: 1 << 28 },
  );
  await exec(
    "git",
    [
      "-C",
      OFFICIAL_REPO_DIR,
      "sparse-checkout",
      "set",
      "--cone",
      ...Object.values(OFFICIAL_PACKAGE_PATHS),
    ],
    { maxBuffer: 1 << 28 },
  );
  const { stdout } = await exec("git", ["-C", OFFICIAL_REPO_DIR, "rev-parse", "HEAD"], {
    maxBuffer: 1 << 20,
  });
  return stdout.trim();
}

async function officialPackagesFromGitHub(names: string[]): Promise<IndexedPkg[]> {
  console.log("[fetch] cloning official n8n GitHub node packages...");
  const sha = await cloneOfficialRepository();
  const shortSha = sha.slice(0, 12);
  const packages: IndexedPkg[] = [];

  for (const name of names) {
    const repoPath = OFFICIAL_PACKAGE_PATHS[name];
    if (!repoPath) {
      console.warn(`[fetch] skip official ${name}: no GitHub source path mapping`);
      continue;
    }
    const dir = join(OFFICIAL_REPO_DIR, repoPath);
    if (!existsSync(dir)) {
      console.warn(`[fetch] skip official ${name}: missing ${repoPath} in GitHub checkout`);
      continue;
    }
    packages.push({
      name,
      version: `github:${shortSha}`,
      source: "official-github",
      dir,
      monthly_downloads: null,
      source_url: `https://github.com/n8n-io/n8n/tree/${sha}/${repoPath}`,
    });
    console.log(`[fetch] official ${name}@github:${shortSha}`);
  }

  return packages;
}

type DiscoveryCandidate = { name: string; version: string; weeklyDownloads: number };

async function loadDiscoveryCandidates(): Promise<DiscoveryCandidate[]> {
  if (!existsSync(DISCOVERY)) {
    throw new Error(
      `missing ${DISCOVERY}; run scripts/0-discover-community-packages.ts first or pass --official-only`,
    );
  }
  const discovery = JSON.parse(await readFile(DISCOVERY, "utf8")) as {
    candidates?: DiscoveryCandidate[];
  };
  return discovery.candidates ?? [];
}

async function communityPackagesFromNpm(): Promise<IndexedPkg[]> {
  const candidates = await loadDiscoveryCandidates();
  console.log(`[fetch] ${candidates.length} community candidates from discovery`);
  const packages: IndexedPkg[] = [];
  const concurrency = 8;

  for (let i = 0; i < candidates.length; i += concurrency) {
    const chunk = candidates.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (candidate): Promise<IndexedPkg | null> => {
        try {
          const dist = await npmVersionDist(candidate.name, candidate.version);
          const dir = await downloadVerifyExtract(candidate.name, dist, TMP);
          console.log(`[fetch] verified integrity for ${candidate.name}@${candidate.version}`);
          return {
            name: candidate.name,
            version: candidate.version,
            source: "community",
            dir,
            monthly_downloads: null,
            source_url: dist.tarball,
          };
        } catch (error) {
          console.warn(`[fetch] skip ${candidate.name}: ${(error as Error).message}`);
          return null;
        }
      }),
    );
    for (const result of results) if (result) packages.push(result);
  }
  console.log(`[fetch] fetched ${packages.length}/${candidates.length} community packages`);
  return packages;
}

async function main() {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });

  const index: IndexedPkg[] = [];
  index.push(...(await officialPackagesFromGitHub(CFG.official as string[])));

  if (!SKIP_COMMUNITY) {
    index.push(...(await communityPackagesFromNpm()));
  } else {
    console.log("[fetch] skipping community packages for the official-only build");
  }

  assertOfficialPackageCoverage(CFG.official as string[], index);
  await writeFile(join(TMP, "_index.json"), JSON.stringify(index, null, 2));
  console.log(`[fetch] done: ${index.length} packages -> ${TMP}/_index.json`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
