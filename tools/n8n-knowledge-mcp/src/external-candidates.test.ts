import Database from "better-sqlite3";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

type ExternalNodeFixture = {
  node_type: string;
  package_name?: string;
  display_name?: string;
  properties_schema?: string | null;
  operations?: string | null;
  credentials_required?: string | null;
};

type ImportedFixtureSnapshot = {
  local: Buffer;
  external: Buffer;
};

const tempDirectories: string[] = [];
const packageRoot = process.cwd();
const importCompiled = resolve(packageRoot, "dist/scripts/7-import-external-candidates.js");
const verifyCompiled = resolve(packageRoot, "dist/scripts/8-verify-external-nodes.js");
let importedFixtureSnapshot: ImportedFixtureSnapshot | undefined;

function createImportFixture(rows: ExternalNodeFixture[]) {
  const root = mkdtempSync(join(tmpdir(), "n8n-external-import-"));
  tempDirectories.push(root);
  const dataDirectory = join(root, "data");
  mkdirSync(dataDirectory);
  const localPath = join(dataDirectory, "nodes.db");
  const externalPath = join(root, "external.db");

  const local = new Database(localPath);
  local.exec(`
    CREATE TABLE nodes (node_type TEXT NOT NULL, package_name TEXT NOT NULL);
    INSERT INTO nodes(node_type, package_name) VALUES ('manualTrigger', 'n8n-nodes-base');
  `);
  local.close();

  const external = new Database(externalPath);
  external.exec(`
    CREATE TABLE nodes (
      node_type TEXT NOT NULL,
      package_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      description TEXT,
      category TEXT,
      version TEXT,
      documentation TEXT,
      properties_schema TEXT,
      operations TEXT,
      credentials_required TEXT,
      is_ai_tool INTEGER,
      is_trigger INTEGER,
      is_webhook INTEGER,
      is_tool_variant INTEGER,
      tool_variant_of TEXT,
      is_community INTEGER,
      is_verified INTEGER,
      npm_package_name TEXT,
      npm_version TEXT,
      npm_downloads INTEGER,
      author_name TEXT,
      author_github_url TEXT,
      development_style TEXT
    );
  `);
  const insert = external.prepare(`
    INSERT INTO nodes VALUES (
      @node_type, @package_name, @display_name, 'Fixture node', 'Transform', '1',
      'Fixture docs', @properties_schema, @operations, @credentials_required,
      0, 0, 0, 0, NULL, 1, 1, @package_name, '1.0.0', 100,
      'Fixture Author', 'https://example.test/author', 'programmatic'
    )
  `);
  for (const row of rows) {
    insert.run({
      node_type: row.node_type,
      package_name: row.package_name ?? "n8n-nodes-fixture",
      display_name: row.display_name ?? "Fixture",
      properties_schema: row.properties_schema ?? "[]",
      operations: row.operations ?? "[]",
      credentials_required: row.credentials_required ?? "[]",
    });
  }
  external.close();

  return { root, localPath, externalPath };
}

function runImporter(root: string, externalPath: string) {
  return spawnSync(
    process.execPath,
    [importCompiled],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, EXTERNAL_N8N_MCP_DB: externalPath },
    },
  );
}

function runVerifier(root: string) {
  return spawnSync(
    process.execPath,
    [verifyCompiled],
    { cwd: root, encoding: "utf8", env: process.env },
  );
}

beforeAll(() => {
  const fixture = createImportFixture([{ node_type: "n8n-nodes-fixture.previous" }]);
  const initial = runImporter(fixture.root, fixture.externalPath);
  if (initial.status !== 0) {
    throw new Error(`Unable to prepare imported fixture: ${initial.stderr}`);
  }
  importedFixtureSnapshot = {
    local: readFileSync(fixture.localPath),
    external: readFileSync(fixture.externalPath),
  };
});

function createImportedFixture() {
  if (!importedFixtureSnapshot) throw new Error("Imported fixture snapshot is unavailable");
  const fixture = createImportFixture([]);
  writeFileSync(fixture.localPath, importedFixtureSnapshot.local);
  writeFileSync(fixture.externalPath, importedFixtureSnapshot.external);
  return fixture;
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    rmSync(tempDirectories.pop()!, { recursive: true, force: true });
  }
});

