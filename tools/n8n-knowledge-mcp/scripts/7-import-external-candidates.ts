// scripts/7-import-external-candidates.ts
// Import third-party node metadata as external candidates without modifying the
// official `nodes` table. These candidates are discoverable but not treated as
// verified production schemas.
import Database from "better-sqlite3";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const LOCAL_DB = resolve(process.cwd(), "data/nodes.db");
const DEFAULT_EXTERNAL_DB = resolve(process.cwd(), "../../n8n-mcp-main/data/nodes.db");
const EXTERNAL_DB = process.env.EXTERNAL_N8N_MCP_DB
  ? resolve(process.env.EXTERNAL_N8N_MCP_DB)
  : DEFAULT_EXTERNAL_DB;
const SOURCE = "czlonkowski/n8n-mcp";

type ExternalNode = {
  node_type: string;
  package_name: string;
  display_name: string;
  description: string | null;
  category: string | null;
  version: string | null;
  documentation: string | null;
  properties_schema: string | null;
  operations: string | null;
  credentials_required: string | null;
  is_ai_tool: number | null;
  is_trigger: number | null;
  is_webhook: number | null;
  is_tool_variant: number | null;
  tool_variant_of: string | null;
  is_community: number | null;
  is_verified: number | null;
  npm_package_name: string | null;
  npm_version: string | null;
  npm_downloads: number | null;
  author_name: string | null;
  author_github_url: string | null;
  development_style: string | null;
};

function normalizeExternalType(type: string): string {
  if (type.startsWith("nodes-base.")) return type.slice("nodes-base.".length);
  if (type.startsWith("nodes-langchain.")) return type.slice("nodes-langchain.".length);
  if (type.startsWith("@n8n/n8n-nodes-langchain.")) {
    return type.slice("@n8n/n8n-nodes-langchain.".length);
  }
  const scoped = type.match(/^(@[^/]+\/n8n-nodes-[^.]+)\.(.+)$/);
  if (scoped) return scoped[2] ?? type;
  const unscoped = type.match(/^(n8n-nodes-[^.]+)\.(.+)$/);
  return unscoped ? (unscoped[2] ?? type) : type;
}

function normalizeToolVariantOf(value: string | null): string | null {
  return value ? normalizeExternalType(value) : null;
}

function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function candidateKind(row: ExternalNode, officialNodeTypes: Set<string>): string | null {
  const normalized = normalizeExternalType(row.node_type);
  const normalizedBase = normalizeToolVariantOf(row.tool_variant_of);

  if (row.is_community) return "community";
  if (row.is_tool_variant && (!normalizedBase || officialNodeTypes.has(normalizedBase))) {
    return "tool_variant";
  }
  if (!officialNodeTypes.has(normalized)) return "external_official_missing";

  return null;
}

function verificationStatus(row: ExternalNode, kind: string): string {
  if (kind === "community") {
    return row.is_verified ? "external-verified-candidate" : "external-unverified";
  }
  if (kind === "tool_variant") return "external-tool-variant-candidate";
  return "external-reference-only";
}

