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
  const statsEmitter = readFileSync(resolve(process.cwd(), "scripts/6-emit-stats.ts"), "utf8");
  const nodeParser = readFileSync(resolve(process.cwd(), "scripts/2-parse-nodes.ts"), "utf8");
  const dbBuilder = readFileSync(resolve(process.cwd(), "scripts/4-build-db.ts"), "utf8");
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));

  it("builds nodes once and gates production verification and Docker on official success", () => {
    expect(pkg.scripts["build:knowledge"]).toBe(
      "npm run build:nodes:official && npm run fetch:templates && npm run build:templates && npm run emit:stats && npm run verify:knowledge",
    );
    expect(pkg.scripts["verify:production-artifacts"]).toBe(
      "tsx scripts/10-verify-production-artifacts.ts",
    );
    expect([...workflow.matchAll(/npm run build:nodes:official/g)]).toHaveLength(1);
    expect(workflow.match(/npm run verify:production-artifacts/g)).toHaveLength(1);
    expect(workflow).not.toContain("npm run build:db");

    const buildNodesAt = workflow.indexOf("npm run build:nodes:official");
    const officialBuildAt = workflow.indexOf("name: Build and verify official template database");
    const fallbackBuildAt = workflow.indexOf("name: Build curated fallback database");
    const fallbackUploadAt = workflow.indexOf("name: Upload degraded fallback");
    const fallbackStopAt = workflow.indexOf("name: Stop after degraded fallback");
    const verifyStepAt = workflow.indexOf("name: Verify production artifacts");
    const verifyArtifactsAt = workflow.indexOf("npm run verify:production-artifacts");
    const dockerBuildAt = workflow.indexOf("name: Build local Linux image");
    const smokeAt = workflow.indexOf("name: Smoke local image");
    expect(buildNodesAt).toBeGreaterThan(-1);
    expect(officialBuildAt).toBeGreaterThan(buildNodesAt);
    expect(fallbackBuildAt).toBeGreaterThan(officialBuildAt);
    expect(fallbackUploadAt).toBeGreaterThan(fallbackBuildAt);
    expect(fallbackStopAt).toBeGreaterThan(fallbackUploadAt);
    expect(verifyArtifactsAt).toBeGreaterThan(fallbackStopAt);
    expect(dockerBuildAt).toBeGreaterThan(verifyArtifactsAt);

    expect(workflow.slice(officialBuildAt, fallbackBuildAt)).toContain(
      "if: steps.official.outcome == 'success'",
    );
    expect(workflow.slice(fallbackBuildAt, fallbackUploadAt)).toContain(
      "if: steps.official.outcome != 'success'",
    );
    expect(workflow.slice(fallbackUploadAt, fallbackStopAt)).toContain(
      "if: steps.official.outcome != 'success'",
    );
    expect(workflow.slice(fallbackStopAt, verifyArtifactsAt)).toContain("run: exit 1");
    expect(workflow.slice(fallbackStopAt, verifyArtifactsAt)).toContain(
      "if: steps.official.outcome != 'success'",
    );
    expect(workflow.slice(verifyStepAt, verifyArtifactsAt)).toContain(
      "if: steps.official.outcome == 'success'",
    );
    expect(workflow.slice(dockerBuildAt, smokeAt)).toContain(
      "if: steps.official.outcome == 'success'",
    );
  });

  it("copies every verified artifact and only compiles application code in Docker", () => {
    expect(dockerfile).toContain("COPY vitest.global-setup.ts ./");
    expect(dockerfile).toContain("COPY --chown=app:nogroup data/nodes.db ./data/nodes.db");
    expect(dockerfile).toContain("COPY --chown=app:nogroup data/stats.json ./data/stats.json");
    expect(dockerfile).toContain(
      "COPY --chown=app:nogroup data/knowledge-quality-report.json ./data/knowledge-quality-report.json",
    );
    expect(() => assertDockerfileBuildIsCompilationOnly(dockerfile)).not.toThrow();
    for (const unsafeInstruction of [
      "RUN npx tsx scripts/4-build-db.ts",
      "RUN node scripts/5-fetch-official-templates.js",
      "RUN npm run build:knowledge",
      "RUN npm run build:templates",
      "RUN npm run parse:nodes",
      "RUN npm run import:external-candidates",
      "RUN curl -fsSL https://example.com/nodes.db -o data/nodes.db",
      "RUN wget https://example.com/stats.json",
      "RUN apt-get update && apt-get install -y --no-install-recommends curl && curl https://example.com/nodes.db",
      "ADD https://example.com/nodes.db /app/data/nodes.db",
    ]) {
      expect(() => assertDockerfileBuildIsCompilationOnly(`${dockerfile}\n${unsafeInstruction}\n`))
        .toThrow();
    }
    expect(dockerfile).toContain("USER app");
    expect(dockerfile).toContain("HEALTHCHECK");
    expect(dockerfile).toContain('CMD ["node", "dist/src/server.js"]');
    expect(pkg.scripts.start).toBe("node dist/src/server.js");
  });

  it("finalizes the published SQLite database for a read-only runtime", () => {
    expect(dbBuilder).toContain('db.pragma("journal_mode = DELETE")');
    expect(dbBuilder.indexOf('db.pragma("journal_mode = DELETE")'))
      .toBeLessThan(dbBuilder.lastIndexOf("db.close()"));
  });

  it("excludes rebuild inputs and SQLite sidecars without excluding verified artifacts", () => {
    const ignored = new Set(dockerignorePatterns(dockerignore));
    expect(ignored).toContain(".tmp");
    expect(ignored).toContain("data/curated-templates");
    expect(ignored).toContain("data/nodes.db-shm");
    expect(ignored).toContain("data/nodes.db-wal");
    expect(ignored).not.toContain("data/nodes.db");
    expect(ignored).not.toContain("data/stats.json");
    expect(ignored).not.toContain("data/knowledge-quality-report.json");

    const requiredArtifacts = [
      "data/nodes.db",
      "data/stats.json",
      "data/knowledge-quality-report.json",
    ];
    expect(requiredArtifacts.filter((path) => isDockerIgnored(path, dockerignore))).toEqual([]);
    for (const broadExclusion of ["data", "data/*", "data/**"]) {
      expect(requiredArtifacts.every((path) => isDockerIgnored(path, broadExclusion))).toBe(true);
      expect(
        requiredArtifacts.every((path) => isDockerIgnored(path, `${dockerignore}\n${broadExclusion}`)),
      ).toBe(true);
      const reIncluded = [
        dockerignore,
        broadExclusion,
        "!data/nodes.db",
        "!data/stats.json",
        "!data/knowledge-quality-report.json",
      ].join("\n");
      expect(requiredArtifacts.some((path) => isDockerIgnored(path, reIncluded))).toBe(false);
    }
  });

  it("emits the categories object required by production stats validation", () => {
    expect(statsEmitter).toMatch(/const categories\s*=/);
    expect(statsEmitter).toMatch(/const stats\s*=\s*\{[\s\S]*\bcategories,/);
  });

  it("delegates node package parsing without owning dynamic module loading", () => {
    expect(nodeParser).toMatch(
      /import\s*\{[^}]*parseNodePackage[^}]*\}\s*from\s*["']\.\.\/src\/node-package-parser\.js["']/,
    );
    expect(nodeParser).toContain("parseNodePackage(pkg)");
    expect(nodeParser).toContain("pkg.source");
    expect(nodeParser).not.toContain("pathToFileURL");
    expect(nodeParser).not.toMatch(/\bimport\s*\(/);
  });
});