describe("external candidate opt-in commands", () => {
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));
  const requiredFiles = [
    "scripts/7-import-external-candidates.ts",
    "scripts/8-verify-external-nodes.ts",
    "src/external-node-validation.ts",
  ];

  it("ships every file referenced by the documented opt-in commands", () => {
    const testSource = readFileSync(resolve("src/external-candidates.test.ts"), "utf8");
    const runtimeConstantsSource = testSource.slice(
      testSource.indexOf("\nconst packageRoot"),
      testSource.indexOf("\nfunction createImportFixture"),
    );
    expect(runtimeConstantsSource).not.toContain("node_modules/tsx");

    expect(pkg.scripts["build:db:with-external"]).toContain("7-import-external-candidates.ts");
    expect(pkg.scripts["build:db:with-external"]).toContain("8-verify-external-nodes.ts");
    expect(pkg.scripts["import:external-candidates"]).toContain("7-import-external-candidates.ts");
    expect(pkg.scripts["verify:external-nodes"]).toContain("8-verify-external-nodes.ts");
    expect(pkg.scripts["build:knowledge"]).not.toContain("external");

    for (const file of requiredFiles) {
      expect(existsSync(resolve(process.cwd(), file)), `missing ${file}`).toBe(true);
      expect(() => execFileSync("git", ["ls-files", "--error-unmatch", `tools/n8n-knowledge-mcp/${file}`], {
        cwd: resolve(process.cwd(), "../.."),
        stdio: "ignore",
      }), `untracked ${file}`).not.toThrow();
    }
  });

  it.each([
    ["scripts/7-import-external-candidates.ts", importCompiled],
    ["scripts/8-verify-external-nodes.ts", verifyCompiled],
  ])("runs the %s help path without a database or external checkout", (_file, compiled) => {
    const result = spawnSync(
      process.execPath,
      [compiled, "--help"],
      { cwd: packageRoot, encoding: "utf8" },
    );

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/Usage:/);
  });

  it("creates candidate schema on a fresh official database and imports idempotently with FTS parity", () => {
    const fixture = createImportFixture([{ node_type: "n8n-nodes-fixture.example" }]);

    const first = runImporter(fixture.root, fixture.externalPath);
    expect(first.status, first.stderr).toBe(0);
    const second = runImporter(fixture.root, fixture.externalPath);
    expect(second.status, second.stderr).toBe(0);

    const db = new Database(fixture.localPath, { readonly: true });
    const tables = db.prepare(`
      SELECT name FROM sqlite_master
      WHERE name IN ('external_node_candidates', 'external_node_candidates_fts')
      ORDER BY name
    `).all() as Array<{ name: string }>;
    const candidates = db.prepare(
      "SELECT node_type FROM external_node_candidates ORDER BY node_type",
    ).all() as Array<{ node_type: string }>;
    const ftsCandidates = db.prepare(
      "SELECT node_type FROM external_node_candidates_fts ORDER BY node_type",
    ).all() as Array<{ node_type: string }>;
    db.close();

    expect(tables.map((row) => row.name)).toEqual([
      "external_node_candidates",
      "external_node_candidates_fts",
    ]);
    expect(candidates.map((row) => row.node_type)).toEqual(["n8n-nodes-fixture.example"]);
    expect(ftsCandidates).toEqual(candidates);
  });

  it.each(["properties_schema", "credentials_required", "operations"] as const)(
    "rejects malformed %s JSON without inserting or promoting the candidate",
    (field) => {
      const fixture = createImportFixture([{
        node_type: `n8n-nodes-fixture.bad-${field}`,
        [field]: "{not-json",
      }]);

      const imported = runImporter(fixture.root, fixture.externalPath);
      expect(imported.status).not.toBe(0);
      expect(imported.stderr).toContain(`n8n-nodes-fixture.bad-${field}`);
      expect(imported.stderr).toContain(field);

      const verified = runVerifier(fixture.root);
      expect(verified.status, verified.stderr).toBe(0);

      const db = new Database(fixture.localPath, { readonly: true });
      expect(db.prepare("SELECT COUNT(*) AS count FROM external_node_candidates").get())
        .toEqual({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM external_node_candidates_fts").get())
        .toEqual({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM verified_external_nodes").get())
        .toEqual({ count: 0 });
      expect(db.prepare("SELECT COUNT(*) AS count FROM verified_external_nodes_fts").get())
        .toEqual({ count: 0 });
      db.close();
    },
  );

  it.each([
    ["properties_schema", ""],
    ["properties_schema", "   \t"],
    ["credentials_required", ""],
    ["credentials_required", "   \t"],
    ["operations", ""],
    ["operations", "   \t"],
  ] as const)(
    "rejects empty or whitespace-only %s JSON (%j), rolls back, and does not promote it",
    (field, value) => {
      const fixture = createImportedFixture();

      const invalidNodeType = `n8n-nodes-fixture.bad-${field}`;
      const external = new Database(fixture.externalPath);
      external.prepare(`UPDATE nodes SET node_type = ?, ${field} = ?`)
        .run(invalidNodeType, value);
      external.close();

      const imported = runImporter(fixture.root, fixture.externalPath);
      expect(imported.status).not.toBe(0);
      expect(imported.stderr).toContain(invalidNodeType);
      expect(imported.stderr).toContain(field);

      const verified = runVerifier(fixture.root);
      expect(verified.status, verified.stderr).toBe(0);

      const db = new Database(fixture.localPath, { readonly: true });
      for (const table of [
        "external_node_candidates",
        "external_node_candidates_fts",
        "verified_external_nodes",
        "verified_external_nodes_fts",
      ]) {
        expect(db.prepare(`SELECT node_type FROM ${table} ORDER BY node_type`).all())
          .toEqual([{ node_type: "n8n-nodes-fixture.previous" }]);
      }
      db.close();
    },
  );

  it("rolls back candidate and FTS replacement when a later insert fails", () => {
    const fixture = createImportedFixture();

    const external = new Database(fixture.externalPath);
    external.exec("DELETE FROM nodes");
    const insertDuplicate = external.prepare(`
      INSERT INTO nodes VALUES (
        'n8n-nodes-fixture.replacement', 'n8n-nodes-fixture', 'Replacement',
        'Fixture node', 'Transform', '1', 'Fixture docs', '[]', '[]', '[]',
        0, 0, 0, 0, NULL, 1, 1, 'n8n-nodes-fixture', '1.0.0', 100,
        'Fixture Author', 'https://example.test/author', 'programmatic'
      )
    `);
    insertDuplicate.run();
    insertDuplicate.run();
    external.close();

    const replacement = runImporter(fixture.root, fixture.externalPath);
    expect(replacement.status).not.toBe(0);

    const db = new Database(fixture.localPath, { readonly: true });
    const candidates = db.prepare(
      "SELECT node_type FROM external_node_candidates ORDER BY node_type",
    ).all() as Array<{ node_type: string }>;
    const ftsCandidates = db.prepare(
      "SELECT node_type FROM external_node_candidates_fts ORDER BY node_type",
    ).all() as Array<{ node_type: string }>;
    db.close();

    expect(candidates).toEqual([{ node_type: "n8n-nodes-fixture.previous" }]);
    expect(ftsCandidates).toEqual(candidates);
  });
});
