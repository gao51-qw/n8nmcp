import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";

type Report = {
  mode: "official" | "fallback";
  ok: boolean;
  templateCount: number;
  ftsCount: number;
};

type Stats = {
  totalNodes: number;
  coreNodes: number;
  communityNodes: number;
  communityPackages: number;
  aiTools: number;
  triggers: number;
  templates: number;
  categories: Record<string, number>;
  generatedAt: string;
};

const temporaryDirectories: string[] = [];
const verifierCompiled = resolve(process.cwd(), "dist/scripts/10-verify-production-artifacts.js");

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("production knowledge artifact verifier", () => {
  it("rejects malformed quality report JSON", () => {
    const testSource = readFileSync(resolve("src/production-artifact-verifier.test.ts"), "utf8");
    const runVerifierSource = testSource.slice(
      testSource.indexOf("\nfunction runVerifier("),
      testSource.indexOf("\nfunction sha256("),
    );
    expect(testSource).toContain(
      'const verifierCompiled = resolve(process.cwd(), "dist/scripts/10-verify-production-artifacts.js")',
    );
    expect(runVerifierSource).toContain("[verifierCompiled]");
    expect(runVerifierSource).not.toContain("node_modules/tsx");

    const artifacts = createArtifacts();
    writeFileSync(artifacts.reportPath, "{", "utf8");

    const result = runVerifier(artifacts);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("Invalid quality report JSON");
  });

  it("rejects fallback reports", () => {
    const artifacts = createArtifacts({ mode: "fallback" });

    const result = runVerifier(artifacts);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("mode must be official");
  });

  it("rejects reports whose quality gate did not pass", () => {
    const artifacts = createArtifacts({ ok: false });

    const result = runVerifier(artifacts);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ok must be true");
  });

  it("rejects report counts that differ from SQLite", () => {
    const artifacts = createArtifacts({ templateCount: 3 });

    const result = runVerifier(artifacts);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("templateCount mismatch");
  });

  it("rejects an expected artifact hash mismatch", () => {
    const artifacts = createArtifacts();

    const result = runVerifier(artifacts, { EXPECTED_NODES_DB_SHA256: "0".repeat(64) });

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("SHA-256 mismatch");
  });

  it("rejects an empty stats object", () => {
    const artifacts = createArtifacts();
    writeFileSync(artifacts.statsPath, "{}\n", "utf8");

    const result = runVerifier(artifacts);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing required field totalNodes");
  });

  it("rejects stats fields with the wrong types", () => {
    const artifacts = createArtifacts();
    writeStats(artifacts.statsPath, { ...validStats(), categories: [] });

    const result = runVerifier(artifacts);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("stats.categories must be an object");
  });

  it("rejects missing required stats fields", () => {
    const artifacts = createArtifacts();
    const { generatedAt: _, ...missingGeneratedAt } = validStats();
    writeStats(artifacts.statsPath, missingGeneratedAt);

    const result = runVerifier(artifacts);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("missing required field generatedAt");
  });

  it("rejects invalid stats timestamps", () => {
    const artifacts = createArtifacts({}, { generatedAt: "not-a-timestamp" });

    const result = runVerifier(artifacts);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("stats.generatedAt must be a valid timestamp");
  });

  it("rejects unknown stats fields", () => {
    const artifacts = createArtifacts();
    writeStats(artifacts.statsPath, { ...validStats(), unexpected: 1 });

    const result = runVerifier(artifacts);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("stats contains unknown field unexpected");
  });

  it("accepts the known optional external-candidate counters", () => {
    const artifacts = createArtifacts();
    writeStats(artifacts.statsPath, {
      ...validStats(),
      externalCandidateNodes: 3,
      externalCommunityCandidates: 2,
      externalVerifiedCommunityCandidates: 1,
      externalToolVariantCandidates: 1,
      verifiedExternalNodes: 2,
      verifiedExternalCommunityNodes: 1,
      verifiedExternalToolVariantNodes: 1,
    });

    const result = runVerifier(artifacts);

    expect(result.status).toBe(0);
  });

  it("rejects stats whose template count is stale", () => {
    const artifacts = createArtifacts({}, { templates: 1 });

    const result = runVerifier(artifacts);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("stats.templates mismatch");
  });

  it("rejects stats whose node count is stale", () => {
    const artifacts = createArtifacts({}, {
      totalNodes: 2,
      coreNodes: 2,
      communityNodes: 0,
      categories: { AI: 1, Core: 1 },
    });

    const result = runVerifier(artifacts);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("stats.totalNodes mismatch");
  });

  it.each([
    {
      field: "coreNodes",
      overrides: { coreNodes: 1, communityNodes: 2 },
    },
    {
      field: "communityNodes",
      overrides: { communityNodes: 0 },
    },
    {
      field: "communityPackages",
      overrides: { communityPackages: 0 },
    },
    {
      field: "aiTools",
      overrides: { aiTools: 0 },
    },
    {
      field: "triggers",
      overrides: { triggers: 0 },
    },
    {
      field: "categories",
      overrides: { categories: { Forged: 3 } },
    },
  ] satisfies Array<{ field: keyof Stats; overrides: Partial<Stats> }>)(
    "rejects stats.$field when it differs from SQLite",
    ({ field, overrides }) => {
      const artifacts = createArtifacts({}, overrides);

      const result = runVerifier(artifacts);

      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain(`stats.${field} mismatch`);
    },
  );

  it("rejects the reviewer reproduction with forged derived stats", () => {
    const artifacts = createArtifacts({}, {
      coreNodes: 0,
      communityNodes: 3,
      communityPackages: 0,
      categories: { Forged: 3 },
    });

    const result = runVerifier(artifacts);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("stats.coreNodes mismatch");
  });

  it("accepts an official report whose counts and expected hashes match", () => {
    const artifacts = createArtifacts();
    const result = runVerifier(artifacts, {
      EXPECTED_NODES_DB_SHA256: sha256(artifacts.dbPath),
      EXPECTED_STATS_SHA256: sha256(artifacts.statsPath),
      EXPECTED_KNOWLEDGE_QUALITY_REPORT_SHA256: sha256(artifacts.reportPath),
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Production knowledge artifacts verified");
  });
});

function createArtifacts(
  reportOverrides: Partial<Report> = {},
  statsOverrides: Partial<Stats> = {},
) {
  const directory = mkdtempSync(join(tmpdir(), "n8n-production-artifacts-"));
  temporaryDirectories.push(directory);
  const dbPath = join(directory, "nodes.db");
  const statsPath = join(directory, "stats.json");
  const reportPath = join(directory, "knowledge-quality-report.json");

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE nodes (
      id INTEGER PRIMARY KEY,
      package_name TEXT NOT NULL,
      category TEXT,
      is_ai_tool INTEGER NOT NULL DEFAULT 0,
      is_trigger INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE templates (id INTEGER PRIMARY KEY);
    CREATE TABLE templates_fts (name TEXT);
    INSERT INTO nodes (id, package_name, category, is_ai_tool, is_trigger) VALUES
      (1, 'n8n-nodes-base', 'Core', 0, 1),
      (2, '@n8n/n8n-nodes-langchain', 'AI', 1, 0),
      (3, 'n8n-nodes-community-demo', 'Trigger', 0, 1);
    INSERT INTO templates (id) VALUES (1), (2);
    INSERT INTO templates_fts (name) VALUES ('one'), ('two');
  `);
  db.close();

  writeStats(statsPath, { ...validStats(), ...statsOverrides });
  writeFileSync(reportPath, `${JSON.stringify({
    mode: "official",
    ok: true,
    templateCount: 2,
    ftsCount: 2,
    ...reportOverrides,
  })}\n`, "utf8");

  return { dbPath, statsPath, reportPath };
}

function validStats(): Stats {
  return {
    totalNodes: 3,
    coreNodes: 2,
    communityNodes: 1,
    communityPackages: 1,
    aiTools: 1,
    triggers: 2,
    templates: 2,
    categories: { AI: 1, Core: 1, Trigger: 1 },
    generatedAt: "2026-07-13T12:00:00.000Z",
  };
}

function writeStats(path: string, stats: unknown): void {
  writeFileSync(path, `${JSON.stringify(stats)}\n`, "utf8");
}

function runVerifier(
  artifacts: ReturnType<typeof createArtifacts>,
  expectedHashes: Record<string, string> = {},
) {
  const result = spawnSync(
    process.execPath,
    [verifierCompiled],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DB_PATH: artifacts.dbPath,
        STATS_PATH: artifacts.statsPath,
        QUALITY_REPORT_PATH: artifacts.reportPath,
        ...expectedHashes,
      },
    },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}
