import Database from "better-sqlite3";
import { z } from "zod";
import {
  assertTemplateContainsNoSecrets,
  PROHIBITED_TEMPLATE_NODE_TYPES,
} from "./template-security.js";
import type { OfficialFetchManifest } from "./types.js";

export type KnowledgeQualityReport = {
  mode: "official" | "fallback";
  ok: boolean;
  sourceTotal: number;
  sourceTarget: number;
  acceptedOfficial: number;
  rejectedOfficial: number;
  templateCount: number;
  ftsCount: number;
  curatedRequired: number;
  curatedPresent: number;
  errors: string[];
  generatedAt: string;
};

export type VerifyKnowledgeDbInput =
  | {
      dbPath: string;
      manifest: OfficialFetchManifest;
      curatedIds: number[];
      mode: "official";
    }
  | {
      dbPath: string;
      manifest?: OfficialFetchManifest;
      curatedIds: number[];
      mode: "fallback";
    };

export class KnowledgeQualityError extends Error {
  constructor(public readonly report: KnowledgeQualityReport) {
    super(`Knowledge database quality gate failed:\n- ${report.errors.join("\n- ")}`);
    this.name = "KnowledgeQualityError";
  }
}

export function verifyKnowledgeDb(input: VerifyKnowledgeDbInput): KnowledgeQualityReport {
  const errors: string[] = [];
  const manifest = input.mode === "official" ? parseOfficialManifest(input.manifest) : undefined;
  const sourceTarget = manifest ? Math.min(manifest.totalWorkflows, 5_000) : 0;
  const duplicateCuratedIds = duplicates(input.curatedIds);
  if (duplicateCuratedIds.length > 0) {
    errors.push(`Curated manifest contains duplicate template IDs: ${duplicateCuratedIds.join(", ")}`);
  }

  const db = new Database(input.dbPath, { readonly: true, fileMustExist: true });
  let templateCount = 0;
  let ftsCount = 0;
  let curatedPresent = 0;
  try {
    templateCount = count(db, "SELECT COUNT(*) count FROM templates");
    ftsCount = count(db, "SELECT COUNT(*) count FROM templates_fts");
    if (templateCount === 0) errors.push("Template database is empty");
    if (templateCount > 5_000) {
      errors.push(`Template database exceeds the 5,000 row limit: ${templateCount}`);
    }
    if (templateCount !== ftsCount) {
      errors.push(`FTS row count mismatch: templates=${templateCount}, templates_fts=${ftsCount}`);
    }

    const templateIds = new Set(
      (db.prepare("SELECT id FROM templates").all() as Array<{ id: number }>).map((row) => row.id),
    );
    const ftsIds = new Set(
      (db.prepare("SELECT rowid id FROM templates_fts").all() as Array<{ id: number }>).map((row) => row.id),
    );
    const missingFtsIds = [...templateIds].filter((id) => !ftsIds.has(id));
    const orphanFtsIds = [...ftsIds].filter((id) => !templateIds.has(id));
    if (missingFtsIds.length > 0 || orphanFtsIds.length > 0) {
      errors.push(
        `FTS ID mismatch: missing=${missingFtsIds.join(",") || "none"}; orphan=${orphanFtsIds.join(",") || "none"}`,
      );
    }

    const duplicateDatabaseIds = db
      .prepare("SELECT id FROM templates GROUP BY id HAVING COUNT(*) > 1 ORDER BY id")
      .all() as Array<{ id: number }>;
    if (duplicateDatabaseIds.length > 0) {
      errors.push(`Template database contains duplicate IDs: ${duplicateDatabaseIds.map((row) => row.id).join(", ")}`);
    }

    const presentIds = templateIds;
    const uniqueCuratedIds = [...new Set(input.curatedIds)];
    curatedPresent = uniqueCuratedIds.filter((id) => presentIds.has(id)).length;
    const missingCuratedIds = uniqueCuratedIds.filter((id) => !presentIds.has(id));
    if (missingCuratedIds.length > 0) {
      errors.push(`Required curated template IDs are missing: ${missingCuratedIds.join(", ")}`);
    }

    const workflows = db
      .prepare("SELECT id, workflow_json FROM templates ORDER BY id")
      .all() as Array<{ id: number; workflow_json: string | null }>;
    for (const row of workflows) validateStoredWorkflow(row.id, row.workflow_json, errors);
  } finally {
    db.close();
  }

  if (manifest) {
    const minimumAccepted = Math.ceil(sourceTarget * 0.95);
    if (manifest.acceptedCount < minimumAccepted) {
      errors.push(
        `Official acceptance is below 95%: accepted=${manifest.acceptedCount}, required=${minimumAccepted}`,
      );
    }
    if (templateCount < minimumAccepted) {
      errors.push(
        `Official database is below 95% completeness: templates=${templateCount}, required=${minimumAccepted}`,
      );
    }
  }

  const report: KnowledgeQualityReport = {
    mode: input.mode,
    ok: errors.length === 0,
    sourceTotal: manifest?.totalWorkflows ?? 0,
    sourceTarget,
    acceptedOfficial: manifest?.acceptedCount ?? 0,
    rejectedOfficial: manifest?.rejectedCount ?? 0,
    templateCount,
    ftsCount,
    curatedRequired: new Set(input.curatedIds).size,
    curatedPresent,
    errors,
    generatedAt: new Date().toISOString(),
  };

  if (input.mode === "official" && !report.ok) throw new KnowledgeQualityError(report);
  return report;
}

