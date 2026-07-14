import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("external candidate opt-in commands", () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
  const requiredFiles = [
    "scripts/7-import-external-candidates.ts",
    "scripts/8-verify-external-nodes.ts",
    "src/external-node-validation.ts",
  ];

  it("ships every file referenced by the documented opt-in commands", () => {
    expect(pkg.scripts["build:db:with-external"]).toContain("7-import-external-candidates.ts");
    expect(pkg.scripts["build:db:with-external"]).toContain("8-verify-external-nodes.ts");
    expect(pkg.scripts["import:external-candidates"]).toContain("7-import-external-candidates.ts");
    expect(pkg.scripts["verify:external-nodes"]).toContain("8-verify-external-nodes.ts");
    expect(pkg.scripts["build:knowledge"]).not.toContain("external");

    for (const file of requiredFiles) {
      expect(existsSync(resolve(process.cwd(), file)), `missing ${file}`).toBe(true);
      expect(() => execFileSync("git", ["ls-files", "--error-unmatch", `tools/n8n-knowledge-mcp/${file}`], {
        cwd: resolve(process.cwd(), "../.."),
        stdio: "ignore",
      }), `untracked ${file}`).not.toThrow();
    }
  });

  it.each([
    "scripts/7-import-external-candidates.ts",
    "scripts/8-verify-external-nodes.ts",
  ])("runs the %s help path without a database or external checkout", (file) => {
    const result = spawnSync(
      process.execPath,
      [resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"), resolve(process.cwd(), file), "--help"],
      { cwd: process.cwd(), encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Usage:/);
  });
});
