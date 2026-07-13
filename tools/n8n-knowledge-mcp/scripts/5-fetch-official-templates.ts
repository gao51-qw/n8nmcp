import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createOfficialTemplateClient } from "../src/template-ingestion/official-client.js";
import { mergeTemplateSources } from "../src/template-ingestion/source-merge.js";
import { normalizeAndSanitizeTemplate } from "../src/template-ingestion/template-security.js";
import type {
  NormalizedTemplateEnvelope,
  OfficialFetchManifest,
  OfficialTemplateDetail,
  OfficialTemplateSummary,
} from "../src/template-ingestion/types.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const templatesRoot = fileURLToPath(new URL("../.tmp/templates/", import.meta.url));
const officialDirectory = fileURLToPath(new URL("../.tmp/templates/official/", import.meta.url));
const mergedDirectory = fileURLToPath(new URL("../.tmp/templates/merged/", import.meta.url));
const officialManifestPath = fileURLToPath(
  new URL("../.tmp/templates/official-manifest.json", import.meta.url),
);
const curatedDirectory = fileURLToPath(new URL("../data/curated-templates/", import.meta.url));
const curatedManifestPath = fileURLToPath(
  new URL("../data/curated-templates/manifest.json", import.meta.url),
);
const MAX_TEMPLATES = 5_000;

type CuratedManifest = {
  source: "https://api.n8n.io";
  templateIds: number[];
};

async function main(): Promise<void> {
  await Promise.all([
    rm(officialDirectory, { force: true, recursive: true }),
    rm(mergedDirectory, { force: true, recursive: true }),
  ]);
  await Promise.all([
    mkdir(officialDirectory, { recursive: true }),
    mkdir(mergedDirectory, { recursive: true }),
  ]);

  const client = createOfficialTemplateClient();
  const summaryResult = await client.collectSummaries(MAX_TEMPLATES);
  const detailResult = await client.fetchDetails(summaryResult.summaries);
  const summariesById = new Map(summaryResult.summaries.map((item) => [item.id, item]));
  const accepted: NormalizedTemplateEnvelope[] = [];
  const rejectedIds: number[] = [];

  for (const detail of detailResult.details) {
    try {
      const envelope = normalizeAndSanitizeTemplate(detail, summariesById.get(detail.id));
      accepted.push(envelope);
      await writeJson(`${officialDirectory}/${detail.id}.json`, envelope);
    } catch {
      rejectedIds.push(detail.id);
    }
  }

  accepted.sort((a, b) => a.workflow.id - b.workflow.id);
  rejectedIds.sort((a, b) => a - b);
  const curatedManifest = await readCuratedManifest(curatedManifestPath);
  const curated = await Promise.all(
    curatedManifest.templateIds.map((id) => readAndSanitizeCuratedTemplate(id)),
  );
  const merged = mergeTemplateSources({ official: accepted, curated, limit: MAX_TEMPLATES });

  for (const envelope of merged) {
    await writeJson(`${mergedDirectory}/${envelope.workflow.id}.json`, envelope);
  }

  const manifest: OfficialFetchManifest = {
    source: "https://api.n8n.io",
    totalWorkflows: summaryResult.totalWorkflows,
    target: summaryResult.target,
    summaryCount: summaryResult.summaries.length,
    detailSuccessCount: detailResult.details.length,
    detailFailureCount: detailResult.failedIds.length,
    failedIds: detailResult.failedIds,
    acceptedCount: accepted.length,
    rejectedCount: rejectedIds.length,
    rejectedIds,
    generatedAt: new Date().toISOString(),
  };
  await atomicWriteJson(officialManifestPath, manifest);

  console.log(
    `Staged ${accepted.length} official templates and ${curated.length} curated templates (${merged.length} merged).`,
  );
  console.log(`Manifest: ${officialManifestPath.slice(packageRoot.length + 1)}`);
}

async function readCuratedManifest(path: string): Promise<CuratedManifest> {
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(value) || value.source !== "https://api.n8n.io") {
    throw new Error("Curated manifest has an invalid source");
  }
  if (
    !Array.isArray(value.templateIds) ||
    value.templateIds.some((id) => !Number.isSafeInteger(id) || (id as number) <= 0)
  ) {
    throw new Error("Curated manifest has invalid template IDs");
  }
  const templateIds = value.templateIds as number[];
  if (new Set(templateIds).size !== templateIds.length) {
    throw new Error("Curated manifest contains duplicate template IDs");
  }
  return { source: value.source, templateIds };
}

async function readAndSanitizeCuratedTemplate(id: number): Promise<NormalizedTemplateEnvelope> {
  const path = `${curatedDirectory}/${id}.json`;
  const value: unknown = JSON.parse(await readFile(path, "utf8"));
  if (!isRecord(value) || !isRecord(value.workflow)) {
    throw new Error(`Curated template ${id} is malformed`);
  }
  const stored = value.workflow;
  if (
    stored.id !== id ||
    typeof stored.name !== "string" ||
    typeof stored.description !== "string" ||
    typeof stored.totalViews !== "number" ||
    !Number.isFinite(stored.totalViews) ||
    (stored.createdAt !== null && typeof stored.createdAt !== "string") ||
    (stored.user !== null && !isRecord(stored.user)) ||
    !isRecord(stored.workflow)
  ) {
    throw new Error(`Curated template ${id} metadata is malformed`);
  }

  const user = stored.user as OfficialTemplateSummary["user"];
  const summary: OfficialTemplateSummary = {
    id,
    name: stored.name,
    description: stored.description,
    totalViews: stored.totalViews,
    price: 0,
    purchaseUrl: null,
    user,
    createdAt: stored.createdAt,
    nodes: [],
  };
  const sanitized = normalizeAndSanitizeTemplate(
    stored as unknown as OfficialTemplateDetail,
    summary,
  );
  return { ...sanitized, source: "curated", curated: true };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(templatesRoot, { recursive: true });
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeJson(temporaryPath, value);
  try {
    await rename(temporaryPath, path);
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

await main();
