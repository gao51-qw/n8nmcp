# Official Node Static Parser Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build complete official n8n node knowledge without installing official package runtime dependencies or silently dropping nodes when compiled JavaScript imports fail.

**Architecture:** For official packages, read `dist/types/nodes.json` as the complete description source and `dist/known/nodes.json` as the authoritative name/source-path manifest. Select the highest-version description for each name, require exact name-set parity, and read source excerpts as text without importing official JavaScript. Keep the current legacy loader only for community packages, but return and log its per-file failures instead of swallowing them.

**Tech Stack:** TypeScript, Node.js 20, Vitest, n8n npm package metadata.

## Global Constraints

- Official node knowledge comes from the `n8n-io/n8n` GitHub registry packages listed in `packages.json`.
- Official package JavaScript must not be executed during the knowledge build.
- Do not install `n8n-workflow`, the official packages' dependency trees, or any new package dependency to parse official metadata.
- Every name in an official package's `dist/known/nodes.json` must have at least one description in `dist/types/nodes.json`; extra description names also fail the build.
- Duplicate description rows for one name must collapse to the row with the highest effective version, where an array version uses its last element.
- Missing, malformed, or mismatched official metadata is a build error that identifies the package and missing/extra names.
- Community enrichment keeps its existing dynamic-import fallback, but every import failure must be returned to the caller and logged with package and source path.
- The official-only selector and production wiring from the prior release plan remain unchanged.
- Tests and TypeScript checks run under Node 20.
- No generated databases, templates, GHCR tags, or VPS state are part of this code task.

---

### Task 8: Parse Official Nodes from Shipped Static Metadata

**Files:**
- Create: `tools/n8n-knowledge-mcp/src/node-package-parser.ts`
- Create: `tools/n8n-knowledge-mcp/src/node-package-parser.test.ts`
- Modify: `tools/n8n-knowledge-mcp/scripts/2-parse-nodes.ts`
- Modify: `tools/n8n-knowledge-mcp/src/build-artifact-contract.test.ts`

**Interfaces:**
- Consumes: `_index.json` entries shaped as `NodePackageReference` with `name`, `version`, `dir`, and `source`.
- Produces: `parseNodePackage(pkg: NodePackageReference): Promise<NodePackageParseResult>`.
- Produces: `NodePackageParseResult` with `nodes`, `expectedNodeCount`, and `failures`.
- Produces: the existing `_nodes.json` row shape through exported `ParsedNode`.

- [ ] **Step 1: Write the failing parser tests**

Create `src/node-package-parser.test.ts` with real temporary directories and no module mocks. The tests must create metadata with `mkdir`/`writeFile`, call the real parser, and clean up with `afterEach`.

The official fixture must contain:

```json
// dist/known/nodes.json
{
  "httpRequest": {
    "className": "HttpRequest",
    "sourcePath": "dist/nodes/HttpRequest/HttpRequest.node.js"
  }
}
```

```json
// dist/types/nodes.json
[
  {
    "displayName": "HTTP Request",
    "name": "httpRequest",
    "group": ["transform"],
    "version": 1,
    "description": "Makes an HTTP request",
    "defaults": { "name": "HTTP Request" },
    "credentials": [{ "name": "httpBasicAuth" }],
    "inputs": ["main"],
    "outputs": ["main"],
    "properties": [{ "displayName": "URL", "name": "url", "type": "string", "default": "", "required": true }]
  }
]
```

Write the referenced `.node.js` as:

```js
throw new Error("official node JavaScript must not execute");
```

Cover these behaviors:

```ts
it("parses complete official metadata without executing node JavaScript", async () => {
  const result = await parseNodePackage(officialPackage(root));
  expect(result.expectedNodeCount).toBe(1);
  expect(result.failures).toEqual([]);
  expect(result.nodes).toHaveLength(1);
  expect(result.nodes[0]).toMatchObject({
    node_type: "httpRequest",
    package_name: "n8n-nodes-base",
    display_name: "HTTP Request",
    version: "1",
    source_path: "dist/nodes/HttpRequest/HttpRequest.node.js",
  });
});

it("selects the highest effective version for duplicate description rows", async () => {
  // Write rows for the same name with versions 1 and [1, 2].
  const result = await parseNodePackage(officialPackage(root));
  expect(result.nodes).toHaveLength(1);
  expect(result.nodes[0]?.version).toBe("2");
  expect(result.nodes[0]?.display_name).toBe("HTTP Request v2");
});

it("rejects an incomplete official description set", async () => {
  // Add `webhook` to known/nodes.json without adding a matching type row.
  await expect(parseNodePackage(officialPackage(root))).rejects.toThrow(
    /n8n-nodes-base.*expected=2.*parsed=1.*missing=webhook/i,
  );
});

it("surfaces community dynamic-import failures", async () => {
  // A community `.node.js` imports a deliberately absent package.
  const result = await parseNodePackage(communityPackage(root));
  expect(result.nodes).toEqual([]);
  expect(result.failures).toHaveLength(1);
  expect(result.failures[0]).toMatchObject({ sourcePath: "Broken.node.js" });
  expect(result.failures[0]?.message).toMatch(/cannot find package|ERR_MODULE_NOT_FOUND/i);
});
```

