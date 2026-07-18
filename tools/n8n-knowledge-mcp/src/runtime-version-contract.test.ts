import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");
const repositoryRoot = resolve(packageRoot, "../..");

describe("Knowledge MCP Node runtime contract", () => {
  it("pins local, package, CI, and Docker runtimes to Node 22", () => {
    const packageJson = JSON.parse(readFileSync(resolve(packageRoot, "package.json"), "utf8")) as {
      engines?: { node?: string };
    };
    const localVersion = readFileSync(resolve(packageRoot, ".nvmrc"), "utf8").trim();
    const workflow = readFileSync(
      resolve(repositoryRoot, ".github/workflows/n8n-knowledge-mcp.yml"),
      "utf8",
    );
    const dockerfile = readFileSync(resolve(packageRoot, "Dockerfile"), "utf8");
    const rootPackageJson = JSON.parse(
      readFileSync(resolve(repositoryRoot, "package.json"), "utf8"),
    ) as { engines?: { node?: string } };
    const rootLocalVersion = readFileSync(resolve(repositoryRoot, ".nvmrc"), "utf8").trim();
    const rootDockerfile = readFileSync(resolve(repositoryRoot, "Dockerfile"), "utf8");
    const rootWorkflow = readFileSync(resolve(repositoryRoot, ".github/workflows/test.yml"), "utf8");

    expect(packageJson.engines?.node).toBe("22.x");
    expect(localVersion).toBe("22");
    expect(workflow).toMatch(/node-version:\s*["']?22["']?/);
    expect(dockerfile.match(/FROM node:22-bookworm-slim/g)).toHaveLength(2);
    expect(rootPackageJson.engines?.node).toBe("22.x");
    expect(rootLocalVersion).toBe("22");
    expect(rootWorkflow).toMatch(/node-version:\s*["']?22["']?/);
    expect(rootDockerfile.match(/FROM node:22-alpine/g)).toHaveLength(2);
  });
});
