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

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("production knowledge artifact verifier", () => {
  it("rejects malformed quality report JSON", () => {
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

function createArtifacts(overrides: Partial<Report> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "n8n-production-artifacts-"));
  temporaryDirectories.push(directory);
  const dbPath = join(directory, "nodes.db");
  const statsPath = join(directory, "stats.json");
  const reportPath = join(directory, "knowledge-quality-report.json");

  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE templates (id INTEGER PRIMARY KEY);
    CREATE TABLE templates_fts (name TEXT);
    INSERT INTO templates (id) VALUES (1), (2);
    INSERT INTO templates_fts (name) VALUES ('one'), ('two');
  `);
  db.close();

  writeFileSync(statsPath, `${JSON.stringify({ totalNodes: 2 })}\n`, "utf8");
  writeFileSync(reportPath, `${JSON.stringify({
    mode: "official",
    ok: true,
    templateCount: 2,
    ftsCount: 2,
    ...overrides,
  })}\n`, "utf8");

  return { dbPath, statsPath, reportPath };
}

function runVerifier(
  artifacts: ReturnType<typeof createArtifacts>,
  expectedHashes: Record<string, string> = {},
) {
  const result = spawnSync(
    process.execPath,
    [
      resolve("node_modules/tsx/dist/cli.mjs"),
      resolve("scripts/10-verify-production-artifacts.ts"),
    ],
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
