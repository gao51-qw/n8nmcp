import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("verified knowledge image contract", () => {
  const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");
  const dockerignore = readFileSync(resolve(process.cwd(), ".dockerignore"), "utf8");
  const workflow = readFileSync(
    resolve(process.cwd(), "../../.github/workflows/n8n-knowledge-mcp.yml"),
    "utf8",
  );
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));

  it("defines one exact official knowledge build followed by production verification in CI", () => {
    expect(pkg.scripts["build:knowledge"]).toBe(
      "npm run build:nodes && npm run fetch:templates && npm run build:templates && npm run emit:stats && npm run verify:knowledge",
    );
    expect(pkg.scripts["verify:production-artifacts"]).toBe(
      "tsx scripts/10-verify-production-artifacts.ts",
    );
    expect(workflow.match(/npm run build:knowledge/g)).toHaveLength(1);
    expect(workflow.match(/npm run verify:production-artifacts/g)).toHaveLength(1);
    expect(workflow).not.toContain("npm run build:db");
    expect(workflow).not.toContain("verify:knowledge:fallback");

    const buildKnowledgeAt = workflow.indexOf("npm run build:knowledge");
    const verifyArtifactsAt = workflow.indexOf("npm run verify:production-artifacts");
    const dockerBuildAt = workflow.indexOf("docker/build-push-action");
    expect(buildKnowledgeAt).toBeGreaterThan(-1);
    expect(verifyArtifactsAt).toBeGreaterThan(buildKnowledgeAt);
    expect(dockerBuildAt).toBeGreaterThan(verifyArtifactsAt);
  });

  it("copies every verified artifact and only compiles application code in Docker", () => {
    expect(dockerfile).toContain("COPY data/nodes.db ./data/nodes.db");
    expect(dockerfile).toContain("COPY data/stats.json ./data/stats.json");
    expect(dockerfile).toContain(
      "COPY data/knowledge-quality-report.json ./data/knowledge-quality-report.json",
    );
    expect(dockerfile.match(/RUN npm run [^\r\n]+/g)).toEqual(["RUN npm run build"]);
    expect(dockerfile).toContain("USER app");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain('CMD ["node", "dist/src/server.js"]');
    expect(pkg.scripts.start).toBe("node dist/src/server.js");
  });

  it("excludes rebuild inputs and SQLite sidecars without excluding verified artifacts", () => {
    const ignored = new Set(
      dockerignore.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    );
    expect(ignored).toContain(".tmp");
    expect(ignored).toContain("data/curated-templates");
    expect(ignored).toContain("data/nodes.db-shm");
    expect(ignored).toContain("data/nodes.db-wal");
    expect(ignored).not.toContain("data/nodes.db");
    expect(ignored).not.toContain("data/stats.json");
    expect(ignored).not.toContain("data/knowledge-quality-report.json");
  });
});
