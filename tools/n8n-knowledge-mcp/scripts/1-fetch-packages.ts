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

const NAME_RE = /^(?:@[^/]+\/)?n8n-nodes-[a-z0-9._-]+$/i;

async function searchCommunityKeyword(keyword: string, cap: number): Promise<string[]> {
  const PAGE = 250; // npm search hard limit per request
  const out: string[] = [];
  for (let from = 0; from < cap; from += PAGE) {
    const size = Math.min(PAGE, cap - from);
    const url = `https://registry.npmjs.org/-/v1/search?text=keywords:${encodeURIComponent(keyword)}&size=${size}&from=${from}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`npm search ${keyword}@${from}: ${r.status}`);
    const j = (await r.json()) as {
      total?: number;
      objects: Array<{ package: { name: string } }>;
    };
    const batch = j.objects.map((o) => o.package.name);
    out.push(...batch);
    if (batch.length < size) break;
    if (typeof j.total === "number" && from + batch.length >= j.total) break;
  }
  return out;
}

async function searchCommunity(): Promise<string[]> {
  const keywords: string[] =
    CFG.community.search_keywords ??
    (CFG.community.search_keyword ? [CFG.community.search_keyword] : []);
  const blacklist: string[] = CFG.community.blacklist ?? [];
  const cap: number = CFG.community.max_packages ?? 1000;

  const seen = new Set<string>();
  for (const kw of keywords) {
    const names = await searchCommunityKeyword(kw, cap);
    for (const n of names) seen.add(n);
    console.log(`[fetch]   keyword="${kw}" → ${names.length} hits (running total: ${seen.size})`);
  }

  return Array.from(seen).filter(
    (n) => !blacklist.includes(n) && NAME_RE.test(n),
  );
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
  console.log(`[fetch] ${community.length} community candidates after name filter & blacklist`);
  const minDl: number = CFG.community.min_monthly_downloads ?? 0;
  let kept = 0;
  // Resolve metadata with bounded concurrency so this stays fast at ~1000 pkgs.
  const downloads: Record<string, number> = {};
  const CONC = 8;
  for (let i = 0; i < community.length; i += CONC) {
    const chunk = community.slice(i, i + CONC);
    const results = await Promise.all(
      chunk.map(async (name) => {
        try {
          const dl = await npmDownloads(name);
          if (dl < minDl) return null;
          const meta = await npmRegistryMeta(name);
          downloads[name] = dl;
          return { name, version: meta.version, tarball: meta.tarball, source: "community" as const };
        } catch (e) {
          console.warn(`[fetch] skip ${name}: ${(e as Error).message}`);
          return null;
        }
      }),
    );
    for (const r of results) if (r) { refs.push(r); kept++; }
  }
  console.log(`[fetch] kept ${kept} community packages (min ${minDl} dl/month)`);

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
  const enriched = index.map((r) => ({ ...r, monthly_downloads: downloads[r.name] ?? null }));
  await writeFile(join(TMP, "_index.json"), JSON.stringify(enriched, null, 2));
  console.log(`[fetch] done: ${index.length} packages → ${TMP}/_index.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
