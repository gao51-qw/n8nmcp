import Database from "better-sqlite3";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { COMMUNITY_SCHEMA_SQL } from "../community-db.js";

type Handler = (args: Record<string, unknown>) => Promise<{ content: Array<{ text: string }> }>;

let root: string;
let tools: Map<string, { schema: Record<string, z.ZodTypeAny>; handler: Handler }>;
let closeDb: () => void;

const requiredUrl = JSON.stringify([{ name: "url", type: "string", required: true }]);

function createFixture(dbPath: string): void {
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE nodes (
      node_type TEXT NOT NULL, package_name TEXT NOT NULL, display_name TEXT NOT NULL,
      description TEXT, category TEXT, version TEXT,
      is_ai_tool INTEGER NOT NULL DEFAULT 0, is_trigger INTEGER NOT NULL DEFAULT 0,
      is_webhook INTEGER NOT NULL DEFAULT 0, properties_json TEXT NOT NULL DEFAULT '[]',
      essentials_json TEXT NOT NULL DEFAULT '[]', credentials_json TEXT NOT NULL DEFAULT '[]',
      documentation TEXT, examples_json TEXT NOT NULL DEFAULT '[]', source_excerpt TEXT,
      updated_at TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'official',
      trust_level TEXT NOT NULL DEFAULT 'official', package_version TEXT, package_integrity TEXT,
      PRIMARY KEY (package_name, node_type)
    );
    CREATE VIRTUAL TABLE nodes_fts USING fts5(node_type, display_name, description, documentation, package_name);
    ${COMMUNITY_SCHEMA_SQL}
  `);
  const insert = db.prepare(`INSERT INTO nodes(node_type, package_name, display_name, description,
    properties_json, updated_at, source, trust_level, package_version)
    VALUES (?, ?, ?, ?, ?, 'now', ?, ?, ?)`);
  const fts = db.prepare(
    "INSERT INTO nodes_fts(node_type, display_name, description, documentation, package_name) VALUES (?, ?, ?, '', ?)",
  );
  const rows: Array<[string, string, string, string, string, string, string, string | null]> = [
    ["httpRequest", "n8n-nodes-base", "HTTP Request", "Call any API", requiredUrl, "official", "official", null],
    ["n8n-nodes-acme.acme", "n8n-nodes-acme", "Acme API", "Call the Acme API", requiredUrl, "community", "verified", "2.0.0"],
    ["n8n-nodes-raw.raw", "n8n-nodes-raw", "Raw API", "Call the Raw API", "[]", "community", "parsed", "0.3.0"],
  ];
  for (const row of rows) {
    insert.run(...row);
    fts.run(row[0], row[2], row[3], row[1]);
  }
  db.prepare(
    `INSERT INTO community_packages(package_name, version, trust_level, node_count, updated_at)
     VALUES ('n8n-nodes-mystery', '1.2.3', 'listed', 0, 'now')`,
  ).run();
  db.close();
}

async function call(name: string, args: Record<string, unknown>) {
  const tool = tools.get(name)!;
  const parsed = z.object(tool.schema).parse(args);
  const result = await tool.handler(parsed);
  return JSON.parse(result.content[0]!.text);
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "knowledge-community-tools-"));
  const dbPath = join(root, "nodes.db");
  createFixture(dbPath);
  process.env.DB_PATH = dbPath;
  const { db } = await import("../db.js");
  closeDb = () => db.close();
  const { registerAllTools } = await import("./index.js");
  tools = new Map();
  registerAllTools({
    tool(name: string, _description: string, schema: Record<string, z.ZodTypeAny>, handler: Handler) {
      tools.set(name, { schema, handler });
    },
  } as never);
});

afterEach(async () => {
  closeDb();
  vi.resetModules();
  delete process.env.DB_PATH;
  await rm(root, { recursive: true, force: true });
});

describe("community nodes in knowledge tools", () => {
  it("search_nodes returns community nodes with their trust level", async () => {
    const result = await call("search_nodes", { query: "API" });
    const byType = Object.fromEntries(
      result.results.map((r: { node_type: string; trust_level: string }) => [r.node_type, r.trust_level]),
    );
    expect(byType).toMatchObject({
      httpRequest: "official",
      "n8n-nodes-acme.acme": "verified",
      "n8n-nodes-raw.raw": "parsed",
    });
  });

  it("search_nodes can exclude community nodes or filter by trust level", async () => {
    const official = await call("search_nodes", { query: "API", include_community: false });
    expect(official.results.map((r: { node_type: string }) => r.node_type)).toEqual(["httpRequest"]);
    const verified = await call("search_nodes", { query: "API", trust_level: "verified" });
    expect(verified.results.map((r: { node_type: string }) => r.node_type)).toEqual(["n8n-nodes-acme.acme"]);
  });

  it("list_nodes honours the same filters", async () => {
    const result = await call("list_nodes", { trust_level: "parsed" });
    expect(result.nodes).toEqual([
      expect.objectContaining({ node_type: "n8n-nodes-raw.raw", source: "community", package_version: "0.3.0" }),
    ]);
  });

  it("get_node_info reports source, trust level and package version", async () => {
    await expect(call("get_node_info", { node_type: "n8n-nodes-acme.acme" })).resolves.toMatchObject({
      source: "community",
      trust_level: "verified",
      package_version: "2.0.0",
    });
  });

  it("get_node_essentials carries the trust level the gateway relies on", async () => {
    await expect(call("get_node_essentials", { node_type: "n8n-nodes-raw.raw" })).resolves.toMatchObject({
      package_name: "n8n-nodes-raw",
      source: "community",
      trust_level: "parsed",
    });
    await expect(call("get_node_essentials", { node_type: "httpRequest" })).resolves.toMatchObject({
      trust_level: "official",
    });
  });

  it("validates verified community nodes like official ones", async () => {
    const result = await call("validate_node_minimal", { node_type: "n8n-nodes-acme.acme", parameters: {} });
    expect(result).toMatchObject({
      ok: false,
      errors: [{ property: "url", message: "required field missing" }],
      trust_level: "verified",
    });
  });

  it("warns that parsed community nodes are unreviewed and schema-less ones unvalidated", async () => {
    const result = await call("validate_node_minimal", { node_type: "n8n-nodes-raw.raw", parameters: {} });
    expect(result.ok).toBe(true);
    expect(result.warnings.map((w: { message: string }) => w.message)).toEqual([
      expect.stringContaining("not reviewed by n8n"),
      expect.stringContaining("no parameter schema"),
    ]);
  });

  it("treats a node from a listed package as a warning, and a truly unknown node as an error", async () => {
    await expect(
      call("validate_node_minimal", { node_type: "n8n-nodes-mystery.mystery", parameters: {} }),
    ).resolves.toMatchObject({ ok: true, trust_level: "listed", warnings: [expect.anything()] });
    await expect(
      call("validate_node_minimal", { node_type: "n8n-nodes-nobody.ghost", parameters: {} }),
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("node not found") });
  });

  it("validate_workflow applies the same rules per node", async () => {
    const result = await call("validate_workflow", {
      workflow: {
        nodes: [
          { name: "HTTP", type: "n8n-nodes-base.httpRequest", parameters: { url: "https://x" } },
          { name: "Mystery", type: "n8n-nodes-mystery.mystery", parameters: {} },
          { name: "Ghost", type: "n8n-nodes-nobody.ghost", parameters: {} },
        ],
      },
    });
    expect(result.errors_total).toBe(1);
    expect(result.nodes[1].result).toMatchObject({ ok: true, trust_level: "listed" });
    expect(result.nodes[2].result).toEqual({ error: "unknown node_type" });
  });
});
