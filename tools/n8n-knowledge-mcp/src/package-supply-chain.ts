import { createHash } from "node:crypto";

const TRUSTED_TARBALL_HOSTS = new Set([
  "registry.npmjs.org",
  "registry.npmjs.com",
  "registry.yarnpkg.com",
]);
const SUPPORTED_INTEGRITY_ALGORITHMS = new Set(["sha1", "sha256", "sha384", "sha512"]);

export function assertTrustedTarballUrl(tarball: string): void {
  const url = new URL(tarball);
  if (!TRUSTED_TARBALL_HOSTS.has(url.hostname)) {
    throw new Error(`Rejected tarball from untrusted host: ${url.hostname}`);
  }
}

export function verifyPackageIntegrity(
  packageName: string,
  tarball: Buffer,
  integrity: string | undefined,
): void {
  if (!integrity) throw new Error(`Missing integrity hash for ${packageName}`);
  const [algorithm, expected] = integrity.split("-", 2);
  if (!algorithm || !expected || !SUPPORTED_INTEGRITY_ALGORITHMS.has(algorithm)) {
    throw new Error(`Unsupported integrity algorithm for ${packageName}: ${algorithm || "unknown"}`);
  }
  const actual = createHash(algorithm).update(tarball).digest("base64");
  if (actual !== expected) {
    throw new Error(
      `Integrity check failed for ${packageName}: expected ${integrity}, got ${algorithm}-${actual}`,
    );
  }
}
