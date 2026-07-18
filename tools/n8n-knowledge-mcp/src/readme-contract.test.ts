import Database from "better-sqlite3";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { importTemplates } from "./template-ingestion/template-importer.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("Knowledge MCP README contracts", () => {
  const readme = readFileSync(resolve(process.cwd(), "README.md"), "utf8");

  it("keeps the custom-template example accepted by the network-free importer", async () => {
    const marker = "To import a separately prepared local folder";
    const start = readme.indexOf("```json", readme.indexOf(marker));
    const end = readme.indexOf("```", start + 7);
    expect(start).toBeGreaterThanOrEqual(0);
    const example = JSON.parse(readme.slice(start + 7, end));

    const root = mkdtempSync(join(tmpdir(), "knowledge-readme-contract-"));
    roots.push(root);
    const sourceDir = join(root, "templates");
    const dbPath = join(root, "nodes.db");
    mkdirSync(sourceDir);
    writeFileSync(join(sourceDir, "example.json"), JSON.stringify(example));
    createTemplateSchema(dbPath);

    await expect(importTemplates({ dbPath, sourceDir })).resolves.toEqual({ imported: 1, skipped: 0 });
  });

  it("labels the registry count as a generated 2026-06-10 snapshot and points to current stats", () => {
    expect(readme).toMatch(/Official Registry Count[^\n]*2026-06-10[^\n]*Snapshot/i);
    expect(readme).toMatch(/data\/stats\.json/);
  });
});

function createTemplateSchema(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE templates (
      id INTEGER PRIMARY KEY, name TEXT, description TEXT, categories_json TEXT,
      node_types_json TEXT, tags_json TEXT, nodes_json TEXT, author_name TEXT,
      author_username TEXT, author_avatar TEXT, views INTEGER, node_count INTEGER,
      created_at TEXT, updated_at TEXT, source_url TEXT, workflow_json TEXT
    );
    CREATE VIRTUAL TABLE templates_fts USING fts5(name, description, categories, node_types);
  `);
  db.close();
}
