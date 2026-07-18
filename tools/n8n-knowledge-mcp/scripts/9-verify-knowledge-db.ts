import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  KnowledgeQualityError,
  verifyKnowledgeDb,
  type KnowledgeQualityReport,
} from "../src/template-ingestion/quality-gate.js";
import type { OfficialFetchManifest } from "../src/template-ingestion/types.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const dbPath = resolve(process.env.DB_PATH ?? join(packageRoot, "data/nodes.db"));
const officialManifestPath = join(packageRoot, ".tmp/templates/official-manifest.json");
const curatedManifestPath = join(packageRoot, "data/curated-templates/manifest.json");
const reportPath = join(packageRoot, "data/knowledge-quality-report.json");

async function main(): Promise<void> {
  const mode = parseMode(process.argv.slice(2));
  const curatedManifest = await readJson(curatedManifestPath) as { templateIds?: unknown };
  if (!Array.isArray(curatedManifest.templateIds)
    || curatedManifest.templateIds.some((id) => !Number.isSafeInteger(id) || Number(id) <= 0)) {
    throw new Error(`Invalid curated template manifest: ${curatedManifestPath}`);
  }
  const curatedIds = curatedManifest.templateIds as number[];

  let report: KnowledgeQualityReport;
  try {
    if (mode === "official") {
      const manifest = await readJson(officialManifestPath) as OfficialFetchManifest;
      report = verifyKnowledgeDb({ dbPath, manifest, curatedIds, mode });
    } else {
      report = verifyKnowledgeDb({ dbPath, curatedIds, mode });
    }
  } catch (error) {
    if (!(error instanceof KnowledgeQualityError)) throw error;
    report = error.report;
  }

  await atomicWriteJson(reportPath, report);
  console.log(
    `[knowledge-quality] mode=${report.mode} ok=${report.ok} templates=${report.templateCount} fts=${report.ftsCount} curated=${report.curatedPresent}/${report.curatedRequired} errors=${report.errors.length}`,
  );
  if (!report.ok) process.exitCode = 1;
}

function parseMode(args: string[]): "official" | "fallback" {
  if (args.length !== 1 || !/^--mode=(official|fallback)$/.test(args[0] ?? "")) {
    throw new Error("Usage: npm run verify:knowledge-db -- --mode=official|fallback");
  }
  return args[0]!.slice("--mode=".length) as "official" | "fallback";
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temporaryPath, path);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
