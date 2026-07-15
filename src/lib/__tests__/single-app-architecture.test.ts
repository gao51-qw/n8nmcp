import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(root, path), "utf8")) as Record<string, unknown>;
}

describe("single application architecture", () => {
  it("uses the root npm package without workspaces", () => {
    const manifest = readJson("package.json");
    expect(manifest.packageManager).toBe("npm@11.6.2");
    expect(manifest).not.toHaveProperty("workspaces");
  });

  it("does not retain the retired workspace tree or pnpm and Turbo files", () => {
    for (const path of [
      "apps",
      "packages",
      "turbo.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
    ]) {
      expect(existsSync(resolve(root, path)), path).toBe(false);
    }
  });

  it("keeps workspace packages out of the npm lockfile", () => {
    const lock = readJson("package-lock.json") as {
      packages?: Record<string, { workspaces?: string[] }>;
    };
    const packageKeys = Object.keys(lock.packages ?? {});
    expect(lock.packages?.[""]?.workspaces).toBeUndefined();
    expect(
      packageKeys.filter(
        (key) =>
          key.startsWith("apps/") ||
          key.startsWith("packages/") ||
          key.startsWith("node_modules/@n8nmcp/"),
      ),
    ).toEqual([]);
  });
});
