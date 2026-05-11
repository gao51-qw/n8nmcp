// scripts/5-build-templates.ts
// Stream-ingest n8n workflow template JSONs from a local folder into data/nodes.db.
// Each input file is expected to match the n8n.io export envelope shape:
//   { workflow: { id, name, description, workflow: { nodes, connections, ... },
//                 user: { name, username, avatar }, workflowInfo: { nodeTypes },
//                 views, totalViews, createdAt, ... } }
// Run: TEMPLATES_DIR=/path/to/jsons npm run build:templates
import Database from "better-sqlite3";
import { readdir, readFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";

const DB_PATH = process.env.DB_PATH ?? resolve(process.cwd(), "data/nodes.db");
const SRC = process.env.TEMPLATES_DIR ?? resolve(process.cwd(), "data/custom-templates");
const BATCH = Number(process.env.BATCH_SIZE ?? 200);

type Envelope = {
  workflow?: {
    id?: number | string;
    name?: string;
    description?: string;
    views?: number;
    totalViews?: number;
    createdAt?: string;
    updatedAt?: string;
    user?: { name?: string; username?: string; avatar?: string };
    workflow?: {
      id?: string | number;
      name?: string;
      nodes?: Array<{ name: string; type: string; parameters?: unknown; typeVersion?: number; position?: number[] }>;
      connections?: Record<string, unknown>;
      settings?: unknown;
      active?: boolean;
    };
    workflowInfo?: { nodeCount?: number; nodeTypes?: Record<string, { count: number }> };
    nodes?: Array<{ name?: string; codex?: { data?: { categories?: string[] } } }>;
  };
  // sidecar metadata.json shape (also supported when files live in subfolders)
  id?: number | string;
  title?: string;
  description?: string;
  categories?: string[];
  nodeTypes?: string[];
  author?: { name?: string; slug?: string; avatar?: string };
  visitors?: number;
  createdAt?: string;
  updatedAt?: string;
  sourceUrl?: string;
};

function pickFirstString(...vals: Array<unknown>): string | null {
  for (const v of vals) if (typeof v === "string" && v.trim()) return v;
  return null;
}

function deriveCategories(env: Envelope): string[] {
  if (Array.isArray(env.categories)) return env.categories.filter((c) => typeof c === "string");
  const cats = new Set<string>();
  for (const n of env.workflow?.nodes ?? []) {
    for (const c of n?.codex?.data?.categories ?? []) cats.add(c);
  }
  return [...cats];
}

function deriveNodeTypes(env: Envelope): string[] {
  if (Array.isArray(env.nodeTypes)) return env.nodeTypes.filter((t) => typeof t === "string");
  const info = env.workflow?.workflowInfo?.nodeTypes;
  if (info) return Object.keys(info);
  const wf = env.workflow?.workflow?.nodes ?? [];
  return [...new Set(wf.map((n) => n.type).filter(Boolean))];
}

function normalize(env: Envelope, fallbackId: number) {
  const w = env.workflow ?? {};
  const wf = w.workflow ?? null;
  const id = Number(w.id ?? env.id ?? fallbackId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const name = pickFirstString(w.name, env.title, wf?.name) ?? `template-${id}`;
  const description = pickFirstString(w.description, env.description) ?? "";
  const categories = deriveCategories(env);
  const nodeTypes = deriveNodeTypes(env);
  const author = w.user ?? env.author ?? null;
  const views = Number(w.totalViews ?? w.views ?? env.visitors ?? 0) || 0;
  const nodeCount = wf?.nodes?.length ?? w.workflowInfo?.nodeCount ?? nodeTypes.length;
  return {
    id,
    name,
    description,
    categories_json: JSON.stringify(categories),
    node_types_json: JSON.stringify(nodeTypes),
    tags_json: JSON.stringify(categories), // alias for legacy queries
    nodes_json: JSON.stringify(nodeTypes), // alias used by list_node_templates LIKE search
    author_name: author?.name ?? null,
    author_username: (author as { username?: string; slug?: string } | null)?.username
      ?? (author as { slug?: string } | null)?.slug
      ?? null,
    author_avatar: author?.avatar ?? null,
    views,
    node_count: nodeCount,
    created_at: w.createdAt ?? env.createdAt ?? null,
    updated_at: w.updatedAt ?? env.updatedAt ?? null,
    source_url: env.sourceUrl ?? (id ? `https://n8n.io/workflows/${id}` : null),
    workflow_json: wf ? JSON.stringify(wf) : null,
    _fts: { categories: categories.join(" "), node_types: nodeTypes.join(" ") },
  };
}

async function* walkJson(root: string): AsyncGenerator<string> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    const p = join(root, e.name);
    if (e.isDirectory()) {
      yield* walkJson(p);
    } else if (e.isFile() && e.name.toLowerCase().endsWith(".json")) {
      yield p;
    }
  }
}

async function main() {
  const st = await stat(SRC).catch(() => null);
  if (!st || !st.isDirectory()) {
    console.error(`[templates] TEMPLATES_DIR not found or not a directory: ${SRC}`);
    process.exit(1);
  }
  console.log(`[templates] scanning ${SRC} → ${DB_PATH}`);

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // ensure clean slate (templates table is recreated by 4-build-db.ts; here we just empty it)
  db.exec(`DELETE FROM templates_fts; DELETE FROM templates;`);

  const ins = db.prepare(`
    INSERT OR REPLACE INTO templates(
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
  const insFts = db.prepare(`
    INSERT INTO templates_fts(rowid, name, description, categories, node_types)
    VALUES (?, ?, ?, ?, ?)
  `);

  let total = 0;
  let skipped = 0;
  let buffer: ReturnType<typeof normalize>[] = [];

  const flush = db.transaction((rows: NonNullable<ReturnType<typeof normalize>>[]) => {
    for (const r of rows) {
      const { _fts, ...row } = r;
      ins.run(row);
      insFts.run(row.id, row.name, row.description ?? "", _fts.categories, _fts.node_types);
    }
  });

  let fallback = 1;
  for await (const path of walkJson(SRC)) {
    try {
      const txt = await readFile(path, "utf8");
      const env = JSON.parse(txt) as Envelope;
      const row = normalize(env, fallback++);
      if (!row) {
        skipped++;
        continue;
      }
      buffer.push(row);
      if (buffer.length >= BATCH) {
        flush(buffer as NonNullable<ReturnType<typeof normalize>>[]);
        total += buffer.length;
        buffer = [];
        if (total % 1000 === 0) console.log(`[templates] inserted ${total}…`);
      }
    } catch (e) {
      skipped++;
      if (skipped < 20) console.warn(`[templates] skip ${path}: ${(e as Error).message}`);
    }
  }
  if (buffer.length) {
    flush(buffer as NonNullable<ReturnType<typeof normalize>>[]);
    total += buffer.length;
  }

  const count = (db.prepare("SELECT COUNT(*) c FROM templates").get() as { c: number }).c;
  console.log(`[templates] done: ${total} inserted, ${skipped} skipped, table size ${count}`);
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
