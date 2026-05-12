// scripts/6-emit-stats.ts
// Read data/nodes.db and write a small public stats JSON used by the marketing site.
// Output: data/stats.json AND ../../src/data/n8n-stats.json (committed to the repo).
import Database from "better-sqlite3";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";

const DB_PATH = resolve(process.cwd(), "data/nodes.db");
const LOCAL_OUT = resolve(process.cwd(), "data/stats.json");
const REPO_OUT = resolve(process.cwd(), "../../src/data/n8n-stats.json");

const OFFICIAL_PACKAGES = new Set(["n8n-nodes-base", "@n8n/n8n-nodes-langchain"]);

function pickInt(row: unknown): number {
  return Number((row as { c?: number } | undefined)?.c ?? 0);
}

async function main() {
  const db = new Database(DB_PATH, { readonly: true });

  const total = pickInt(db.prepare("SELECT COUNT(*) c FROM nodes").get());
  const aiTools = pickInt(
    db.prepare("SELECT COUNT(*) c FROM nodes WHERE is_ai_tool = 1").get(),
  );
  const triggers = pickInt(
    db.prepare("SELECT COUNT(*) c FROM nodes WHERE is_trigger = 1").get(),
  );

  const placeholders = [...OFFICIAL_PACKAGES].map(() => "?").join(",");
  const coreNodes = pickInt(
    db
      .prepare(`SELECT COUNT(*) c FROM nodes WHERE package_name IN (${placeholders})`)
      .get(...OFFICIAL_PACKAGES),
  );
  const communityNodes = total - coreNodes;

  const communityPackages = pickInt(
    db
      .prepare(
        `SELECT COUNT(DISTINCT package_name) c FROM nodes WHERE package_name NOT IN (${placeholders})`,
      )
      .get(...OFFICIAL_PACKAGES),
  );

  db.close();

  const stats = {
    totalNodes: total,
    coreNodes,
    communityNodes,
    communityPackages,
    aiTools,
    triggers,
    generatedAt: new Date().toISOString(),
  };

  const json = JSON.stringify(stats, null, 2);
  await mkdir(dirname(LOCAL_OUT), { recursive: true });
  await writeFile(LOCAL_OUT, json);
  await mkdir(dirname(REPO_OUT), { recursive: true });
  await writeFile(REPO_OUT, json);

  console.log(
    `[stats] total=${total} core=${coreNodes} community=${communityNodes} pkgs=${communityPackages} ai=${aiTools}`,
  );
  console.log(`[stats] wrote ${LOCAL_OUT}`);
  console.log(`[stats] wrote ${REPO_OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});