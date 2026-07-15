# Knowledge Final Review Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final branch review's fail-open official-package and package-root escape findings, while removing the environment-sensitive policy test and correcting parser documentation.

**Architecture:** Add a pure configured-vs-fetched official coverage assertion at the fetch publication boundary so a skipped official tarball cannot produce an index. Resolve every official metadata/source file to its real path and require it to remain inside the real unpacked package root before reading; keep community behavior unchanged.

**Tech Stack:** TypeScript, Node.js 20, Vitest, Node fs/path APIs.

## Global Constraints

- Official package metadata resolution or tarball download/extraction failures must fail closed before `_index.json` is written.
- Community package failures remain optional and may be skipped with a warning.
- Official metadata and source reads must reject both `..` traversal and symlink/junction escapes outside the unpacked package root.
- Preserve official metadata parity, source excerpts, community parsing behavior, production quality gates, and release workflow order.
- Do not execute official node JavaScript.
- Do not add dependencies or weaken any existing test/quality threshold.
- Run tests and TypeScript under Node 20.
- Do not access the network, download packages/templates, generate production databases, build images, push GHCR, or deploy VPS state.

---

### Task 12: Close Final Review Findings

**Files:**
- Modify: `tools/n8n-knowledge-mcp/src/package-fetch-policy.ts`
- Modify: `tools/n8n-knowledge-mcp/src/package-fetch-policy.test.ts`
- Modify: `tools/n8n-knowledge-mcp/scripts/1-fetch-packages.ts`
- Modify: `tools/n8n-knowledge-mcp/src/deployment-contract.test.ts`
- Modify: `tools/n8n-knowledge-mcp/src/node-package-parser.ts`
- Modify: `tools/n8n-knowledge-mcp/src/node-package-parser.test.ts`
- Modify: `tools/n8n-knowledge-mcp/README.md`

**Interfaces:**
- Produces: `assertOfficialPackageCoverage(configuredOfficial, fetched): void`.
- Produces: official package file reads that resolve target `realpath` and reject a target outside the package root.
- Preserves: `parseNodePackage(pkg)` and `shouldSkipCommunityPackages(argv, env?)` public signatures.

- [ ] **Step 1: Write failing official coverage tests**

Extend `src/package-fetch-policy.test.ts`:

```ts
import {
  assertOfficialPackageCoverage,
  shouldSkipCommunityPackages,
} from "./package-fetch-policy.js";

it("rejects a fetched index missing a configured official package", () => {
  expect(() => assertOfficialPackageCoverage(
    ["n8n-nodes-base", "@n8n/n8n-nodes-langchain"],
    [{ name: "n8n-nodes-base", source: "official" }],
  )).toThrow("Missing official packages after fetch: @n8n/n8n-nodes-langchain");
});

it("ignores optional community packages when checking official coverage", () => {
  expect(() => assertOfficialPackageCoverage(
    ["n8n-nodes-base"],
    [
      { name: "n8n-nodes-base", source: "official" },
      { name: "n8n-nodes-example", source: "community" },
    ],
  )).not.toThrow();
});
```

Remove the environment-dependent generic assertion:

```ts
expect(shouldSkipCommunityPackages(["node", "script"], "0")).toBe(false);
```

Do not pass `undefined` when the assertion expects community enrichment to remain enabled.

- [ ] **Step 2: Write failing traversal and symlink tests**

Extend `src/node-package-parser.test.ts` imports:

```ts
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { relative } from "node:path";
```

Add a helper that rewrites the known metadata source path:

```ts
async function writeKnownSourcePath(root: string, sourcePath: string) {
  await writeFile(
    join(root, "dist", "known", "nodes.json"),
    JSON.stringify({
      httpRequest: { className: "HttpRequest", sourcePath },
    }),
  );
}
```

Add:

```ts
it("rejects an official source path outside the unpacked package root", async () => {
  const root = await temporaryDirectory();
  const outside = await temporaryDirectory();
  const outsideFile = join(outside, "Outside.node.js");
  await writeOfficialFixture(root);
  await writeFile(outsideFile, "outside package root\n");
  await writeKnownSourcePath(root, relative(root, outsideFile));

  await expect(parseNodePackage(officialPackage(root))).rejects.toThrow(
    /n8n-nodes-base.*source path.*outside.*package root/i,
  );
});

it("rejects an official source symlink that escapes the unpacked package root", async () => {
  const root = await temporaryDirectory();
  const outside = await temporaryDirectory();
  await writeOfficialFixture(root);
  await writeFile(join(outside, "Outside.node.js"), "outside package root\n");
  await symlink(
    outside,
    join(root, "linked-outside"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await writeKnownSourcePath(root, "linked-outside/Outside.node.js");

  await expect(parseNodePackage(officialPackage(root))).rejects.toThrow(
    /n8n-nodes-base.*source path.*outside.*package root/i,
  );
});
```

- [ ] **Step 3: Run focused RED**

```powershell
npx.cmd --offline --yes node@20 ./node_modules/vitest/vitest.mjs run src/package-fetch-policy.test.ts src/node-package-parser.test.ts --maxWorkers=1
```

