import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as tar from "tar";
import { mkdir, writeFile, symlink } from "node:fs/promises";
import { downloadVerifyExtract, isExtractableEntry, npmVersionDist } from "./community-fetch.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function tempDir() {
  const dir = await mkdtemp(join(tmpdir(), "community-fetch-"));
  directories.push(dir);
  return dir;
}

async function packTarball(withSymlink = false): Promise<Buffer> {
  const src = await tempDir();
  await mkdir(join(src, "package", "dist"), { recursive: true });
  await writeFile(join(src, "package", "package.json"), JSON.stringify({ name: "n8n-nodes-x" }));
  await writeFile(join(src, "package", "dist", "X.node.js"), "class X {}");
  if (withSymlink) {
    try {
      await symlink(join(src, "outside.txt"), join(src, "package", "link.txt"));
    } catch {
      // Symlinks need privileges on some Windows setups; the filter test below still covers it.
    }
  }
  const out = join(src, "pkg.tgz");
  await tar.c({ gzip: true, file: out, cwd: src }, ["package"]);
  return readFile(out);
}

function sri(content: Buffer) {
  return `sha512-${createHash("sha512").update(content).digest("base64")}`;
}

function fetchReturning(body: Buffer) {
  return vi.fn(async () => new Response(new Uint8Array(body), { status: 200 }));
}

const TARBALL = "https://registry.npmjs.org/n8n-nodes-x/-/n8n-nodes-x-1.0.0.tgz";

describe("npmVersionDist", () => {
  it("returns the pinned version's tarball and integrity", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ dist: { tarball: TARBALL, integrity: "sha512-abc==" } }),
    );
    await expect(npmVersionDist("@acme/n8n-nodes-x", "1.0.0", fetchImpl as typeof fetch)).resolves.toEqual({
      tarball: TARBALL,
      integrity: "sha512-abc==",
    });
    expect(fetchImpl).toHaveBeenCalledWith("https://registry.npmjs.org/@acme%2Fn8n-nodes-x/1.0.0");
  });

  it("rejects untrusted tarball hosts and missing integrity", async () => {
    const evil = vi.fn(async () =>
      Response.json({ dist: { tarball: "https://evil.example/x.tgz", integrity: "sha512-a==" } }),
    );
    await expect(npmVersionDist("n8n-nodes-x", "1.0.0", evil as typeof fetch)).rejects.toThrow(/untrusted host/);
    const noSri = vi.fn(async () => Response.json({ dist: { tarball: TARBALL } }));
    await expect(npmVersionDist("n8n-nodes-x", "1.0.0", noSri as typeof fetch)).rejects.toThrow(/integrity/);
  });
});

describe("downloadVerifyExtract", () => {
  it("extracts a tarball whose SRI matches", async () => {
    const body = await packTarball();
    const root = await tempDir();
    const dir = await downloadVerifyExtract(
      "n8n-nodes-x",
      { tarball: TARBALL, integrity: sri(body) },
      root,
      { fetchImpl: fetchReturning(body) as typeof fetch },
    );
    expect(existsSync(join(dir, "dist", "X.node.js"))).toBe(true);
    expect(existsSync(join(dir, "pkg.tgz"))).toBe(false);
  });

  it("refuses a tarball that does not match its SRI and leaves nothing behind", async () => {
    const body = await packTarball();
    const root = await tempDir();
    await expect(
      downloadVerifyExtract(
        "n8n-nodes-x",
        { tarball: TARBALL, integrity: sri(Buffer.from("other")) },
        root,
        { fetchImpl: fetchReturning(body) as typeof fetch },
      ),
    ).rejects.toThrow(/Integrity check failed/);
    expect(existsSync(join(root, "n8n-nodes-x"))).toBe(false);
  });

  it("refuses when the registry integrity differs from the reviewed checksum", async () => {
    const body = await packTarball();
    const fetchImpl = fetchReturning(body);
    await expect(
      downloadVerifyExtract(
        "n8n-nodes-x",
        { tarball: TARBALL, integrity: sri(body) },
        await tempDir(),
        { expectedIntegrity: "sha512-reviewed==", fetchImpl: fetchImpl as typeof fetch },
      ),
    ).rejects.toThrow(/Integrity mismatch/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("does not extract symlinks", async () => {
    const body = await packTarball(true);
    const dir = await downloadVerifyExtract(
      "n8n-nodes-x",
      { tarball: TARBALL, integrity: sri(body) },
      await tempDir(),
      { fetchImpl: fetchReturning(body) as typeof fetch },
    );
    expect(existsSync(join(dir, "link.txt"))).toBe(false);
  });
});

describe("isExtractableEntry", () => {
  it.each([
    ["File", true],
    ["Directory", true],
    ["SymbolicLink", false],
    ["Link", false],
    ["CharacterDevice", false],
  ])("%s → %s", (type, expected) => {
    expect(isExtractableEntry({ type })).toBe(expected);
  });
});
