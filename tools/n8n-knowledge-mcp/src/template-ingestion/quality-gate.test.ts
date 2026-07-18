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

  it("accepts 4,999 consistent official summaries when the target is 5,000", () => {
    insertSafeTemplates(4_999);

    expect(verifyKnowledgeDb({
      dbPath,
      manifest: largeOfficialManifest({
        summaryCount: 4_999,
        detailSuccessCount: 4_999,
        acceptedCount: 4_999,
      }),
      curatedIds: [1750],
      mode: "official",
    })).toMatchObject({
      ok: true,
      sourceTarget: 5_000,
      acceptedOfficial: 4_999,
      templateCount: 4_999,
    });
  });

  it("fails when fewer than 95 percent of the official target were accepted", () => {
    insertTemplate(1750);
    expect(() =>
      verifyKnowledgeDb({
        ...validOfficialInput(),
        manifest: largeOfficialManifest({
          acceptedCount: 4_749,
          rejectedCount: 251,
          rejectedIds: Array.from({ length: 251 }, (_, index) => index + 1),
        }),
      }),
    ).toThrow(/4750/);
  });

  it("fails when the manifest claims completeness but the database is below the official threshold", () => {
    insertTemplate(1750);

    expect(() =>
      verifyKnowledgeDb({
        ...validOfficialInput(),
        manifest: largeOfficialManifest(),
      }),
    ).toThrow(/database[\s\S]*4750/i);
  });

  it.each([
    ["a target below the derived source target", officialManifest({ totalWorkflows: 5_100, target: 1 }), /target[\s\S]*5000/i],
    ["an empty object", {}, /manifest/i],
    ["a non-finite count", officialManifest({ totalWorkflows: Number.NaN }), /manifest|finite|integer/i],
    ["a negative count", officialManifest({ acceptedCount: -1 }), /manifest|negative|count/i],
    ["inconsistent detail failure IDs", officialManifest({ detailSuccessCount: 0, detailFailureCount: 1, failedIds: [] }), /manifest|failure|failed/i],
    ["a summary count above the derived target", largeOfficialManifest({ summaryCount: 5_001, detailSuccessCount: 5_001, acceptedCount: 5_001 }), /summaryCount[\s\S]*5000/i],
  ])("rejects invalid official manifest: %s", (_label, manifest, expected) => {
    insertTemplate(1750);

    expect(() => verifyKnowledgeDb({
      dbPath,
      manifest: manifest as OfficialFetchManifest,
      curatedIds: [1750],
      mode: "official",
    })).toThrow(expected);
  });

  it("collects FTS parity and stale connection target failures", () => {
    insertTemplate(1750, workflow({ target: "Missing node" }));
    db.prepare("DELETE FROM templates_fts WHERE rowid = 1750").run();

    expect(captureOfficialFailure()).toMatch(/FTS[\s\S]*Missing node/i);
  });

  it.each([
    ["missing type", { node: "Webhook", index: 0 }],
    ["empty type", { node: "Webhook", type: "   ", index: 0 }],
    ["missing index", { node: "Webhook", type: "main" }],
    ["negative index", { node: "Webhook", type: "main", index: -1 }],
    ["fractional index", { node: "Webhook", type: "main", index: 0.5 }],
  ])("collects malformed connection descriptor errors in official mode: %s", (_label, descriptor) => {
    insertTemplate(1750, workflowWithDescriptor(descriptor));

    expect(captureOfficialFailure()).toMatch(/malformed connection target/i);
  });

  it.each([
    ["missing type", { node: "Webhook", index: 0 }],
    ["empty type", { node: "Webhook", type: "", index: 0 }],
    ["missing index", { node: "Webhook", type: "main" }],
    ["negative index", { node: "Webhook", type: "main", index: -1 }],
    ["fractional index", { node: "Webhook", type: "main", index: 0.5 }],
  ])("collects malformed connection descriptor errors in fallback mode: %s", (_label, descriptor) => {
    insertTemplate(1750, workflowWithDescriptor(descriptor));

    const report = verifyKnowledgeDb({ dbPath, curatedIds: [1750], mode: "fallback" });
    expect(report.ok).toBe(false);
    expect(report.errors.join("\n")).toMatch(/malformed connection target/i);
  });

  it("fails when template and FTS counts match but their IDs differ", () => {
    insertTemplate(1750);
    db.prepare("DELETE FROM templates_fts WHERE rowid = 1750").run();
    db.prepare(
      "INSERT INTO templates_fts(rowid, name, description, categories, node_types) VALUES (3880, 'Wrong', '', '', '')",
    ).run();

    expect(captureOfficialFailure()).toMatch(/FTS[\s\S]*1750[\s\S]*3880/i);
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
    ["credential references", workflow({ sensitiveKey: "credentials", parameterValue: { httpBasicAuth: { id: "7" } } }), /credential|sensitive/i],
    ["innocuous passwords", workflow({ sensitiveKey: "Password", parameterValue: "not-a-token" }), /password|sensitive/i],
    ["innocuous API keys", workflow({ sensitiveKey: "apiKey", parameterValue: "development-placeholder" }), /api.?key|sensitive/i],
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

function largeOfficialManifest(overrides: Partial<OfficialFetchManifest> = {}): OfficialFetchManifest {
  return officialManifest({
    totalWorkflows: 5_100,
    target: 5_000,
    summaryCount: 5_000,
    detailSuccessCount: 5_000,
    acceptedCount: 5_000,
    ...overrides,
  });
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

function insertSafeTemplates(count: number): void {
  db.transaction(() => {
    for (let id = 1; id <= count; id += 1) insertTemplate(id);
  })();
}

function workflow(options: {
  nodeType?: string;
  parameterValue?: unknown;
  sensitiveKey?: string;
  target?: string;
} = {}) {
  const parameters = options.sensitiveKey
    ? { [options.sensitiveKey]: options.parameterValue }
    : { value: options.parameterValue ?? "safe" };
  return {
    nodes: [
      {
        id: "webhook-1",
        name: "Webhook",
        type: options.nodeType ?? "n8n-nodes-base.webhook",
        parameters,
      },
    ],
    connections: options.target
      ? { Webhook: { main: [[{ node: options.target, type: "main", index: 0 }]] } }
      : {},
  };
}

function workflowWithDescriptor(descriptor: Record<string, unknown>) {
  return {
    nodes: [{
      id: "webhook-1",
      name: "Webhook",
      type: "n8n-nodes-base.webhook",
      parameters: {},
    }],
    connections: { Webhook: { main: [[descriptor]] } },
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
