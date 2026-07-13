import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

export type ProductionArtifactPaths = {
  dbPath: string;
  statsPath: string;
  reportPath: string;
};

export type ExpectedArtifactHashes = {
  nodesDb?: string;
  stats?: string;
  qualityReport?: string;
};

export type ProductionArtifactVerification = {
  templateCount: number;
  ftsCount: number;
  hashes: Required<ExpectedArtifactHashes>;
};

export function verifyProductionArtifacts(
  paths: ProductionArtifactPaths,
  expectedHashes: ExpectedArtifactHashes = {},
): ProductionArtifactVerification {
  const report = readQualityReport(paths.reportPath);
  if (report.mode !== "official") {
    throw new Error(`Quality report mode must be official; received ${String(report.mode)}`);
  }
  if (report.ok !== true) {
    throw new Error(`Quality report ok must be true; received ${String(report.ok)}`);
  }

  const reportedTemplateCount = positiveSafeInteger(report.templateCount, "templateCount");
  const reportedFtsCount = positiveSafeInteger(report.ftsCount, "ftsCount");
  const db = new Database(paths.dbPath, { readonly: true, fileMustExist: true });
  let templateCount: number;
  let ftsCount: number;
  try {
    templateCount = databaseCount(db, "templates");
    ftsCount = databaseCount(db, "templates_fts");
  } finally {
    db.close();
  }

  if (reportedTemplateCount !== templateCount) {
    throw new Error(
      `Quality report templateCount mismatch: report=${reportedTemplateCount}, sqlite=${templateCount}`,
    );
  }
  if (reportedFtsCount !== ftsCount) {
    throw new Error(`Quality report ftsCount mismatch: report=${reportedFtsCount}, sqlite=${ftsCount}`);
  }
  if (templateCount !== ftsCount) {
    throw new Error(`SQLite template/FTS count mismatch: templates=${templateCount}, templates_fts=${ftsCount}`);
  }

  readJsonFile(paths.statsPath, "stats");
  const hashes = {
    nodesDb: sha256(paths.dbPath),
    stats: sha256(paths.statsPath),
    qualityReport: sha256(paths.reportPath),
  };
  assertExpectedHash("nodes.db", hashes.nodesDb, expectedHashes.nodesDb);
  assertExpectedHash("stats.json", hashes.stats, expectedHashes.stats);
  assertExpectedHash(
    "knowledge-quality-report.json",
    hashes.qualityReport,
    expectedHashes.qualityReport,
  );

  return { templateCount, ftsCount, hashes };
}

function readQualityReport(path: string): Record<string, unknown> {
  return readJsonFile(path, "quality report");
}

function readJsonFile(path: string, label: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid ${label} JSON at ${path}: ${(error as Error).message}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid ${label} JSON at ${path}: expected an object`);
  }
  return value as Record<string, unknown>;
}

function positiveSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) {
    throw new Error(`Quality report ${field} must be a positive safe integer`);
  }
  return Number(value);
}

function databaseCount(db: Database.Database, table: "templates" | "templates_fts"): number {
  const value = Number((db.prepare(`SELECT COUNT(*) count FROM ${table}`).get() as { count: number }).count);
  return positiveSafeInteger(value, `SQLite ${table} count`);
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function assertExpectedHash(label: string, actual: string, expected: string | undefined): void {
  if (expected === undefined || expected.trim() === "") return;
  const normalized = expected.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    throw new Error(`Expected SHA-256 for ${label} must be 64 hexadecimal characters`);
  }
  if (actual !== normalized) {
    throw new Error(`SHA-256 mismatch for ${label}: expected=${normalized}, actual=${actual}`);
  }
}
