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
    DROP TABLE IF EXISTS templates;

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
      tags_json TEXT NOT NULL DEFAULT '[]',
      nodes_json TEXT NOT NULL DEFAULT '[]',
      workflow_json TEXT
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
  console.log(`[db] wrote ${count} nodes (${ai} AI tools, ${triggers} triggers) → ${OUT}`);
  db.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
