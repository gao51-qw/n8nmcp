import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { verifyKnowledgeDb } from "./quality-gate.js";
import type { OfficialFetchManifest } from "./types.js";

let root: string;
let dbPath: string;
let db: Database.Database;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "knowledge-quality-"));
  dbPath = join(root, "nodes.db");
  db = new Database(dbPath);
  createTemplateSchema(db);
});

afterEach(() => {
  db.close();
  rmSync(root, { force: true, recursive: true });
});

describe("verifyKnowledgeDb", () => {
  it("accepts a complete official database and reports its counts", () => {
    insertTemplate(1750);

    expect(verifyKnowledgeDb(validOfficialInput())).toMatchObject({
      mode: "official",
      ok: true,
      sourceTotal: 1,
      sourceTarget: 1,
      acceptedOfficial: 1,
      rejectedOfficial: 0,
      templateCount: 1,
      ftsCount: 1,
      curatedRequired: 1,
      curatedPresent: 1,
      errors: [],
    });
  });

  it("fails when fewer than 95 percent of the official target were accepted", () => {
    insertTemplate(1750);
    expect(() =>
      verifyKnowledgeDb({
        ...validOfficialInput(),
        manifest: officialManifest({ target: 5_000, acceptedCount: 4_749, rejectedCount: 251 }),
      }),
    ).toThrow(/4750/);
  });

  it("fails when the manifest claims completeness but the database is below the official threshold", () => {
    insertTemplate(1750);

    expect(() =>
      verifyKnowledgeDb({
        ...validOfficialInput(),
        manifest: officialManifest({ target: 5_000, acceptedCount: 5_000 }),
      }),
    ).toThrow(/database[\s\S]*4750/i);
  });

  it("collects FTS parity and stale connection target failures", () => {
    insertTemplate(1750, workflow({ target: "Missing node" }));
    db.prepare("DELETE FROM templates_fts WHERE rowid = 1750").run();

    expect(captureOfficialFailure()).toMatch(/FTS[\s\S]*Missing node/i);
  });

  it("fails when any curated ID is missing or duplicated", () => {
    insertTemplate(1750);

    expect(() => verifyKnowledgeDb({ ...validOfficialInput(), curatedIds: [1750, 3880] })).toThrow(/3880/);
    expect(() => verifyKnowledgeDb({ ...validOfficialInput(), curatedIds: [1750, 1750] })).toThrow(/duplicate/i);
  });

  it("fails when the database contains more than 5,000 templates", () => {
    const storedWorkflow = JSON.stringify(workflow());
    const insert = db.prepare(
      "INSERT INTO templates(id, name, workflow_json) VALUES (?, ?, ?)",
    );
    const insertFts = db.prepare(
      "INSERT INTO templates_fts(rowid, name, description, categories, node_types) VALUES (?, ?, '', '', ?)",
    );
    db.transaction(() => {
      for (let id = 1; id <= 5_001; id += 1) {
        insert.run(id, `Template ${id}`, storedWorkflow);
        insertFts.run(id, `Template ${id}`, "n8n-nodes-base.webhook");
      }
    })();

    expect(captureOfficialFailure()).toMatch(/5,?000/);
  });

  it.each([
    ["prohibited nodes", workflow({ nodeType: "n8n-nodes-base.executeCommand" }), /prohibited/i],
    ["secret patterns", workflow({ parameterValue: "sk-proj-abcdefghijklmnopqrstuvwxyz123456" }), /secret/i],
    ["empty workflows", { nodes: [], connections: {} }, /empty|retained nodes/i],
  ])("fails for %s", (_label, unsafeWorkflow, expected) => {
    insertTemplate(1750, unsafeWorkflow);
    expect(captureOfficialFailure()).toMatch(expected);
  });

  it("applies safety, curated, non-empty, and FTS gates in fallback mode without official completeness", () => {
    insertTemplate(1750);
    const report = verifyKnowledgeDb({
      dbPath,
      curatedIds: [1750],
      mode: "fallback",
    });

    expect(report).toMatchObject({
      mode: "fallback",
      ok: true,
      sourceTotal: 0,
      sourceTarget: 0,
      acceptedOfficial: 0,
      rejectedOfficial: 0,
      templateCount: 1,
      ftsCount: 1,
    });

    db.prepare("DELETE FROM templates_fts").run();
    const failed = verifyKnowledgeDb({ dbPath, curatedIds: [1750, 3880], mode: "fallback" });
    expect(failed.ok).toBe(false);
    expect(failed.errors.join("\n")).toMatch(/FTS[\s\S]*3880/i);
  });
});

function captureOfficialFailure(): string {
  try {
    verifyKnowledgeDb(validOfficialInput());
  } catch (error) {
    return (error as Error).message;
  }
  throw new Error("Expected the official quality gate to fail");
}

function validOfficialInput() {
  return {
    dbPath,
    manifest: officialManifest(),
    curatedIds: [1750],
    mode: "official" as const,
  };
}

function officialManifest(overrides: Partial<OfficialFetchManifest> = {}): OfficialFetchManifest {
  return {
    source: "https://api.n8n.io",
    totalWorkflows: 1,
    target: 1,
    summaryCount: 1,
    detailSuccessCount: 1,
    detailFailureCount: 0,
    failedIds: [],
    acceptedCount: 1,
    rejectedCount: 0,
    rejectedIds: [],
    generatedAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

function insertTemplate(id: number, storedWorkflow: unknown = workflow()): void {
  db.prepare(
    `INSERT INTO templates(
       id, name, description, node_types_json, nodes_json, workflow_json
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    `Template ${id}`,
    "A safe workflow template",
    JSON.stringify(["n8n-nodes-base.webhook"]),
    JSON.stringify(["n8n-nodes-base.webhook"]),
    JSON.stringify(storedWorkflow),
  );
  db.prepare(
    `INSERT INTO templates_fts(rowid, name, description, categories, node_types)
     VALUES (?, ?, ?, '', ?)`,
  ).run(id, `Template ${id}`, "A safe workflow template", "n8n-nodes-base.webhook");
}

function workflow(options: {
  nodeType?: string;
  parameterValue?: string;
  target?: string;
} = {}) {
  return {
    nodes: [
      {
        id: "webhook-1",
        name: "Webhook",
        type: options.nodeType ?? "n8n-nodes-base.webhook",
        parameters: { value: options.parameterValue ?? "safe" },
      },
    ],
    connections: options.target
      ? { Webhook: { main: [[{ node: options.target, type: "main", index: 0 }]] } }
      : {},
  };
}

function createTemplateSchema(database: Database.Database): void {
  database.exec(`
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
