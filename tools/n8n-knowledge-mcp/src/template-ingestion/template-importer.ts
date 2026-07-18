import Database from "better-sqlite3";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { NormalizedTemplateEnvelope } from "./types.js";

export async function importTemplates(input: {
  dbPath: string;
  sourceDir: string;
}): Promise<{ imported: number; skipped: number }> {
  const files = (await readdir(input.sourceDir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const parsed: Array<{ file: string; value: unknown }> = [];
  for (const file of files) {
    try {
      parsed.push({ file, value: JSON.parse(await readFile(join(input.sourceDir, file), "utf8")) });
    } catch (error) {
      throw new Error(`Unable to parse normalized template ${file}: ${(error as Error).message}`, {
        cause: error,
      });
    }
  }

  const db = new Database(input.dbPath);
  try {
    const insertTemplate = db.prepare(`
      INSERT INTO templates(
        id, name, description, categories_json, node_types_json,
        tags_json, nodes_json,
        author_name, author_username, author_avatar,
        views, node_count, created_at, updated_at, source_url, workflow_json
      ) VALUES (
        @id, @name, @description, @categories_json, @node_types_json,
        @tags_json, @nodes_json,
        @author_name, @author_username, @author_avatar,
        @views, @node_count, @created_at, @updated_at, @source_url, @workflow_json
      )
    `);
    const insertFts = db.prepare(`
      INSERT INTO templates_fts(rowid, name, description, categories, node_types)
      VALUES (?, ?, ?, ?, ?)
    `);

    const replaceAll = db.transaction(() => {
      db.exec("DELETE FROM templates_fts; DELETE FROM templates;");
      const ids = new Set<number>();
      for (const item of parsed) {
        const envelope = requireNormalizedEnvelope(item.value, item.file);
        const id = envelope.workflow.id;
        if (ids.has(id)) {
          throw new Error(`Duplicate normalized template ID ${id} in ${item.file}`);
        }
        ids.add(id);
        const row = toTemplateRow(envelope);
        insertTemplate.run(row);
        insertFts.run(row.id, row.name, row.description, row._ftsCategories, row._ftsNodeTypes);
      }
    });

    replaceAll();
    return { imported: parsed.length, skipped: 0 };
  } finally {
    db.close();
  }
}

function requireNormalizedEnvelope(value: unknown, file: string): NormalizedTemplateEnvelope {
  if (!isRecord(value)
    || (value.source !== "official" && value.source !== "curated")
    || typeof value.curated !== "boolean"
    || !isFiniteNumber(value.views)
    || typeof value.sourceUrl !== "string"
    || !isRecord(value.workflow)) {
    throw invalidEnvelope(file);
  }
  const stored = value.workflow;
  if (!Number.isSafeInteger(stored.id)
    || (stored.id as number) <= 0
    || typeof stored.name !== "string"
    || stored.name.trim().length === 0
    || typeof stored.description !== "string"
    || !isFiniteNumber(stored.totalViews)
    || (stored.createdAt !== null && typeof stored.createdAt !== "string")
    || (stored.user !== null && !isRecord(stored.user))
    || !isRecord(stored.workflow)
    || !Array.isArray(stored.workflow.nodes)
    || !isRecord(stored.workflow.connections)) {
    throw invalidEnvelope(file);
  }
  for (const node of stored.workflow.nodes) {
    if (!isRecord(node)
      || typeof node.name !== "string"
      || node.name.trim().length === 0
      || typeof node.type !== "string"
      || node.type.trim().length === 0) {
      throw invalidEnvelope(file);
    }
  }
  return value as NormalizedTemplateEnvelope;
}

function toTemplateRow(envelope: NormalizedTemplateEnvelope) {
  const stored = envelope.workflow;
  const workflow = stored.workflow;
  const nodeTypes = [...new Set(workflow.nodes.map((node) => String(node.type)))];
  const categories = deriveCategories(workflow.nodes);
  return {
    id: stored.id,
    name: stored.name,
    description: stored.description,
    categories_json: JSON.stringify(categories),
    node_types_json: JSON.stringify(nodeTypes),
    tags_json: JSON.stringify(categories),
    nodes_json: JSON.stringify(nodeTypes),
    author_name: stored.user?.name ?? null,
    author_username: stored.user?.username ?? null,
    author_avatar: stored.user?.avatar ?? null,
    views: envelope.views,
    node_count: workflow.nodes.length,
    created_at: stored.createdAt,
    updated_at: null,
    source_url: envelope.sourceUrl,
    workflow_json: JSON.stringify(workflow),
    _ftsCategories: categories.join(" "),
    _ftsNodeTypes: nodeTypes.join(" "),
  };
}

function deriveCategories(nodes: Array<Record<string, unknown>>): string[] {
  const categories = new Set<string>();
  for (const node of nodes) {
    const codex = isRecord(node.codex) ? node.codex : undefined;
    const data = codex && isRecord(codex.data) ? codex.data : undefined;
    if (!data || !Array.isArray(data.categories)) continue;
    for (const category of data.categories) {
      if (typeof category === "string" && category.trim()) categories.add(category);
    }
  }
  return [...categories];
}

function invalidEnvelope(file: string): Error {
  return new Error(`Invalid normalized template envelope in ${file}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