function validateStoredWorkflow(id: number, serialized: string | null, errors: string[]): void {
  let workflow: unknown;
  try {
    workflow = serialized === null ? null : JSON.parse(serialized);
  } catch {
    errors.push(`Template ${id} has invalid workflow JSON`);
    return;
  }
  if (!isRecord(workflow) || !Array.isArray(workflow.nodes) || !isRecord(workflow.connections)) {
    errors.push(`Template ${id} has an empty or malformed workflow`);
    return;
  }
  if (workflow.nodes.length === 0) {
    errors.push(`Template ${id} has an empty workflow with no retained nodes`);
    return;
  }

  try {
    assertTemplateContainsNoSecrets(workflow);
  } catch (error) {
    errors.push(`Template ${id} contains secret or sensitive data: ${(error as Error).message}`);
  }

  const nodeNames = new Set<string>();
  for (const node of workflow.nodes) {
    if (!isRecord(node)
      || typeof node.name !== "string"
      || node.name.trim().length === 0
      || typeof node.type !== "string"
      || node.type.trim().length === 0) {
      errors.push(`Template ${id} contains a malformed node`);
      continue;
    }
    if (nodeNames.has(node.name)) errors.push(`Template ${id} contains duplicate node name ${node.name}`);
    nodeNames.add(node.name);
    if (PROHIBITED_TEMPLATE_NODE_TYPES.has(node.type)) {
      errors.push(`Template ${id} contains prohibited node type ${node.type}`);
    }
  }

  for (const [source, outputTypes] of Object.entries(workflow.connections)) {
    if (!nodeNames.has(source)) errors.push(`Template ${id} connection source is stale: ${source}`);
    if (!isRecord(outputTypes)) {
      errors.push(`Template ${id} has malformed connections for ${source}`);
      continue;
    }
    for (const branches of Object.values(outputTypes)) {
      if (!Array.isArray(branches)) {
        errors.push(`Template ${id} has malformed connection branches for ${source}`);
        continue;
      }
      for (const branch of branches) {
        if (!Array.isArray(branch)) {
          errors.push(`Template ${id} has malformed connection branch for ${source}`);
          continue;
        }
        for (const target of branch) {
          if (!isRecord(target)
            || typeof target.node !== "string"
            || target.node.trim().length === 0) {
            errors.push(`Template ${id} has a malformed connection target for ${source}`);
            continue;
          }
          if (typeof target.type !== "string"
            || target.type.trim().length === 0
            || typeof target.index !== "number"
            || !Number.isInteger(target.index)
            || target.index < 0) {
            errors.push(`Template ${id} has a malformed connection target for ${source}`);
          }
          if (!nodeNames.has(target.node)) {
            errors.push(`Template ${id} connection target is stale: ${target.node}`);
          }
        }
      }
    }
  }
}

function count(db: Database.Database, sql: string): number {
  return Number((db.prepare(sql).get() as { count: number }).count);
}

function duplicates(values: number[]): number[] {
  const seen = new Set<number>();
  const duplicateValues = new Set<number>();
  for (const value of values) {
    if (seen.has(value)) duplicateValues.add(value);
    seen.add(value);
  }
  return [...duplicateValues].sort((a, b) => a - b);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const manifestCount = z.number().int().nonnegative().finite();
const manifestIds = z.array(z.number().int().positive()).superRefine((ids, context) => {
  if (new Set(ids).size !== ids.length) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "IDs must be unique" });
  }
});
const officialManifestSchema = z.object({
  source: z.literal("https://api.n8n.io"),
  totalWorkflows: manifestCount,
  target: manifestCount,
  summaryCount: manifestCount,
  detailSuccessCount: manifestCount,
  detailFailureCount: manifestCount,
  failedIds: manifestIds,
  acceptedCount: manifestCount,
  rejectedCount: manifestCount,
  rejectedIds: manifestIds,
  generatedAt: z.string().datetime(),
}).strict().superRefine((manifest, context) => {
  const derivedTarget = Math.min(manifest.totalWorkflows, 5_000);
  const issue = (message: string) => context.addIssue({ code: z.ZodIssueCode.custom, message });
  if (manifest.target !== derivedTarget) issue(`target must equal derived target ${derivedTarget}`);
  if (manifest.summaryCount > derivedTarget) issue(`summaryCount must not exceed derived target ${derivedTarget}`);
  if (manifest.detailSuccessCount + manifest.detailFailureCount !== manifest.summaryCount) {
    issue("detail success and failure counts must equal summaryCount");
  }
  if (manifest.failedIds.length !== manifest.detailFailureCount) {
    issue("failedIds length must equal detailFailureCount");
  }
  if (manifest.acceptedCount + manifest.rejectedCount !== manifest.detailSuccessCount) {
    issue("accepted and rejected counts must equal detailSuccessCount");
  }
  if (manifest.rejectedIds.length !== manifest.rejectedCount) {
    issue("rejectedIds length must equal rejectedCount");
  }
  if (manifest.failedIds.some((id) => manifest.rejectedIds.includes(id))) {
    issue("failedIds and rejectedIds must be disjoint");
  }
});

function parseOfficialManifest(value: unknown): OfficialFetchManifest {
  const parsed = officialManifestSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(`Invalid official manifest: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`);
  }
  return parsed.data;
}