function assertDockerfileBuildIsCompilationOnly(contents: string): void {
  const instructions = logicalDockerInstructions(contents);
  const allowedRun = [
    /^RUN apt-get update && apt-get install -y --no-install-recommends .+$/,
    /^RUN corepack enable && npm install --no-audit --no-fund$/,
    /^RUN npm run build$/,
  ];
  for (const instruction of instructions) {
    if (instruction.startsWith("ADD ")) {
      throw new Error(`Docker ADD is forbidden: ${instruction}`);
    }
    if (instruction.startsWith("RUN ") &&
      /\b(?:curl|wget|fetch)\b|scripts[\\/]|npm run (?:build:(?:db|nodes|templates|knowledge|sqlite)|parse|import|fetch)/i
        .test(instruction)
    ) {
      throw new Error(`Docker build/network command is forbidden: ${instruction}`);
    }
    if (instruction.startsWith("RUN ") && !allowedRun.some((pattern) => pattern.test(instruction))) {
      throw new Error(`Docker RUN is not dependency installation or TypeScript compilation: ${instruction}`);
    }
  }
}

function logicalDockerInstructions(contents: string): string[] {
  const instructions: string[] = [];
  let current = "";
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    current = `${current} ${line.replace(/\\$/, "")}`.trim();
    if (!line.endsWith("\\")) {
      instructions.push(current.replace(/\s+/g, " "));
      current = "";
    }
  }
  if (current) instructions.push(current.replace(/\s+/g, " "));
  return instructions;
}

function dockerignorePatterns(contents: string): string[] {
  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function isDockerIgnored(path: string, contents: string): boolean {
  let ignored = false;
  for (const rawPattern of dockerignorePatterns(contents)) {
    const negated = rawPattern.startsWith("!");
    const pattern = (negated ? rawPattern.slice(1) : rawPattern).replace(/^\//, "");
    if (matchesDockerignorePattern(path, pattern)) ignored = !negated;
  }
  return ignored;
}

function matchesDockerignorePattern(path: string, pattern: string): boolean {
  const normalized = pattern.replace(/\/$/, "");
  if (!normalized.includes("*") && !normalized.includes("?")) {
    return path === normalized || path.startsWith(`${normalized}/`);
  }
  const expression = normalized
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*")
    .replace(/\?/g, "[^/]");
  return new RegExp(`^${expression}$`).test(path);
}
