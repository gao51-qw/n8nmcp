// scripts/4-build-db.ts
// Combine _nodes.json + _docs.json into data/nodes.db (SQLite + FTS5).
import Database from "better-sqlite3";
import { readFile, mkdir } from "node:fs/promises";
import { resolve, join, dirname } from "node:path";

const TMP = resolve(process.cwd(), ".tmp/pkgs");
const OUT = resolve(process.cwd(), "data/nodes.db");

type Node = {
  node_type: string;
  package_name: string;
  display_name: string;
  description: string | null;
  category: string | null;
  version: string;
  is_ai_tool: 0 | 1;
  is_trigger: 0 | 1;
  is_webhook: 0 | 1;
  properties_json: string;
  credentials_json: string;
  source_path: string;
  source_excerpt: string;
};

function essentialsOf(propsJson: string): string {
  let props: any[];
  try {
    props = JSON.parse(propsJson);
  } catch {
    return "[]";
  }
  if (!Array.isArray(props)) return "[]";
  const essentials = props
    .filter((p) => p.required || /^(resource|operation|url|method)$/i.test(p.name ?? ""))
    .slice(0, 20)
    .map((p) => ({
      name: p.name,
      displayName: p.displayName,
      type: p.type,
      required: !!p.required,
      default: p.default,
      description: p.description,
      options: Array.isArray(p.options)
        ? p.options.slice(0, 12).map((o: any) => ({ name: o.name, value: o.value }))
        : undefined,
    }));
  return JSON.stringify(essentials);
}

