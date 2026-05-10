// scripts/3-parse-docs.ts
// Clone n8n-io/n8n-docs (shallow), match markdown files to node_types,
// emit .tmp/pkgs/_docs.json keyed by node_type.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";

const exec = promisify(execFile);
const TMP = resolve(process.cwd(), ".tmp");
const REPO = join(TMP, "n8n-docs");
const OUT = resolve(TMP, "pkgs/_docs.json");

async function ensureRepo() {
  if (existsSync(join(REPO, ".git"))) {
    console.log("[docs] repo exists, pulling...");
    await exec("git", ["-C", REPO, "pull", "--ff-only"], { maxBuffer: 1 << 28 });
  } else {
    console.log("[docs] cloning n8n-docs (shallow)...");
    await exec("git", ["clone", "--depth=1", "https://github.com/n8n-io/n8n-docs.git", REPO], {
      maxBuffer: 1 << 28,
    });
  }
}

async function* walk(dir: string): AsyncGenerator<string> {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name.startsWith(".")) continue;
      yield* walk(p);
    } else yield p;
  }
}

// Extract node_type from path like:
// docs/integrations/builtin/app-nodes/n8n-nodes-base.airtable/index.md
function nodeTypeFromPath(p: string): string | null {
  const m = p.match(/n8n-nodes-base\.([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function extractExamples(md: string): string[] {
  const out: string[] = [];
  const re = /```(?:json|javascript|js|ts)?\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) && out.length < 20) out.push(m[1].trim());
  return out;
}

async function main() {
  await ensureRepo();
  const root = join(REPO, "docs/integrations/builtin");
  if (!existsSync(root)) {
    console.warn("[docs] expected path missing; skipping doc enrichment");
    await writeFile(OUT, "{}");
    return;
  }
  const docs: Record<string, { documentation: string; examples_json: string }> = {};
  for await (const file of walk(root)) {
    if (!file.endsWith(".md")) continue;
    const nt = nodeTypeFromPath(file);
    if (!nt) continue;
    const md = await readFile(file, "utf8");
    const prev = docs[nt]?.documentation ?? "";
    docs[nt] = {
      documentation: (prev + "\n\n" + md).slice(0, 200_000),
      examples_json: JSON.stringify(extractExamples(md)),
    };
  }
  await writeFile(OUT, JSON.stringify(docs));
  console.log(`[docs] matched ${Object.keys(docs).length} node_types → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
