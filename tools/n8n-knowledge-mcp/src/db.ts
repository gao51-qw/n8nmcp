// src/db.ts — better-sqlite3 wrapper, single shared instance
import Database from "better-sqlite3";
import { resolve } from "node:path";

const DB_PATH = process.env.DB_PATH ?? resolve(process.cwd(), "data/nodes.db");

export const db = new Database(DB_PATH, { readonly: true, fileMustExist: true });
db.pragma("journal_mode = WAL");
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

export function statsCount() {
  return {
    total: (db.prepare("SELECT COUNT(*) c FROM nodes").get() as { c: number }).c,
    ai_tools: (db.prepare("SELECT COUNT(*) c FROM nodes WHERE is_ai_tool=1").get() as { c: number }).c,
    triggers: (db.prepare("SELECT COUNT(*) c FROM nodes WHERE is_trigger=1").get() as { c: number }).c,
    webhooks: (db.prepare("SELECT COUNT(*) c FROM nodes WHERE is_webhook=1").get() as { c: number }).c,
  };
}
