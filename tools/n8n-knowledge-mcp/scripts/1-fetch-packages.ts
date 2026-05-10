// scripts/1-fetch-packages.ts
// Pull npm tarballs of n8n node packages into .tmp/pkgs/<safeName>/
// Output: .tmp/pkgs/_index.json describing each unpacked package.
import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve, join } from "node:path";
import * as tar from "tar";
import { createWriteStream } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const exec = promisify(execFile);
const ROOT = resolve(process.cwd());
const TMP = resolve(ROOT, ".tmp/pkgs");
const CFG = JSON.parse(await readFile(resolve(ROOT, "packages.json"), "utf8"));

type PkgRef = { name: string; version: string; tarball: string; source: "official" | "community" };

function safeName(name: string): string {
  return name.replace(/[@/]/g, "_");
}

async function npmRegistryMeta(name: string): Promise<{ version: string; tarball: string }> {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}/latest`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`npm meta ${name}: ${r.status}`);
  const j = (await r.json()) as { version: string; dist: { tarball: string } };
  return { version: j.version, tarball: j.dist.tarball };
}

async function npmDownloads(name: string): Promise<number> {
  const r = await fetch(`https://api.npmjs.org/downloads/point/last-month/${name}`);
  if (!r.ok) return 0;
  const j = (await r.json()) as { downloads?: number };
  return j.downloads ?? 0;
}

async function searchCommunity(): Promise<string[]> {
  const { search_keyword, max_packages, blacklist } = CFG.community;
  const url = `https://registry.npmjs.org/-/v1/search?text=keywords:${encodeURIComponent(search_keyword)}&size=${max_packages}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error(`npm search: ${r.status}`);
  const j = (await r.json()) as { objects: Array<{ package: { name: string } }> };
  const names = j.objects.map((o) => o.package.name).filter((n) => !blacklist.includes(n));
  return Array.from(new Set(names));
}

async function downloadAndExtract(ref: PkgRef): Promise<string> {
  const dir = join(TMP, safeName(ref.name));
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const tgz = join(dir, "pkg.tgz");
  const res = await fetch(ref.tarball);
  if (!res.ok || !res.body) throw new Error(`download ${ref.name}: ${res.status}`);
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(tgz));
  await tar.x({ file: tgz, cwd: dir, strip: 1 });
  await rm(tgz);
  return dir;
}

async function main() {
  await rm(TMP, { recursive: true, force: true });
  await mkdir(TMP, { recursive: true });

  const refs: PkgRef[] = [];

  console.log("[fetch] resolving official packages...");
  for (const name of CFG.official as string[]) {
    const meta = await npmRegistryMeta(name);
    refs.push({ name, version: meta.version, tarball: meta.tarball, source: "official" });
  }

  console.log("[fetch] searching community packages...");
  const community = await searchCommunity();
  console.log(`[fetch] found ${community.length} community candidates, filtering by downloads...`);
  let kept = 0;
  for (const name of community) {
    try {
      const dl = await npmDownloads(name);
      if (dl < CFG.community.min_monthly_downloads) continue;
      const meta = await npmRegistryMeta(name);
      refs.push({ name, version: meta.version, tarball: meta.tarball, source: "community" });
      kept++;
    } catch (e) {
      console.warn(`[fetch] skip ${name}: ${(e as Error).message}`);
    }
  }
  console.log(`[fetch] kept ${kept} community packages (>=${CFG.community.min_monthly_downloads} dl/month)`);

  const index: Array<PkgRef & { dir: string }> = [];
  for (const ref of refs) {
    try {
      const dir = await downloadAndExtract(ref);
      index.push({ ...ref, dir });
      console.log(`[fetch] ✓ ${ref.name}@${ref.version}`);
    } catch (e) {
      console.warn(`[fetch] ✗ ${ref.name}: ${(e as Error).message}`);
    }
  }
  await writeFile(join(TMP, "_index.json"), JSON.stringify(index, null, 2));
  console.log(`[fetch] done: ${index.length} packages → ${TMP}/_index.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
