// scripts/2-parse-nodes.ts
// Parse the downloaded package index and write the de-duplicated node rows.
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  parseNodePackage,
  type NodePackageReference,
  type ParsedNode,
} from "../src/node-package-parser.js";

const TMP = resolve(process.cwd(), ".tmp/pkgs");
const OUT = resolve(TMP, "_nodes.json");

async function main() {
  const index = JSON.parse(
    await readFile(join(TMP, "_index.json"), "utf8"),
  ) as NodePackageReference[];
  const all: ParsedNode[] = [];
  const seen = new Set<string>();

  for (const pkg of index) {
    const result = await parseNodePackage(pkg);
    for (const failure of result.failures) {
      console.warn(`[parse] ${pkg.name}:${failure.sourcePath}: ${failure.message}`);
    }
    let added = 0;
    for (const node of result.nodes) {
      const key = `${node.package_name}::${node.node_type}`;
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(node);
      added += 1;
    }
    const expected = result.expectedNodeCount === null ? "" : `/${result.expectedNodeCount}`;
    console.log(`[parse] ${pkg.name} (${pkg.source}) -> ${added}${expected} nodes`);
  }

  await writeFile(OUT, JSON.stringify(all));
  console.log(`[parse] total ${all.length} nodes → ${OUT}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
