// scripts/8-verify-external-nodes.ts
// Static local validation for external node candidates. This does not install npm
// packages, execute node code, or perform network/supply-chain checks.
import Database from "better-sqlite3";
import { resolve } from "node:path";
import { validateExternalNodeCandidate, type ExternalNodeCandidateValidationInput } from "../src/external-node-validation.js";

const DB_PATH = resolve(process.cwd(), "data/nodes.db");

type ExternalCandidateRow = ExternalNodeCandidateValidationInput & {
  source: string;
  package_name: string;
  node_type: string;
  normalized_node_type: string;
  display_name: string;
  description: string | null;
  category: string | null;
  version: string;
  candidate_kind: string;
  verification_status: string;
  is_ai_tool: number;
  is_trigger: number;
  is_webhook: number;
  is_tool_variant: number;
  tool_variant_of: string | null;
  normalized_tool_variant_of: string | null;
  is_community: number;
  is_verified: number;
  npm_package_name: string | null;
  npm_version: string | null;
  npm_downloads: number;
  properties_json: string;
  credentials_json: string;
  documentation: string | null;
  operations_json: string;
  source_metadata_json: string;
};

function ensureTables(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS external_node_validation_results (
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

    CREATE INDEX IF NOT EXISTS idx_external_node_validation_status
      ON external_node_validation_results(validation_status);

    CREATE TABLE IF NOT EXISTS verified_external_nodes (
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

    CREATE INDEX IF NOT EXISTS idx_verified_external_nodes_kind ON verified_external_nodes(candidate_kind);
    CREATE INDEX IF NOT EXISTS idx_verified_external_nodes_package ON verified_external_nodes(package_name);
    CREATE INDEX IF NOT EXISTS idx_verified_external_nodes_downloads ON verified_external_nodes(npm_downloads DESC);

    CREATE VIRTUAL TABLE IF NOT EXISTS verified_external_nodes_fts USING fts5(
      node_type, normalized_node_type, display_name, description, package_name, documentation,
      tokenize='unicode61'
    );
  `);
}

function main() {
  const db = new Database(DB_PATH);
  ensureTables(db);

  const hasCandidates = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'external_node_candidates'")
    .get();
  if (!hasCandidates) {
    throw new Error("external_node_candidates table does not exist. Run import:external-candidates first.");
  }

  const officialNodeTypes = new Set(
    (
      db
        .prepare(
          `SELECT node_type FROM nodes
            WHERE package_name IN ('n8n-nodes-base', '@n8n/n8n-nodes-langchain')`,
        )
        .all() as Array<{ node_type: string }>
    ).map((row) => row.node_type),
  );

  const candidates = db.prepare("SELECT * FROM external_node_candidates").all() as ExternalCandidateRow[];
  const now = new Date().toISOString();

  const insertResult = db.prepare(`
    INSERT INTO external_node_validation_results(
      source, package_name, node_type, normalized_node_type, candidate_kind,
      validation_status, validation_errors_json, validation_warnings_json, validated_at
    ) VALUES (
      @source, @package_name, @node_type, @normalized_node_type, @candidate_kind,
      @validation_status, @validation_errors_json, @validation_warnings_json, @validated_at
    )
  `);

  const insertVerified = db.prepare(`
    INSERT INTO verified_external_nodes(
      source, package_name, node_type, normalized_node_type, display_name,
      description, category, version, candidate_kind, verification_status,
      is_ai_tool, is_trigger, is_webhook, is_tool_variant,
      tool_variant_of, normalized_tool_variant_of,
      is_community, is_verified, npm_package_name, npm_version, npm_downloads,
      properties_json, credentials_json, documentation, operations_json,
      source_metadata_json, validation_warnings_json, validated_at
    ) VALUES (
      @source, @package_name, @node_type, @normalized_node_type, @display_name,
      @description, @category, @version, @candidate_kind, @verification_status,
      @is_ai_tool, @is_trigger, @is_webhook, @is_tool_variant,
      @tool_variant_of, @normalized_tool_variant_of,
      @is_community, @is_verified, @npm_package_name, @npm_version, @npm_downloads,
      @properties_json, @credentials_json, @documentation, @operations_json,
      @source_metadata_json, @validation_warnings_json, @validated_at
    )
  `);

  const insertVerifiedFts = db.prepare(`
    INSERT INTO verified_external_nodes_fts(
      node_type, normalized_node_type, display_name, description, package_name, documentation
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const summary = {
    candidates: candidates.length,
    passed: 0,
    failed: 0,
    community_passed: 0,
    tool_variant_passed: 0,
  };

  const tx = db.transaction(() => {
    db.exec(`
      DELETE FROM external_node_validation_results;
      DELETE FROM verified_external_nodes;
      DELETE FROM verified_external_nodes_fts;
    `);

    for (const candidate of candidates) {
      const result = validateExternalNodeCandidate(candidate, officialNodeTypes);
      const validation_status = result.passed ? "passed" : "failed";
      insertResult.run({
        source: candidate.source,
        package_name: candidate.package_name,
        node_type: candidate.node_type,
        normalized_node_type: candidate.normalized_node_type,
        candidate_kind: candidate.candidate_kind,
        validation_status,
        validation_errors_json: JSON.stringify(result.errors),
        validation_warnings_json: JSON.stringify(result.warnings),
        validated_at: now,
      });

      if (!result.passed) {
        summary.failed++;
        continue;
      }

      insertVerified.run({
        ...candidate,
        validation_warnings_json: JSON.stringify(result.warnings),
        validated_at: now,
      });
      insertVerifiedFts.run(
        candidate.node_type,
        candidate.normalized_node_type,
        candidate.display_name,
        candidate.description ?? "",
        candidate.package_name,
        candidate.documentation ?? "",
      );

      summary.passed++;
      if (candidate.candidate_kind === "community") summary.community_passed++;
      if (candidate.candidate_kind === "tool_variant") summary.tool_variant_passed++;
    }
  });
  tx();

  db.close();
  console.log("[external:verify] static validation complete");
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv.includes("--help")) {
  console.log("Usage: npm run verify:external-nodes [-- --help]");
  console.log("Statically validates imported candidates in data/nodes.db without executing node code.");
} else {
  main();
}
