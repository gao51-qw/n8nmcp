import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createOfficialTemplateClient } from "../src/template-ingestion/official-client.js";
import { normalizeAndSanitizeTemplate } from "../src/template-ingestion/template-security.js";
import type {
  NormalizedTemplateEnvelope,
  OfficialTemplateSummary,
} from "../src/template-ingestion/types.js";

const curatedDirectory = fileURLToPath(new URL("../data/curated-templates/", import.meta.url));
const manifestPath = fileURLToPath(
  new URL("../data/curated-templates/manifest.json", import.meta.url),
);

type CuratedManifest = {
  source: "https://api.n8n.io";
  templateIds: number[];
};

async function main(): Promise<void> {
  const manifest = await readManifest();
  const summaries = manifest.templateIds.map(summaryForId);
  const result = await createOfficialTemplateClient().fetchDetails(summaries);
  if (result.failedIds.length > 0 || result.details.length !== manifest.templateIds.length) {
    throw new Error(`Unable to refresh curated template IDs: ${result.failedIds.join(", ")}`);
  }

  const summariesById = new Map(summaries.map((summary) => [summary.id, summary]));
  const byId = new Map(result.details.map((detail) => [detail.id, detail]));
  const snapshots: NormalizedTemplateEnvelope[] = manifest.templateIds.map((id) => {
    const detail = byId.get(id);
    if (!detail) throw new Error(`Official response omitted curated template ${id}`);
    const sanitized = normalizeAndSanitizeTemplate(detail, summariesById.get(id));
    return { ...sanitized, source: "curated", curated: true };
  });

  await mkdir(curatedDirectory, { recursive: true });
  await Promise.all(
    snapshots.map((snapshot) =>
      atomicWriteJson(`${curatedDirectory}/${snapshot.workflow.id}.json`, snapshot),
    ),
  );
  console.log(`Refreshed ${snapshots.length} curated template snapshots.`);
}

async function readManifest(): Promise<CuratedManifest> {
  const value: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
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

function summaryForId(id: number): OfficialTemplateSummary {
  return {
    id,
    name: `Template ${id}`,
    description: null,
    totalViews: 0,
    price: 0,
    purchaseUrl: null,
    user: null,
    createdAt: null,
    nodes: [],
  };
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
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
