// scripts/2-parse-nodes.ts
// Walk every package's dist/ for *.node.js / *.node.json, extract n8n node descriptions.
// We parse the COMPILED JS rather than ts source — npm tarballs ship dist/ with
// the description object as a plain JS literal we can require() in a sandbox.
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, basename, relative } from "node:path";
import { pathToFileURL } from "node:url";

const TMP = resolve(process.cwd(), ".tmp/pkgs");
const OUT = resolve(TMP, "_nodes.json");

type ParsedNode = {
  node_type: string;
  package_name: string;
  display_name: string;
  description: string | null;
  category: string | null;
  version: string;
  is_ai_tool: 0 | 1;
  is_trigger: 0 | 1;
  is_webhook: 0 | 1;
  properties_json: string;
  credentials_json: string;
  source_path: string;
  source_excerpt: string;
};

async function* walk(dir: string): AsyncGenerator<string> {
  for (const ent of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === "node_modules" || ent.name.startsWith(".")) continue;
      yield* walk(p);
    } else yield p;
  }
}

function isAiTool(desc: any): 0 | 1 {
  if (desc?.usableAsTool) return 1;
  const codex = desc?.codex?.categories;
  if (Array.isArray(codex) && codex.includes("AI")) return 1;
  return 0;
}

function categoryOf(desc: any): string | null {
  if (Array.isArray(desc?.group) && desc.group.length) return String(desc.group[0]);
  if (typeof desc?.group === "string") return desc.group;
  const cats = desc?.codex?.categories;
  if (Array.isArray(cats) && cats.length) return String(cats[0]);
  return null;
}

async function loadNodeDescription(file: string): Promise<any | null> {
  try {
    if (file.endsWith(".node.json")) {
      const txt = await readFile(file, "utf8");
      return JSON.parse(txt);
    }
    // *.node.js: dynamic import in a try/catch — many n8n nodes import
    // siblings (.helpers etc.) that resolve fine relatively.
    const mod = await import(pathToFileURL(file).href);
    // n8n nodes export class with .description, or default export class.
    for (const key of Object.keys(mod)) {
      const cls = (mod as any)[key];
      if (typeof cls !== "function") continue;
      try {
        const inst = new cls();
        if (inst?.description?.name) return inst.description;
      } catch {
        // some nodes throw in constructor without args; try prototype
        const proto = cls.prototype?.description;
        if (proto?.name) return proto;
      }
    }
    if ((mod as any).default?.description?.name) return (mod as any).default.description;
    return null;
  } catch {
    return null;
  }
}

async function processPackage(pkg: { name: string; version: string; dir: string }): Promise<ParsedNode[]> {
  const out: ParsedNode[] = [];
  if (!existsSync(pkg.dir)) return out;
  for await (const file of walk(pkg.dir)) {
    if (!/\.node\.(js|json)$/.test(file)) continue;
    const desc = await loadNodeDescription(file);
    if (!desc?.name) continue;
    const props = Array.isArray(desc.properties) ? desc.properties : [];
    const creds = Array.isArray(desc.credentials) ? desc.credentials : [];
    let excerpt = "";
    try {
      excerpt = (await readFile(file, "utf8")).slice(0, 50_000);
    } catch {}
    out.push({
      node_type: String(desc.name),
      package_name: pkg.name,
      display_name: String(desc.displayName ?? desc.name),
      description: desc.description ? String(desc.description) : null,
      category: categoryOf(desc),
      version: String(Array.isArray(desc.version) ? desc.version.at(-1) : desc.version ?? "1"),
      is_ai_tool: isAiTool(desc),
      is_trigger: /Trigger$/.test(String(desc.name)) || desc.polling ? 1 : 0,
      is_webhook: Array.isArray(desc.webhooks) && desc.webhooks.length ? 1 : 0,
      properties_json: JSON.stringify(props),
      credentials_json: JSON.stringify(creds),
      source_path: relative(pkg.dir, file),
      source_excerpt: excerpt,
    });
  }
  return out;
}

async function main() {
  const index = JSON.parse(await readFile(join(TMP, "_index.json"), "utf8")) as Array<{
    name: string;
    version: string;
    dir: string;
  }>;
  const all: ParsedNode[] = [];
  const seen = new Set<string>();
  for (const pkg of index) {
    const nodes = await processPackage(pkg);
    let added = 0;
    for (const n of nodes) {
      const key = `${n.package_name}::${n.node_type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(n);
      added++;
    }
    console.log(`[parse] ${pkg.name} → ${added} nodes`);
  }
  await writeFile(OUT, JSON.stringify(all));
  console.log(`[parse] total ${all.length} nodes → ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