function main() {
  if (!existsSync(EXTERNAL_DB)) {
    throw new Error(`External n8n-mcp nodes.db not found: ${EXTERNAL_DB}`);
  }

  const local = new Database(LOCAL_DB);
  const external = new Database(EXTERNAL_DB, { readonly: true });

  const officialNodeTypes = new Set(
    (
      local
        .prepare(
          `SELECT node_type FROM nodes
            WHERE package_name IN ('n8n-nodes-base', '@n8n/n8n-nodes-langchain')`,
        )
        .all() as Array<{ node_type: string }>
    ).map((row) => row.node_type),
  );

  local.exec(`
    DELETE FROM external_node_candidates;
    DELETE FROM external_node_candidates_fts;
  `);

  const insert = local.prepare(`
    INSERT INTO external_node_candidates(
      source, package_name, node_type, normalized_node_type, display_name,
      description, category, version, candidate_kind, verification_status,
      is_ai_tool, is_trigger, is_webhook, is_tool_variant,
      tool_variant_of, normalized_tool_variant_of,
      is_community, is_verified, npm_package_name, npm_version, npm_downloads,
      properties_json, credentials_json, documentation, operations_json,
      source_metadata_json, imported_at
    ) VALUES (
      @source, @package_name, @node_type, @normalized_node_type, @display_name,
      @description, @category, @version, @candidate_kind, @verification_status,
      @is_ai_tool, @is_trigger, @is_webhook, @is_tool_variant,
      @tool_variant_of, @normalized_tool_variant_of,
      @is_community, @is_verified, @npm_package_name, @npm_version, @npm_downloads,
      @properties_json, @credentials_json, @documentation, @operations_json,
      @source_metadata_json, @imported_at
    )
  `);
  const insertFts = local.prepare(`
    INSERT INTO external_node_candidates_fts(
      node_type, normalized_node_type, display_name, description, package_name, documentation
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);

  const rows = external
    .prepare(
      `SELECT node_type, package_name, display_name, description, category, version,
              documentation, properties_schema, operations, credentials_required,
              is_ai_tool, is_trigger, is_webhook, is_tool_variant, tool_variant_of,
              is_community, is_verified, npm_package_name, npm_version, npm_downloads,
              author_name, author_github_url, development_style
         FROM nodes`,
    )
    .all() as ExternalNode[];

  const summary = {
    external_rows: rows.length,
    imported: 0,
    skipped_official_duplicates: 0,
    community: 0,
    verified_community: 0,
    tool_variant: 0,
    external_official_missing: 0,
  };
  const now = new Date().toISOString();

  const tx = local.transaction(() => {
    for (const row of rows) {
      const kind = candidateKind(row, officialNodeTypes);
      if (!kind) {
        summary.skipped_official_duplicates++;
        continue;
      }

      const normalized = normalizeExternalType(row.node_type);
      const normalizedBase = normalizeToolVariantOf(row.tool_variant_of);
      const properties = JSON.stringify(parseJsonArray(row.properties_schema));
      const credentials = JSON.stringify(parseJsonArray(row.credentials_required));
      const operations = JSON.stringify(parseJsonArray(row.operations));
      const metadata = JSON.stringify({
        author_name: row.author_name,
        author_github_url: row.author_github_url,
        development_style: row.development_style,
      });

      insert.run({
        source: SOURCE,
        package_name: row.package_name,
        node_type: row.node_type,
        normalized_node_type: normalized,
        display_name: row.display_name,
        description: row.description,
        category: row.category,
        version: row.version ?? "1",
        candidate_kind: kind,
        verification_status: verificationStatus(row, kind),
        is_ai_tool: row.is_ai_tool ? 1 : 0,
        is_trigger: row.is_trigger ? 1 : 0,
        is_webhook: row.is_webhook ? 1 : 0,
        is_tool_variant: row.is_tool_variant ? 1 : 0,
        tool_variant_of: row.tool_variant_of,
        normalized_tool_variant_of: normalizedBase,
        is_community: row.is_community ? 1 : 0,
        is_verified: row.is_verified ? 1 : 0,
        npm_package_name: row.npm_package_name,
        npm_version: row.npm_version,
        npm_downloads: row.npm_downloads ?? 0,
        properties_json: properties,
        credentials_json: credentials,
        documentation: row.documentation,
        operations_json: operations,
        source_metadata_json: metadata,
        imported_at: now,
      });
      insertFts.run(
        row.node_type,
        normalized,
        row.display_name,
        row.description ?? "",
        row.package_name,
        row.documentation ?? "",
      );

      summary.imported++;
      if (kind === "community") summary.community++;
      if (kind === "community" && row.is_verified) summary.verified_community++;
      if (kind === "tool_variant") summary.tool_variant++;
      if (kind === "external_official_missing") summary.external_official_missing++;
    }
  });
  tx();

  external.close();
  local.close();
  console.log(`[external] imported ${summary.imported} candidates from ${EXTERNAL_DB}`);
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv.includes("--help")) {
  console.log("Usage: npm run import:external-candidates [-- --help]");
  console.log("Set EXTERNAL_N8N_MCP_DB to a local external candidate SQLite database.");
} else {
  main();
}