Expected: coverage tests fail because `assertOfficialPackageCoverage` does not exist; traversal and symlink tests resolve successfully instead of rejecting. Fix only fixture/platform errors until failures are for those missing safeguards.

- [ ] **Step 4: Implement official package coverage and wire it before index publication**

Add to `src/package-fetch-policy.ts`:

```ts
export type FetchedPackageIdentity = {
  name: string;
  source: "official" | "community";
};

export function assertOfficialPackageCoverage(
  configuredOfficial: readonly string[],
  fetched: readonly FetchedPackageIdentity[],
): void {
  const fetchedOfficial = new Set(
    fetched.filter((item) => item.source === "official").map((item) => item.name),
  );
  const missing = configuredOfficial.filter((name) => !fetchedOfficial.has(name));
  if (missing.length > 0) {
    throw new Error(`Missing official packages after fetch: ${missing.join(", ")}`);
  }
}
```

Import it in `scripts/1-fetch-packages.ts`. After the download/extraction loop and before creating `enriched` or writing `_index.json`, add:

```ts
assertOfficialPackageCoverage(CFG.official as string[], index);
```

In `src/deployment-contract.test.ts`, assert the production fetch script contains an invocation, not only an import:

```ts
expect(fetchScript).toMatch(
  /assertOfficialPackageCoverage\(CFG\.official as string\[\], index\)/,
);
```

- [ ] **Step 5: Implement real-path containment for official reads**

Change imports in `src/node-package-parser.ts`:

```ts
import { readFile, readdir, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
```

At the start of `parseOfficialNodePackage`:

```ts
const packageRoot = await realpath(pkg.dir);
```

Pass `packageRoot` into both metadata reads and use the same secure helper for source excerpts:

```ts
const known = validateKnownMetadata(
  await readOfficialMetadata(pkg, packageRoot, "dist/known/nodes.json"),
  pkg.name,
);
const rows = validateTypeMetadata(
  await readOfficialMetadata(pkg, packageRoot, "dist/types/nodes.json"),
  pkg.name,
);

// in the node loop
const sourceExcerpt = (
  await readOfficialPackageFile(pkg.name, packageRoot, sourcePath)
).slice(0, 50_000);
```

Implement:

```ts
async function readOfficialPackageFile(
  packageName: string,
  packageRoot: string,
  sourcePath: string,
): Promise<string> {
  const target = await realpath(resolve(packageRoot, sourcePath));
  const relativeTarget = relative(packageRoot, target);
  if (
    relativeTarget === ".."
    || relativeTarget.startsWith(`..${sep}`)
    || isAbsolute(relativeTarget)
  ) {
    throw new Error(
      `${packageName}: source path ${sourcePath} resolves outside the unpacked package root`,
    );
  }
  return await readFile(target, "utf8");
}
```

Update `readOfficialMetadata` to accept `packageRoot` and parse:

```ts
JSON.parse(await readOfficialPackageFile(pkg.name, packageRoot, metadataPath))
```

Keep its existing package/path contextual error wrapper and `cause`.

- [ ] **Step 6: Correct README parser boundaries**

Replace the architecture claim that all nodes use ts-morph/AST parsing with text that states:

```markdown
Official n8n packages are parsed from their published `dist/known/nodes.json` and
`dist/types/nodes.json` metadata without executing node JavaScript. Source excerpts
are read only after real-path containment inside the unpacked package root. The
generic community-enrichment path remains optional and may dynamically import
community node modules; production `build:knowledge` never selects that path.
```

Remove any claim that the current official parser uses a sparse GitHub clone or ts-morph.

- [ ] **Step 7: Verify GREEN**

```powershell
npx.cmd --offline --yes node@20 ./node_modules/vitest/vitest.mjs run src/package-fetch-policy.test.ts src/node-package-parser.test.ts src/deployment-contract.test.ts --maxWorkers=1
npx.cmd --offline --yes node@20 ./node_modules/vitest/vitest.mjs run --maxWorkers=1
npx.cmd --offline --yes node@20 ./node_modules/typescript/bin/tsc -p tsconfig.json
git diff --check
```

Expected: focused tests, all 210 Knowledge tests, TypeScript, and diff check pass. Confirm only the seven listed files changed.

- [ ] **Step 8: Commit**

```powershell
git add -- tools/n8n-knowledge-mcp/src/package-fetch-policy.ts tools/n8n-knowledge-mcp/src/package-fetch-policy.test.ts tools/n8n-knowledge-mcp/scripts/1-fetch-packages.ts tools/n8n-knowledge-mcp/src/deployment-contract.test.ts tools/n8n-knowledge-mcp/src/node-package-parser.ts tools/n8n-knowledge-mcp/src/node-package-parser.test.ts tools/n8n-knowledge-mcp/README.md
git commit -m "fix(knowledge): fail closed on official packages"
```

---

## External evidence boundary

After Task 12 and its re-review pass, the final HEAD still requires a fresh clean Node 20 Linux online build, complete suite, image build, and authenticated smoke. The prior user authorization covered only `d971ea9`; do not run a networked build for the new commit without new explicit SHA-bound authorization. GHCR and VPS remain unauthorized.
