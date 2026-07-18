// scripts/1-fetch-packages.ts
// Pull official n8n nodes from the n8n-io/n8n GitHub repository and optional
// community packages from npm. Output: .tmp/pkgs/_index.json.
import { createWriteStream, existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import * as tar from "tar";
import {
  assertOfficialPackageCoverage,
  shouldSkipCommunityPackages,
} from "../src/package-fetch-policy.js";
import { assertTrustedTarballUrl, verifyPackageIntegrity } from "../src/package-supply-chain.js";

const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const TMP = resolve(ROOT, ".tmp/pkgs");
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
type CommunityPkgRef = PkgRef & {
  tarball: string;
  integrity?: string;
};
type IndexedPkg = PkgRef & {
  dir: string;
  monthly_downloads: number | null;
  source_url: string;
};

function safeName(name: string): string {
  return name.replace(/[@/]/g, "_");
}

async function npmRegistryMeta(
  name: string,
): Promise<{ version: string; tarball: string; integrity?: string }> {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`npm meta ${name}: ${response.status}`);
  const metadata = (await response.json()) as {
    version: string;
    dist: { tarball: string; integrity?: string };
  };
  assertTrustedTarballUrl(metadata.dist.tarball);
  return {
    version: metadata.version,
    tarball: metadata.dist.tarball,
    integrity: metadata.dist.integrity,
  };
}

async function npmDownloads(name: string): Promise<number> {
  const response = await fetch(`https://api.npmjs.org/downloads/point/last-month/${name}`);
  if (!response.ok) return 0;
  const metadata = (await response.json()) as { downloads?: number };
  return metadata.downloads ?? 0;
}

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

const NAME_RE = /^(?:@[^/]+\/)?n8n-nodes-[a-z0-9._-]+$/i;

async function searchCommunityKeyword(keyword: string, cap: number): Promise<string[]> {
  const page = 250;
  const packages: string[] = [];
  for (let from = 0; from < cap; from += page) {
    const size = Math.min(page, cap - from);
    const url = `https://registry.npmjs.org/-/v1/search?text=keywords:${encodeURIComponent(keyword)}&size=${size}&from=${from}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`npm search ${keyword}@${from}: ${response.status}`);
    const metadata = (await response.json()) as {
      total?: number;
      objects: Array<{ package: { name: string } }>;
    };
    const batch = metadata.objects.map((item) => item.package.name);
    packages.push(...batch);
    if (batch.length < size) break;
    if (typeof metadata.total === "number" && from + batch.length >= metadata.total) break;
  }
  return packages;
}

async function searchCommunity(): Promise<string[]> {
  const keywords: string[] =
    CFG.community.search_keywords ??
    (CFG.community.search_keyword ? [CFG.community.search_keyword] : []);
  const blacklist: string[] = CFG.community.blacklist ?? [];
  const cap: number = CFG.community.max_packages ?? 1000;
  const seen = new Set<string>();

  for (const keyword of keywords) {
    const names = await searchCommunityKeyword(keyword, cap);
    for (const name of names) seen.add(name);
    console.log(
      `[fetch] keyword="${keyword}" -> ${names.length} hits (running total: ${seen.size})`,
    );
  }

  return Array.from(seen).filter((name) => !blacklist.includes(name) && NAME_RE.test(name));
}

async function downloadAndExtract(ref: CommunityPkgRef): Promise<string> {
  const dir = join(TMP, safeName(ref.name));
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const tgz = join(dir, "pkg.tgz");
  const response = await fetch(ref.tarball);
  if (!response.ok || !response.body) {
    throw new Error(`download ${ref.name}: ${response.status}`);
  }
  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(tgz));

  const content = await readFile(tgz);
  verifyPackageIntegrity(ref.name, content, ref.integrity);
  console.log(`[fetch] verified integrity for ${ref.name}`);

  await tar.x({ file: tgz, cwd: dir, strip: 1 });
  await rm(tgz);
  return dir;
}

async function communityPackagesFromNpm(): Promise<IndexedPkg[]> {
  console.log("[fetch] searching community packages...");
  const community = await searchCommunity();
  console.log(`[fetch] ${community.length} community candidates after name filter and blacklist`);

  const minDownloads: number = CFG.community.min_monthly_downloads ?? 0;
  const downloads: Record<string, number> = {};
  const refs: CommunityPkgRef[] = [];
  const concurrency = 8;

  for (let i = 0; i < community.length; i += concurrency) {
    const chunk = community.slice(i, i + concurrency);
    const results = await Promise.all(
      chunk.map(async (name) => {
        try {
          const downloadsLastMonth = await npmDownloads(name);
          if (downloadsLastMonth < minDownloads) return null;
          const metadata = await npmRegistryMeta(name);
          downloads[name] = downloadsLastMonth;
          return {
            name,
            version: metadata.version,
            tarball: metadata.tarball,
            integrity: metadata.integrity,
            source: "community" as const,
          };
        } catch (error) {
          console.warn(`[fetch] skip ${name}: ${(error as Error).message}`);
          return null;
        }
      }),
    );
    for (const result of results) if (result) refs.push(result);
  }

  console.log(`[fetch] kept ${refs.length} community packages (min ${minDownloads} dl/month)`);
  const packages: IndexedPkg[] = [];
  for (const ref of refs) {
    try {
      const dir = await downloadAndExtract(ref);
      packages.push({
        name: ref.name,
        version: ref.version,
        source: ref.source,
        dir,
        monthly_downloads: downloads[ref.name] ?? null,
        source_url: ref.tarball,
      });
      console.log(`[fetch] community ${ref.name}@${ref.version}`);
    } catch (error) {
      console.warn(`[fetch] skip ${ref.name}: ${(error as Error).message}`);
    }
  }
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
