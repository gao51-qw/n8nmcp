import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultTemplatePublicationFileSystem,
  refreshCuratedTemplates,
  stageOfficialTemplates,
  type TemplatePublicationFileSystem,
} from "./template-publication.js";
import type {
  NormalizedTemplateEnvelope,
  OfficialTemplateDetail,
  OfficialTemplateSummary,
} from "./types.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) => rm(path, { force: true, recursive: true })),
  );
});

describe("official template staging publication", () => {
  it("keeps the previous manifest and files when staging fails after a partial write", async () => {
    const root = await temporaryRoot();
    const targetDirectory = join(root, "templates");
    const curatedDirectory = join(root, "curated");
    await mkdir(join(targetDirectory, "official"), { recursive: true });
    await mkdir(join(targetDirectory, "merged"), { recursive: true });
    await writeJson(join(targetDirectory, "official", "99.json"), { id: 99 });
    await writeJson(join(targetDirectory, "merged", "99.json"), { id: 99 });
    const previousManifest = { acceptedCount: 1, acceptedIds: [99] };
    await writeJson(join(targetDirectory, "official-manifest.json"), previousManifest);
    await writeCuratedSet(curatedDirectory, [5]);

    const client = frozenClient([1, 2]);
    const fileSystem: TemplatePublicationFileSystem = {
      ...defaultTemplatePublicationFileSystem,
      writeFile: async (path, data) => {
        if (path.includes(`${sep}official${sep}2.json`)) {
          throw new Error("injected partial staging failure");
        }
        await defaultTemplatePublicationFileSystem.writeFile(path, data);
      },
    };

    await expect(
      stageOfficialTemplates({
        client,
        curatedDirectory,
        targetDirectory,
        runId: "fetch-failure",
        generatedAt: () => "2026-07-13T00:00:00.000Z",
        fileSystem,
      }),
    ).rejects.toThrow(/injected partial staging failure/i);

    expect(await readJson(join(targetDirectory, "official-manifest.json"))).toEqual(
      previousManifest,
    );
    expect(await readdir(join(targetDirectory, "official"))).toEqual(["99.json"]);
    expect(await readdir(join(targetDirectory, "merged"))).toEqual(["99.json"]);
    expect((await readdir(root)).filter((name) => name.startsWith("templates."))).toEqual([]);
  });
});

describe("curated template publication", () => {
  it("publishes exactly the changed manifest IDs and removes stale snapshots", async () => {
    const root = await temporaryRoot();
    const targetDirectory = join(root, "curated");
    await writeCuratedSet(targetDirectory, [1, 3]);
    await writeJson(join(targetDirectory, "2.json"), templateEnvelope(2, "curated"));
    await writeJson(join(targetDirectory, "99.json"), templateEnvelope(99, "curated"));

    await refreshCuratedTemplates({
      client: frozenClient([1, 3]),
      targetDirectory: `${targetDirectory}${sep}`,
      runId: "changed-manifest",
    });

    expect((await readdir(targetDirectory)).sort()).toEqual(["1.json", "3.json", "manifest.json"]);
    expect((await readJson(join(targetDirectory, "1.json")) as { workflow: { id: number } }).workflow.id).toBe(1);
    expect((await readJson(join(targetDirectory, "3.json")) as { workflow: { id: number } }).workflow.id).toBe(3);
  });

  it("rolls back the complete previous curated set when publication fails mid-swap", async () => {
    const root = await temporaryRoot();
    const targetDirectory = join(root, "curated");
    await writeCuratedSet(targetDirectory, [1, 2]);
    const previousManifest = await readFile(join(targetDirectory, "manifest.json"), "utf8");
    const previousOne = await readFile(join(targetDirectory, "1.json"), "utf8");
    const previousTwo = await readFile(join(targetDirectory, "2.json"), "utf8");
    const stagedDirectory = `${targetDirectory}.staging-curated-rollback`;
    const fileSystem: TemplatePublicationFileSystem = {
      ...defaultTemplatePublicationFileSystem,
      rename: async (from, to) => {
        if (from === stagedDirectory && to === targetDirectory) {
          throw new Error("injected curated publication failure");
        }
        await defaultTemplatePublicationFileSystem.rename(from, to);
      },
    };

    await expect(
      refreshCuratedTemplates({
        client: frozenClient([1, 2]),
        targetDirectory,
        runId: "curated-rollback",
        fileSystem,
      }),
    ).rejects.toThrow(/injected curated publication failure/i);

    expect(await readdir(targetDirectory)).toEqual(["1.json", "2.json", "manifest.json"]);
    expect(await readFile(join(targetDirectory, "manifest.json"), "utf8")).toBe(previousManifest);
    expect(await readFile(join(targetDirectory, "1.json"), "utf8")).toBe(previousOne);
    expect(await readFile(join(targetDirectory, "2.json"), "utf8")).toBe(previousTwo);
    expect((await readdir(root)).filter((name) => name.startsWith("curated."))).toEqual([]);
  });
});

async function temporaryRoot(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), "n8n-template-publication-"));
  temporaryRoots.push(path);
  return path;
}

async function writeCuratedSet(directory: string, ids: number[]): Promise<void> {
  await mkdir(directory, { recursive: true });
  await writeJson(join(directory, "manifest.json"), {
    source: "https://api.n8n.io",
    templateIds: ids,
  });
  await Promise.all(
    ids.map((id) => writeJson(join(directory, `${id}.json`), templateEnvelope(id, "curated"))),
  );
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}

function frozenClient(ids: number[]) {
  const summaries = ids.map(summary);
  return {
    collectSummaries: async () => ({
      totalWorkflows: summaries.length,
      target: summaries.length,
      summaries,
    }),
    fetchDetails: async (requested: OfficialTemplateSummary[]) => ({
      details: requested.map((item) => detail(item.id)),
      failedIds: [],
    }),
  };
}

function summary(id: number): OfficialTemplateSummary {
  return {
    id,
    name: `Template ${id}`,
    description: "Frozen fixture",
    totalViews: 100 - id,
    price: 0,
    purchaseUrl: null,
    user: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    nodes: [],
  };
}

function detail(id: number): OfficialTemplateDetail {
  return {
    id,
    name: `Template ${id}`,
    description: "Frozen fixture",
    totalViews: 100 - id,
    user: null,
    workflow: normalizedWorkflow(id),
  };
}

function templateEnvelope(
  id: number,
  source: "official" | "curated",
): NormalizedTemplateEnvelope {
  return {
    source,
    curated: source === "curated",
    views: 100 - id,
    sourceUrl: `https://n8n.io/workflows/${id}`,
    workflow: {
      id,
      name: `Template ${id}`,
      description: "Frozen fixture",
      totalViews: 100 - id,
      createdAt: "2026-07-01T00:00:00.000Z",
      user: null,
      workflow: normalizedWorkflow(id),
    },
  };
}

function normalizedWorkflow(
  id: number,
): NormalizedTemplateEnvelope["workflow"]["workflow"] {
  return {
    nodes: [
      {
        id: `node-${id}`,
        name: `Start ${id}`,
        type: "n8n-nodes-base.manualTrigger",
        parameters: {},
        position: [0, 0],
      },
    ],
    connections: {},
  };
}
