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

  it("ignores reproducible local workspace state", () => {
    const gitignore = readFileSync(resolve(root, ".gitignore"), "utf8");
    for (const rule of [
      ".tmp/",
      ".npm-cache/",
      ".worktrees/",
      "test-results/",
      "*.tsbuildinfo",
      ".superpowers/sdd/",
    ]) {
      expect(gitignore, rule).toContain(rule);
    }
  });

  it("documents the root Next application as the active architecture", () => {
    const guide = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    expect(guide).toContain("Root Next.js application");
    expect(guide).toContain("tools/n8n-knowledge-mcp");
    expect(guide).toContain("npm ci");
    expect(guide).not.toMatch(/Turborepo|pnpm|apps\/api|apps\/dashboard|packages\/types/);
  });

  it("keeps reproducible workspace state out of root linting", () => {
    const eslintConfig = readFileSync(resolve(root, "eslint.config.js"), "utf8");
    for (const path of [".superpowers/sdd/**", ".tmp/**", ".worktrees/**", "test-results/**"]) {
      expect(eslintConfig, path).toContain(path);
    }
  });
});
