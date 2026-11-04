// Download + verify + extract one community package tarball.
//
// The version is pinned (from discovery), the tarball must come from a
// trusted npm host and match its SRI before anything is unpacked, and only
// regular files and directories are extracted. Package code is never run.
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import * as tar from "tar";
import { assertTrustedTarballUrl, verifyPackageIntegrity } from "./package-supply-chain.js";

export type CommunityPackageDist = { tarball: string; integrity: string };

const MAX_TARBALL_BYTES = 50 * 1024 * 1024;

export function safePackageDirName(name: string): string {
  return name.replace(/[@/]/g, "_");
}

/** Registry metadata for one exact version; the tarball host is checked. */
export async function npmVersionDist(
  name: string,
  version: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CommunityPackageDist> {
  const url = `https://registry.npmjs.org/${name.replace("/", "%2F")}/${encodeURIComponent(version)}`;
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`npm meta ${name}@${version}: ${response.status}`);
  const metadata = (await response.json()) as { dist?: { tarball?: string; integrity?: string } };
  const tarball = metadata.dist?.tarball;
  const integrity = metadata.dist?.integrity;
  if (!tarball) throw new Error(`npm meta ${name}@${version}: no tarball`);
  if (!integrity) throw new Error(`Missing integrity hash for ${name}`);
  assertTrustedTarballUrl(tarball);
  return { tarball, integrity };
}

export function isExtractableEntry(entry: { type?: string; isDirectory?: () => boolean }): boolean {
  const type =
    typeof entry.type === "string" ? entry.type : entry.isDirectory?.() ? "Directory" : "File";
  return type === "File" || type === "OldFile" || type === "Directory";
}

/**
 * Downloads `dist.tarball`, checks it against `expectedIntegrity` (and the
 * registry's integrity when both are given), then extracts it into
 * `<targetRoot>/<safe name>`. Returns the package directory.
 */
export async function downloadVerifyExtract(
  name: string,
  dist: CommunityPackageDist,
  targetRoot: string,
  options: { expectedIntegrity?: string; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  assertTrustedTarballUrl(dist.tarball);
  if (options.expectedIntegrity && options.expectedIntegrity !== dist.integrity) {
    throw new Error(
      `Integrity mismatch for ${name}: reviewed ${options.expectedIntegrity}, registry ${dist.integrity}`,
    );
  }
  const dir = join(targetRoot, safePackageDirName(name));
  if (existsSync(dir)) await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const tgz = join(dir, "pkg.tgz");
  const response = await (options.fetchImpl ?? fetch)(dist.tarball);
  if (!response.ok || !response.body) throw new Error(`download ${name}: ${response.status}`);
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_TARBALL_BYTES) throw new Error(`download ${name}: tarball too large (${length} bytes)`);
  await pipeline(Readable.fromWeb(response.body as never), createWriteStream(tgz));

  const content = await readFile(tgz);
  if (content.length > MAX_TARBALL_BYTES) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`download ${name}: tarball too large (${content.length} bytes)`);
  }
  try {
    verifyPackageIntegrity(name, content, dist.integrity);
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }

  await tar.x({ file: tgz, cwd: dir, strip: 1, filter: (_path, entry) => isExtractableEntry(entry) });
  await rm(tgz);
  return dir;
}
