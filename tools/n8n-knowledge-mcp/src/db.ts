// src/db.ts — better-sqlite3 wrapper, single shared instance
import Database from "better-sqlite3";
import { resolve } from "node:path";

const DB_PATH = process.env.DB_PATH ?? resolve(process.cwd(), "data/nodes.db");

export const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
db.pragma("query_only = true");

export type NodeRow = {
  node_type: string;
  package_name: string;
  display_name: string;
  description: string | null;
  category: string | null;
  version: string;
  is_ai_tool: number;
  is_trigger: number;
  is_webhook: number;
  properties_json: string;
  essentials_json: string;
  credentials_json: string;
  documentation: string | null;
  examples_json: string;
  source_excerpt: string | null;
  updated_at: string;
};

export type ExternalNodeCandidateRow = {
  source: string;
  package_name: string;
  node_type: string;
  normalized_node_type: string;
  display_name: string;
  description: string | null;
  category: string | null;
  version: string | null;
  candidate_kind: "community" | "tool_variant" | "external_official_missing";
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
  imported_at: string;
};

export type VerifiedExternalNodeRow = ExternalNodeCandidateRow & {
  validation_warnings_json: string;
  validated_at: string;
};

function tableExists(name: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(name);
}

export function statsCount() {
  const hasExternalCandidates = tableExists("external_node_candidates");
  const hasVerifiedExternalNodes = tableExists("verified_external_nodes");
  return {
    total: safeCount("SELECT COUNT(*) c FROM nodes"),
    ai_tools: safeCount("SELECT COUNT(*) c FROM nodes WHERE is_ai_tool=1"),
    triggers: safeCount("SELECT COUNT(*) c FROM nodes WHERE is_trigger=1"),
    webhooks: safeCount("SELECT COUNT(*) c FROM nodes WHERE is_webhook=1"),
    templates: safeCount("SELECT COUNT(*) c FROM templates"),
    external_candidates: hasExternalCandidates
      ? safeCount("SELECT COUNT(*) c FROM external_node_candidates")
      : 0,
    external_community_candidates: hasExternalCandidates
      ? safeCount("SELECT COUNT(*) c FROM external_node_candidates WHERE candidate_kind='community'")
      : 0,
    external_tool_variant_candidates: hasExternalCandidates
      ? safeCount("SELECT COUNT(*) c FROM external_node_candidates WHERE candidate_kind='tool_variant'")
      : 0,
    verified_external_nodes: hasVerifiedExternalNodes
      ? safeCount("SELECT COUNT(*) c FROM verified_external_nodes")
      : 0,
    verified_external_community_nodes: hasVerifiedExternalNodes
      ? safeCount("SELECT COUNT(*) c FROM verified_external_nodes WHERE candidate_kind='community'")
      : 0,
    verified_external_tool_variant_nodes: hasVerifiedExternalNodes
      ? safeCount("SELECT COUNT(*) c FROM verified_external_nodes WHERE candidate_kind='tool_variant'")
      : 0,
  };
}

function safeCount(sql: string): number {
  try {
    return (db.prepare(sql).get() as { c: number }).c;
  } catch {
    return 0;
  }
}
