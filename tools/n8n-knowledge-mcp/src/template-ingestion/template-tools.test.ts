import Database from "better-sqlite3";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { importTemplates } from "./template-importer.js";
import type { NormalizedTemplateEnvelope } from "./types.js";

let root: string | undefined;

afterEach(async () => {
  vi.resetModules();
  delete process.env.DB_PATH;
  if (root) await rm(root, { force: true, recursive: true });
  root = undefined;
});

describe("direct template tool handlers", () => {
  it("searches imported FTS rows and returns parsed sanitized workflow JSON", async () => {
    root = await mkdtemp(join(tmpdir(), "knowledge-template-tools-"));
    const sourceDir = join(root, "merged");
    const dbPath = join(root, "nodes.db");
    await mkdir(sourceDir);
    createTemplateSchema(dbPath);
    await writeFile(join(sourceDir, "1750.json"), JSON.stringify(envelope()), "utf8");
    await importTemplates({ dbPath, sourceDir });

    process.env.DB_PATH = dbPath;
    const { db } = await import("../db.js");
    const { getWorkflowTemplateById, registerAllTools, searchWorkflowTemplates } = await import("../tools/index.js");

    try {
      expect(searchWorkflowTemplates({ query: "Slack" })).toMatchObject({
        count: 1,
        templates: [{ id: 1750, name: "Slack notification" }],
      });
      const template = getWorkflowTemplateById(1750);
      expect(template).toMatchObject({
        id: 1750,
        categories: [],
        node_types: ["n8n-nodes-base.webhook"],
        workflow: {
          nodes: [{ name: "Webhook", type: "n8n-nodes-base.webhook" }],
          connections: {},
        },
      });
      expect(JSON.stringify(template?.workflow)).not.toMatch(/credentials|sk-proj-/i);
      expect(() => searchWorkflowTemplates({ query: "   " })).toThrow(/query/i);

      const registrations = new Map<string, Record<string, z.ZodTypeAny>>();
      registerAllTools({
        tool(name: string, _description: string, schema: Record<string, z.ZodTypeAny>) {
          registrations.set(name, schema);
        },
      } as never);
      const searchSchema = z.object(registrations.get("search_templates")!);
      expect(() => searchSchema.parse({ query: "   ", limit: 10 })).toThrow();
    } finally {
      db.close();
    }
  });
});

function createTemplateSchema(dbPath: string): void {
  const database = new Database(dbPath);
  database.exec(`
    CREATE TABLE nodes (node_type TEXT);
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
  database.close();
}

function envelope(): NormalizedTemplateEnvelope {
  return {
    source: "official",
    curated: true,
    views: 1750,
    workflow: {
      id: 1750,
      name: "Slack notification",
      description: "Send a Slack notification from a webhook",
      totalViews: 1750,
      createdAt: "2026-07-13T00:00:00.000Z",
      user: { name: "n8n", username: "n8n", avatar: null },
      workflow: {
        nodes: [{
          id: "webhook-1",
          name: "Webhook",
          type: "n8n-nodes-base.webhook",
          parameters: { path: "safe" },
        }],
        connections: {},
      },
    },
    sourceUrl: "https://n8n.io/workflows/1750",
  };
}
