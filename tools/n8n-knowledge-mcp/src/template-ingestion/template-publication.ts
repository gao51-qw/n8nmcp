import { randomUUID } from "node:crypto";
import {
  mkdir as nodeMkdir,
  readFile as nodeReadFile,
  rename as nodeRename,
  rm as nodeRm,
  writeFile as nodeWriteFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { mergeTemplateSources } from "./source-merge.js";
import { normalizeAndSanitizeTemplate } from "./template-security.js";
import type {
  NormalizedTemplateEnvelope,
  OfficialFetchManifest,
  OfficialTemplateDetail,
  OfficialTemplateSummary,
} from "./types.js";

const OFFICIAL_ORIGIN = "https://api.n8n.io" as const;
const MAX_TEMPLATES = 5_000;

export type TemplatePublicationFileSystem = {
  mkdir(path: string): Promise<void>;
  mkdirExclusive(path: string): Promise<void>;
  readFile(path: string): Promise<string>;
  rename(from: string, to: string): Promise<void>;
  rm(path: string): Promise<void>;
  writeFile(path: string, data: string): Promise<void>;
};

export const defaultTemplatePublicationFileSystem: TemplatePublicationFileSystem = {
  mkdir: async (path) => nodeMkdir(path, { recursive: true }).then(() => undefined),
  mkdirExclusive: async (path) => nodeMkdir(path).then(() => undefined),
  readFile: async (path) => nodeReadFile(path, "utf8"),
  rename: async (from, to) => nodeRename(from, to),
  rm: async (path) => nodeRm(path, { force: true, recursive: true }),
  writeFile: async (path, data) => nodeWriteFile(path, data, "utf8"),
};

export type TemplatePublicationDiagnostic = {
  code: "BACKUP_CLEANUP_FAILED";
  path: string;
  message: string;
  cause: unknown;
};

export type OfficialTemplateClientLike = {
  collectSummaries(limit: number): Promise<{
    totalWorkflows: number;
    target: number;
    summaries: OfficialTemplateSummary[];
  }>;
  fetchDetails(summaries: OfficialTemplateSummary[]): Promise<{
    details: OfficialTemplateDetail[];
    failedIds: number[];
  }>;
};

type PublicationOptions = {
  client: OfficialTemplateClientLike;
  fileSystem?: TemplatePublicationFileSystem;
  onDiagnostic?: (diagnostic: TemplatePublicationDiagnostic) => void;
  runId?: string;
};

export async function stageOfficialTemplates(
  options: PublicationOptions & {
    curatedDirectory: string;
    targetDirectory: string;
    generatedAt?: () => string;
  },
): Promise<OfficialFetchManifest> {
  const fileSystem = options.fileSystem ?? defaultTemplatePublicationFileSystem;
  const paths = publicationPaths(options.targetDirectory, options.runId);
  return withPublicationLock(fileSystem, paths, async () => {
    try {
      await fileSystem.rm(paths.staging);
      await fileSystem.mkdir(join(paths.staging, "official"));
      await fileSystem.mkdir(join(paths.staging, "merged"));
      const summaryResult = await options.client.collectSummaries(MAX_TEMPLATES);
      const detailResult = await options.client.fetchDetails(summaryResult.summaries);
      const summariesById = new Map(summaryResult.summaries.map((item) => [item.id, item]));
      const accepted: NormalizedTemplateEnvelope[] = [];
      const rejectedIds: number[] = [];

      for (const detail of detailResult.details) {
        let envelope: NormalizedTemplateEnvelope;
        try {
          envelope = normalizeAndSanitizeTemplate(detail, summariesById.get(detail.id));
        } catch {
          rejectedIds.push(detail.id);
          continue;
        }
        accepted.push(envelope);
        await writeJson(
          fileSystem,
          join(paths.staging, "official", `${detail.id}.json`),
          envelope,
        );
      }

      accepted.sort((a, b) => a.workflow.id - b.workflow.id);
      rejectedIds.sort((a, b) => a - b);
      const curatedManifest = await readCuratedManifest(
        fileSystem,
        join(options.curatedDirectory, "manifest.json"),
      );
      const curated = await Promise.all(
        curatedManifest.templateIds.map((id) =>
          readAndSanitizeCuratedTemplate(fileSystem, options.curatedDirectory, id),
        ),
      );
      const merged = mergeTemplateSources({
        official: accepted,
        curated,
        limit: MAX_TEMPLATES,
      });

      for (const envelope of merged) {
        await writeJson(
          fileSystem,
          join(paths.staging, "merged", `${envelope.workflow.id}.json`),
          envelope,
        );
      }

      const manifest: OfficialFetchManifest = {
        source: OFFICIAL_ORIGIN,
        totalWorkflows: summaryResult.totalWorkflows,
        target: summaryResult.target,
        summaryCount: summaryResult.summaries.length,
        detailSuccessCount: detailResult.details.length,
        detailFailureCount: detailResult.failedIds.length,
        failedIds: detailResult.failedIds,
        acceptedCount: accepted.length,
        rejectedCount: rejectedIds.length,
        rejectedIds,
        generatedAt: options.generatedAt?.() ?? new Date().toISOString(),
      };
      await atomicWriteJson(fileSystem, join(paths.staging, "official-manifest.json"), manifest);
      await publishPreparedDirectory(fileSystem, paths, options.onDiagnostic);
      return manifest;
    } catch (error) {
      return removeStagingAfterFailure(fileSystem, paths.staging, error);
    }
  });
}

export async function refreshCuratedTemplates(
  options: PublicationOptions & { targetDirectory: string },
): Promise<NormalizedTemplateEnvelope[]> {
  const fileSystem = options.fileSystem ?? defaultTemplatePublicationFileSystem;
  const paths = publicationPaths(options.targetDirectory, options.runId);
  return withPublicationLock(fileSystem, paths, async () => {
    try {
      const manifest = await readCuratedManifest(
        fileSystem,
        join(paths.target, "manifest.json"),
      );
      const summaries = manifest.templateIds.map(summaryForId);
      const result = await options.client.fetchDetails(summaries);
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

      await fileSystem.rm(paths.staging);
      await fileSystem.mkdir(paths.staging);
      await atomicWriteJson(fileSystem, join(paths.staging, "manifest.json"), manifest);
      for (const snapshot of snapshots) {
        await atomicWriteJson(
          fileSystem,
          join(paths.staging, `${snapshot.workflow.id}.json`),
          snapshot,
        );
      }
      await publishPreparedDirectory(fileSystem, paths, options.onDiagnostic);
      return snapshots;
    } catch (error) {
      return removeStagingAfterFailure(fileSystem, paths.staging, error);
    }
  });
}

type CuratedManifest = {
  source: typeof OFFICIAL_ORIGIN;
  templateIds: number[];
};

type DirectoryPublicationPaths = {
  target: string;
  staging: string;
  backup: string;
  lock: string;
};

function publicationPaths(target: string, requestedRunId?: string): DirectoryPublicationPaths {
  const runId = requestedRunId ?? randomUUID();
  if (!/^[A-Za-z0-9_-]+$/.test(runId)) {
    throw new Error("Publication run ID contains unsafe characters");
  }
  const resolvedTarget = resolve(target);
  return {
    target: resolvedTarget,
    staging: `${resolvedTarget}.staging-${runId}`,
    backup: `${resolvedTarget}.backup-${runId}`,
    lock: `${resolvedTarget}.lock`,
  };
}

async function withPublicationLock<T>(
  fileSystem: TemplatePublicationFileSystem,
  paths: DirectoryPublicationPaths,
  operation: () => Promise<T>,
): Promise<T> {
  await fileSystem.mkdir(dirname(paths.lock));
  try {
    await fileSystem.mkdirExclusive(paths.lock);
  } catch (error) {
    if (isAlreadyExistsError(error)) {
      throw new Error(`Template publication lock is already held for ${paths.target}`, {
        cause: error,
      });
    }
    throw error;
  }

  let operationFailed = false;
  let operationError: unknown;
  try {
    return await operation();
  } catch (error) {
    operationFailed = true;
    operationError = error;
    throw error;
  } finally {
    try {
      await fileSystem.rm(paths.lock);
    } catch (releaseError) {
      if (operationFailed) {
        throw new AggregateError(
          [operationError, releaseError],
          `Template publication failed and lock release also failed for ${paths.target}`,
        );
      }
      throw new Error(`Template publication lock release failed for ${paths.target}`, {
        cause: releaseError,
      });
    }
  }
}

async function removeStagingAfterFailure(
  fileSystem: TemplatePublicationFileSystem,
  stagingPath: string,
  operationError: unknown,
): Promise<never> {
  try {
    await fileSystem.rm(stagingPath);
  } catch (cleanupError) {
    throw new AggregateError(
      [operationError, cleanupError],
      `Template staging cleanup failed for ${stagingPath}`,
    );
  }
  throw operationError;
}

async function publishPreparedDirectory(
  fileSystem: TemplatePublicationFileSystem,
  paths: DirectoryPublicationPaths,
  onDiagnostic?: (diagnostic: TemplatePublicationDiagnostic) => void,
): Promise<void> {
  let previousTargetMoved = false;
  try {
    await fileSystem.rename(paths.target, paths.backup);
    previousTargetMoved = true;
  } catch (error) {
    if (!isMissingPathError(error)) throw error;
  }

  try {
    await fileSystem.rename(paths.staging, paths.target);
  } catch (publicationError) {
    if (previousTargetMoved) {
      try {
        await fileSystem.rm(paths.target);
        await fileSystem.rename(paths.backup, paths.target);
      } catch (rollbackError) {
        throw new AggregateError(
          [publicationError, rollbackError],
          `Template publication failed and rollback could not restore ${paths.target}`,
        );
      }
    }
    throw publicationError;
  }

  if (previousTargetMoved) {
    try {
      await fileSystem.rm(paths.backup);
    } catch (cause) {
      reportDiagnostic(onDiagnostic, {
        code: "BACKUP_CLEANUP_FAILED",
        path: paths.backup,
        message: `Published templates successfully but could not remove backup ${paths.backup}`,
        cause,
      });
    }
  }
}

function reportDiagnostic(
  handler: ((diagnostic: TemplatePublicationDiagnostic) => void) | undefined,
  diagnostic: TemplatePublicationDiagnostic,
): void {
  if (handler) {
    try {
      handler(diagnostic);
      return;
    } catch {
      console.warn(`[template-publication] Diagnostic handler failed: ${diagnostic.message}`);
      return;
    }
  }
  console.warn(`[template-publication] ${diagnostic.message}`);
}

async function readCuratedManifest(
  fileSystem: TemplatePublicationFileSystem,
  path: string,
): Promise<CuratedManifest> {
  const value: unknown = JSON.parse(await fileSystem.readFile(path));
  if (!isRecord(value) || value.source !== OFFICIAL_ORIGIN) {
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

async function readAndSanitizeCuratedTemplate(
  fileSystem: TemplatePublicationFileSystem,
  directory: string,
  id: number,
): Promise<NormalizedTemplateEnvelope> {
  const value: unknown = JSON.parse(await fileSystem.readFile(join(directory, `${id}.json`)));
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

  const summary: OfficialTemplateSummary = {
    id,
    name: stored.name,
    description: stored.description,
    totalViews: stored.totalViews,
    price: 0,
    purchaseUrl: null,
    user: stored.user as OfficialTemplateSummary["user"],
    createdAt: stored.createdAt,
    nodes: [],
  };
  const sanitized = normalizeAndSanitizeTemplate(
    stored as unknown as OfficialTemplateDetail,
    summary,
  );
  return { ...sanitized, source: "curated", curated: true };
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

async function atomicWriteJson(
  fileSystem: TemplatePublicationFileSystem,
  path: string,
  value: unknown,
): Promise<void> {
  const temporaryPath = `${path}.${process.pid}.tmp`;
  await fileSystem.writeFile(temporaryPath, serializeJson(value));
  try {
    await fileSystem.rename(temporaryPath, path);
  } catch (error) {
    await fileSystem.rm(temporaryPath).catch(() => undefined);
    throw error;
  }
}

async function writeJson(
  fileSystem: TemplatePublicationFileSystem,
  path: string,
  value: unknown,
): Promise<void> {
  await fileSystem.writeFile(path, serializeJson(value));
}

function serializeJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isMissingPathError(error: unknown): boolean {
  return isRecord(error) && error.code === "ENOENT";
}

function isAlreadyExistsError(error: unknown): boolean {
  return isRecord(error) && error.code === "EEXIST";
}