Extend `src/build-artifact-contract.test.ts` to read `scripts/2-parse-nodes.ts` and assert that it imports/calls `parseNodePackage`, includes `pkg.source`, and no longer owns `pathToFileURL` or a dynamic `import()`.

- [ ] **Step 2: Run the focused tests and verify RED**

```powershell
npx.cmd --yes node@20 ./node_modules/vitest/vitest.mjs run src/node-package-parser.test.ts src/build-artifact-contract.test.ts --maxWorkers=1
```

Expected: FAIL because `src/node-package-parser.ts` and the new production wiring do not exist. Confirm the failure is not a fixture or syntax error.

- [ ] **Step 3: Implement the static official parser**

Create `src/node-package-parser.ts` and export these types:

```ts
export type NodePackageReference = {
  name: string;
  version: string;
  dir: string;
  source: "official" | "community";
};

export type NodeParseFailure = {
  sourcePath: string;
  message: string;
};

export type NodePackageParseResult = {
  nodes: ParsedNode[];
  expectedNodeCount: number | null;
  failures: NodeParseFailure[];
};
```

Keep `ParsedNode` identical to the current row shape in `scripts/2-parse-nodes.ts` and export it from the new module.

For `source === "official"`:

1. Read and JSON-parse `dist/known/nodes.json` and `dist/types/nodes.json`.
2. Validate that known metadata is a non-array object whose entries contain a non-empty `sourcePath`, and type metadata is an array whose rows contain a non-empty `name`.
3. Compute an effective version as the final array element or scalar `version`, defaulting to `1`; compare numeric values when finite and otherwise retain the later row.
4. Build one description per name, then compare sorted known/type name sets.
5. Throw one error containing `package`, `expected`, `parsed`, `missing`, and `extra` when the sets differ.
6. Map names in sorted manifest order to `ParsedNode`, reading the referenced source file only as UTF-8 text and truncating `source_excerpt` to 50,000 characters.
7. Return `{ nodes, expectedNodeCount: knownNames.length, failures: [] }` and assert `nodes.length === expectedNodeCount` before returning.

Use the existing `isAiTool`, `categoryOf`, version formatting, trigger/webhook detection, property serialization, and credential serialization behavior unchanged.

For `source === "community"`, move the current walk/dynamic-import path into the new module. Replace the outer silent catch with a result carrying the exact relative `sourcePath` and `error instanceof Error ? error.message : String(error)`. Constructor failures may still try the prototype, but a module import failure must never become an unreported `null`.

- [ ] **Step 4: Wire the build script and visible diagnostics**

Reduce `scripts/2-parse-nodes.ts` to orchestration:

```ts
import { parseNodePackage, type NodePackageReference, type ParsedNode } from "../src/node-package-parser.js";

const index = JSON.parse(await readFile(join(TMP, "_index.json"), "utf8")) as NodePackageReference[];
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
  console.log(`[parse] ${pkg.name} -> ${added}${expected} nodes`);
}
```

Keep the existing output path, JSON format, de-duplication key, total log, top-level error handling, and non-zero exit behavior.

- [ ] **Step 5: Verify GREEN and regression safety**

```powershell
npx.cmd --yes node@20 ./node_modules/vitest/vitest.mjs run src/node-package-parser.test.ts src/build-artifact-contract.test.ts --maxWorkers=1
npx.cmd --yes node@20 ./node_modules/vitest/vitest.mjs run --maxWorkers=1
npx.cmd --yes node@20 ./node_modules/typescript/bin/tsc -p tsconfig.json
git diff --check
```

Expected: focused tests PASS; the complete Knowledge suite has zero failures; TypeScript and diff check exit 0. No network, package install, generated database, or downloaded official package is required for these tests.

- [ ] **Step 6: Commit**

```powershell
git add -- tools/n8n-knowledge-mcp/src/node-package-parser.ts tools/n8n-knowledge-mcp/src/node-package-parser.test.ts tools/n8n-knowledge-mcp/scripts/2-parse-nodes.ts tools/n8n-knowledge-mcp/src/build-artifact-contract.test.ts
git commit -m "fix(knowledge): parse official node metadata statically"
```