async function main() {
  await mkdir(dirname(OUT), { recursive: true });
  const nodes = JSON.parse(await readFile(join(TMP, "_nodes.json"), "utf8")) as Node[];
  let docs: Record<string, { documentation: string; examples_json: string }> = {};
  try {
    docs = JSON.parse(await readFile(join(TMP, "_docs.json"), "utf8"));
  } catch {}

  const db = new Database(OUT);
  db.pragma("journal_mode = WAL");
  db.exec(`
    DROP TABLE IF EXISTS nodes;
    DROP TABLE IF EXISTS nodes_fts;
    DROP TABLE IF EXISTS templates_fts;
    DROP TABLE IF EXISTS templates;
    DROP TABLE IF EXISTS external_node_candidates;
    DROP TABLE IF EXISTS external_node_candidates_fts;
    DROP TABLE IF EXISTS external_node_validation_results;
    DROP TABLE IF EXISTS verified_external_nodes;
    DROP TABLE IF EXISTS verified_external_nodes_fts;

    CREATE TABLE nodes (
      node_type TEXT NOT NULL,
      package_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      version TEXT,
      is_ai_tool INTEGER NOT NULL DEFAULT 0,
      is_trigger INTEGER NOT NULL DEFAULT 0,
      is_webhook INTEGER NOT NULL DEFAULT 0,
      properties_json TEXT NOT NULL DEFAULT '[]',
      essentials_json TEXT NOT NULL DEFAULT '[]',
      credentials_json TEXT NOT NULL DEFAULT '[]',
      documentation TEXT,
      examples_json TEXT NOT NULL DEFAULT '[]',
      source_excerpt TEXT,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (package_name, node_type)
    );

    CREATE INDEX idx_nodes_type ON nodes(node_type);
    CREATE INDEX idx_nodes_aitool ON nodes(is_ai_tool);
    CREATE INDEX idx_nodes_category ON nodes(category);

    CREATE VIRTUAL TABLE nodes_fts USING fts5(
      node_type, display_name, description, documentation, package_name,
      tokenize='unicode61'
    );

    CREATE TABLE templates (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      categories_json TEXT NOT NULL DEFAULT '[]',
      node_types_json TEXT NOT NULL DEFAULT '[]',
      tags_json TEXT NOT NULL DEFAULT '[]',
      nodes_json TEXT NOT NULL DEFAULT '[]',
      author_name TEXT,
      author_username TEXT,
      author_avatar TEXT,
      views INTEGER NOT NULL DEFAULT 0,
      node_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT,
      source_url TEXT,
      workflow_json TEXT
    );

    CREATE INDEX idx_templates_views ON templates(views DESC);
    CREATE INDEX idx_templates_node_count ON templates(node_count);

    CREATE VIRTUAL TABLE templates_fts USING fts5(
      name, description, categories, node_types,
      content='', contentless_delete=1,
      tokenize='unicode61'
    );

    CREATE TABLE external_node_candidates (
      source TEXT NOT NULL,
      package_name TEXT NOT NULL,
      node_type TEXT NOT NULL,
      normalized_node_type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      version TEXT,
      candidate_kind TEXT NOT NULL,
      verification_status TEXT NOT NULL DEFAULT 'external-unverified',
      is_ai_tool INTEGER NOT NULL DEFAULT 0,
      is_trigger INTEGER NOT NULL DEFAULT 0,
      is_webhook INTEGER NOT NULL DEFAULT 0,
      is_tool_variant INTEGER NOT NULL DEFAULT 0,
      tool_variant_of TEXT,
      normalized_tool_variant_of TEXT,
      is_community INTEGER NOT NULL DEFAULT 0,
      is_verified INTEGER NOT NULL DEFAULT 0,
      npm_package_name TEXT,
      npm_version TEXT,
      npm_downloads INTEGER NOT NULL DEFAULT 0,
      properties_json TEXT NOT NULL DEFAULT '[]',
      credentials_json TEXT NOT NULL DEFAULT '[]',
      documentation TEXT,
      operations_json TEXT NOT NULL DEFAULT '[]',
      source_metadata_json TEXT NOT NULL DEFAULT '{}',
      imported_at TEXT NOT NULL,
      PRIMARY KEY (source, package_name, node_type)
    );

    CREATE INDEX idx_external_node_candidates_kind ON external_node_candidates(candidate_kind);
    CREATE INDEX idx_external_node_candidates_package ON external_node_candidates(package_name);
    CREATE INDEX idx_external_node_candidates_verified ON external_node_candidates(is_verified);

    CREATE VIRTUAL TABLE external_node_candidates_fts USING fts5(
      node_type, normalized_node_type, display_name, description, package_name, documentation,
      tokenize='unicode61'
    );

    CREATE TABLE external_node_validation_results (
      source TEXT NOT NULL,
      package_name TEXT NOT NULL,
      node_type TEXT NOT NULL,
      normalized_node_type TEXT NOT NULL,
      candidate_kind TEXT NOT NULL,
      validation_status TEXT NOT NULL,
      validation_errors_json TEXT NOT NULL DEFAULT '[]',
      validation_warnings_json TEXT NOT NULL DEFAULT '[]',
      validated_at TEXT NOT NULL,
      PRIMARY KEY (source, package_name, node_type)
    );

    CREATE INDEX idx_external_node_validation_status
      ON external_node_validation_results(validation_status);

    CREATE TABLE verified_external_nodes (
      source TEXT NOT NULL,
      package_name TEXT NOT NULL,
      node_type TEXT NOT NULL,
      normalized_node_type TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      version TEXT,
      candidate_kind TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      is_ai_tool INTEGER NOT NULL DEFAULT 0,
      is_trigger INTEGER NOT NULL DEFAULT 0,
      is_webhook INTEGER NOT NULL DEFAULT 0,
      is_tool_variant INTEGER NOT NULL DEFAULT 0,
      tool_variant_of TEXT,
      normalized_tool_variant_of TEXT,
      is_community INTEGER NOT NULL DEFAULT 0,
      is_verified INTEGER NOT NULL DEFAULT 0,
      npm_package_name TEXT,
      npm_version TEXT,
      npm_downloads INTEGER NOT NULL DEFAULT 0,
      properties_json TEXT NOT NULL DEFAULT '[]',
      credentials_json TEXT NOT NULL DEFAULT '[]',
      documentation TEXT,
      operations_json TEXT NOT NULL DEFAULT '[]',
      source_metadata_json TEXT NOT NULL DEFAULT '{}',
      validation_warnings_json TEXT NOT NULL DEFAULT '[]',
      validated_at TEXT NOT NULL,
      PRIMARY KEY (source, package_name, node_type)
    );

    CREATE INDEX idx_verified_external_nodes_kind ON verified_external_nodes(candidate_kind);
    CREATE INDEX idx_verified_external_nodes_package ON verified_external_nodes(package_name);
    CREATE INDEX idx_verified_external_nodes_downloads ON verified_external_nodes(npm_downloads DESC);

    CREATE VIRTUAL TABLE verified_external_nodes_fts USING fts5(
      node_type, normalized_node_type, display_name, description, package_name, documentation,
      tokenize='unicode61'
    );
  `);

  const ins = db.prepare(`
    INSERT INTO nodes(
      node_type, package_name, display_name, description, category, version,
      is_ai_tool, is_trigger, is_webhook,
      properties_json, essentials_json, credentials_json,
      documentation, examples_json, source_excerpt, updated_at
    ) VALUES (
      @node_type, @package_name, @display_name, @description, @category, @version,
      @is_ai_tool, @is_trigger, @is_webhook,
      @properties_json, @essentials_json, @credentials_json,
      @documentation, @examples_json, @source_excerpt, @updated_at
    )
  `);
  const insFts = db.prepare(`
    INSERT INTO nodes_fts(node_type, display_name, description, documentation, package_name)
    VALUES (?, ?, ?, ?, ?)
  `);

  const tx = db.transaction((rows: Node[]) => {
    const now = new Date().toISOString();
    for (const n of rows) {
      const doc = docs[n.node_type] ?? { documentation: "", examples_json: "[]" };
      ins.run({
        ...n,
        essentials_json: essentialsOf(n.properties_json),
        documentation: doc.documentation || null,
        examples_json: doc.examples_json || "[]",
        updated_at: now,
      });
      insFts.run(n.node_type, n.display_name, n.description ?? "", doc.documentation ?? "", n.package_name);
    }
  });
  tx(nodes);

  const count = (db.prepare("SELECT COUNT(*) c FROM nodes").get() as { c: number }).c;
  const ai = (db.prepare("SELECT COUNT(*) c FROM nodes WHERE is_ai_tool = 1").get() as { c: number }).c;
  const triggers = (db.prepare("SELECT COUNT(*) c FROM nodes WHERE is_trigger = 1").get() as { c: number }).c;
  db.pragma("journal_mode = DELETE");
  console.log(`[db] wrote ${count} nodes (${ai} AI tools, ${triggers} triggers) → ${OUT}`);
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
