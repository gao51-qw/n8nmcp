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
  nodeCount: number;
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
  const stats = readStats(paths.statsPath);
  const db = new Database(paths.dbPath, { readonly: true, fileMustExist: true });
  let nodeCount: number;
  let templateCount: number;
  let ftsCount: number;
  try {
    nodeCount = databaseCount(db, "nodes");
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
  if (stats.templates !== templateCount) {
    throw new Error(`stats.templates mismatch: stats=${stats.templates}, sqlite=${templateCount}`);
  }
  if (stats.totalNodes !== nodeCount) {
    throw new Error(`stats.totalNodes mismatch: stats=${stats.totalNodes}, sqlite=${nodeCount}`);
  }

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

  return { nodeCount, templateCount, ftsCount, hashes };
}

type ProductionStats = {
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

const requiredStatsCountFields = [
  "totalNodes",
  "coreNodes",
  "communityNodes",
  "communityPackages",
  "aiTools",
  "triggers",
  "templates",
] as const;

const optionalStatsCountFields = [
  "externalCandidateNodes",
  "externalCommunityCandidates",
  "externalVerifiedCommunityCandidates",
  "externalToolVariantCandidates",
  "verifiedExternalNodes",
  "verifiedExternalCommunityNodes",
  "verifiedExternalToolVariantNodes",
] as const;

function readStats(path: string): ProductionStats {
  const stats = readJsonFile(path, "stats");
  const knownFields = new Set<string>([
    ...requiredStatsCountFields,
    ...optionalStatsCountFields,
    "categories",
    "generatedAt",
  ]);
  for (const field of Object.keys(stats)) {
    if (!knownFields.has(field)) throw new Error(`stats contains unknown field ${field}`);
  }
  for (const field of [...requiredStatsCountFields, "categories", "generatedAt"] as const) {
    if (!Object.hasOwn(stats, field)) throw new Error(`stats missing required field ${field}`);
  }
  for (const field of requiredStatsCountFields) {
    nonnegativeSafeInteger(stats[field], `stats.${field}`);
  }
  for (const field of optionalStatsCountFields) {
    if (Object.hasOwn(stats, field)) nonnegativeSafeInteger(stats[field], `stats.${field}`);
  }

  if (typeof stats.categories !== "object" || stats.categories === null || Array.isArray(stats.categories)) {
    throw new Error("stats.categories must be an object");
  }
  const categories: Record<string, number> = {};
  for (const [category, count] of Object.entries(stats.categories)) {
    if (category.trim().length === 0) throw new Error("stats.categories keys must be non-empty");
    categories[category] = nonnegativeSafeInteger(count, `stats.categories.${category}`);
  }

  if (typeof stats.generatedAt !== "string" || !Number.isFinite(Date.parse(stats.generatedAt))) {
    throw new Error("stats.generatedAt must be a valid timestamp");
  }

  const totalNodes = Number(stats.totalNodes);
  const coreNodes = Number(stats.coreNodes);
  const communityNodes = Number(stats.communityNodes);
  if (coreNodes + communityNodes !== totalNodes) {
    throw new Error(
      `stats core/community count mismatch: core=${coreNodes}, community=${communityNodes}, total=${totalNodes}`,
    );
  }
  const categoryTotal = Object.values(categories).reduce((sum, count) => sum + count, 0);
  if (categoryTotal !== totalNodes) {
    throw new Error(`stats.categories count mismatch: categories=${categoryTotal}, totalNodes=${totalNodes}`);
  }
  if (Number(stats.aiTools) > totalNodes || Number(stats.triggers) > totalNodes) {
    throw new Error("stats aiTools/triggers counts must not exceed totalNodes");
  }

  return {
    totalNodes,
    coreNodes,
    communityNodes,
    communityPackages: Number(stats.communityPackages),
    aiTools: Number(stats.aiTools),
    triggers: Number(stats.triggers),
    templates: Number(stats.templates),
    categories,
    generatedAt: stats.generatedAt,
  };
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

function nonnegativeSafeInteger(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error(`${field} must be a nonnegative safe integer`);
  }
  return Number(value);
}

function databaseCount(db: Database.Database, table: "nodes" | "templates" | "templates_fts"): number {
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
