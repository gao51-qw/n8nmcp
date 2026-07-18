import Database from "better-sqlite3";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { importTemplates } from "./template-importer.js";
import type { NormalizedTemplateEnvelope } from "./types.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })));
});

describe("importTemplates", () => {
  it("imports normalized templates and keeps FTS row parity", async () => {
    const fixture = await createFixture();
    await writeEnvelope(fixture.sourceDir, envelope(1750, "Slack notification"));
    await writeEnvelope(fixture.sourceDir, envelope(3880, "Email digest"));

    const result = await importTemplates(fixture);

    expect(result).toEqual({ imported: 2, skipped: 0 });
    const db = new Database(fixture.dbPath);
    expect(db.prepare("SELECT COUNT(*) count FROM templates").get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT COUNT(*) count FROM templates_fts").get()).toEqual({ count: 2 });
    expect(
      db.prepare(
        `SELECT t.id, t.name
           FROM templates_fts f JOIN templates t ON t.id = f.rowid
          WHERE templates_fts MATCH ?`,
      ).all('"Slack"*'),
    ).toEqual([{ id: 1750, name: "Slack notification" }]);
    db.prepare("DELETE FROM templates_fts WHERE rowid = ?").run(3880);
    expect(db.prepare("SELECT COUNT(*) count FROM templates_fts").get()).toEqual({ count: 1 });
    const stored = db.prepare("SELECT workflow_json FROM templates WHERE id = 1750").get() as {
      workflow_json: string;
    };
    expect(JSON.parse(stored.workflow_json)).toMatchObject({
      nodes: [{ name: "Webhook", type: "n8n-nodes-base.webhook" }],
    });
    db.close();
  });

  it("rejects duplicate template IDs and rolls back the replacement", async () => {
    const fixture = await createFixture();
    const db = new Database(fixture.dbPath);
    insertExistingTemplate(db, 99);
    db.close();
    await writeFile(join(fixture.sourceDir, "first.json"), JSON.stringify(envelope(1750, "First")));
    await writeFile(join(fixture.sourceDir, "second.json"), JSON.stringify(envelope(1750, "Second")));

    await expect(importTemplates(fixture)).rejects.toThrow(/duplicate/i);

    const unchanged = new Database(fixture.dbPath, { readonly: true });
    expect(unchanged.prepare("SELECT id FROM templates ORDER BY id").all()).toEqual([{ id: 99 }]);
    expect(unchanged.prepare("SELECT COUNT(*) count FROM templates_fts").get()).toEqual({ count: 1 });
    unchanged.close();
  });

  it("does not silently skip malformed JSON or invalid normalized envelopes", async () => {
    const fixture = await createFixture();
    const db = new Database(fixture.dbPath);
    insertExistingTemplate(db, 99);
    db.close();
    await writeFile(join(fixture.sourceDir, "broken.json"), "{not-json", "utf8");

    await expect(importTemplates(fixture)).rejects.toThrow(/broken\.json/i);

    await writeFile(join(fixture.sourceDir, "broken.json"), JSON.stringify({ source: "official" }), "utf8");
    await expect(importTemplates(fixture)).rejects.toThrow(/normalized template envelope/i);
    const unchanged = new Database(fixture.dbPath, { readonly: true });
    expect(unchanged.prepare("SELECT id FROM templates").all()).toEqual([{ id: 99 }]);
    unchanged.close();
  });
});

async function createFixture(): Promise<{ dbPath: string; sourceDir: string }> {
  const root = await mkdtemp(join(tmpdir(), "knowledge-importer-"));
  temporaryDirectories.push(root);
  const dbPath = join(root, "nodes.db");
  const sourceDir = join(root, "merged");
  await import("node:fs/promises").then(({ mkdir }) => mkdir(sourceDir));
  const db = new Database(dbPath);
  createTemplateSchema(db);
  db.close();
  return { dbPath, sourceDir };
}

function createTemplateSchema(db: Database.Database): void {
  db.exec(`
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
    CREATE VIRTUAL TABLE templates_fts USING fts5(
      name, description, categories, node_types,
      content='', contentless_delete=1, tokenize='unicode61'
    );
  `);
}

function insertExistingTemplate(db: Database.Database, id: number): void {
  const workflow = JSON.stringify(envelope(id, "Existing").workflow.workflow);
  db.prepare("INSERT INTO templates(id, name, workflow_json) VALUES (?, ?, ?)").run(id, "Existing", workflow);
  db.prepare("INSERT INTO templates_fts(rowid, name, description, categories, node_types) VALUES (?, ?, '', '', '')")
    .run(id, "Existing");
}

async function writeEnvelope(sourceDir: string, value: NormalizedTemplateEnvelope): Promise<void> {
  const path = join(sourceDir, `${value.workflow.id}.json`);
  await writeFile(path, JSON.stringify(value), "utf8");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual(value);
}

function envelope(id: number, name: string): NormalizedTemplateEnvelope {
  return {
    source: "official",
    curated: id === 1750,
    views: id,
    workflow: {
      id,
      name,
      description: `${name} description`,
      totalViews: id,
      createdAt: "2026-07-13T00:00:00.000Z",
      user: { name: "n8n", username: "n8n", avatar: null },
      workflow: {
        nodes: [
          {
            id: "webhook-1",
            name: "Webhook",
            type: "n8n-nodes-base.webhook",
            parameters: { path: "test", httpMethod: "POST" },
          },
        ],
        connections: {},
      },
    },
    sourceUrl: `https://n8n.io/workflows/${id}`,
  };
}
