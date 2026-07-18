# Knowledge Release Evidence Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the clean-checkout test blocker and ensure the official production knowledge build never enters optional community-package discovery before collecting fresh image and deployment evidence.

**Architecture:** Keep community enrichment available through the existing generic node build, but introduce an explicit, cross-platform official-only node build selected by `build:knowledge` and GitHub Actions. Isolate argument/environment policy in a pure function so the production boundary has behavioral tests, while deployment contract tests protect workflow wiring.

**Tech Stack:** TypeScript, Node.js 20/22, Vitest, npm scripts, GitHub Actions, Docker.

## Global Constraints

- Official node knowledge comes from the `n8n-io/n8n` GitHub registry.
- Community registry packages remain optional enrichment and must not be fetched by `build:knowledge` or the production GitHub Actions build.
- `build:nodes` retains its current behavior; production uses a new official-only entry point.
- `N8N_KNOWLEDGE_SKIP_COMMUNITY=1` remains supported for backward compatibility.
- The official-only selector must work on Windows and Linux without adding a dependency.
- Tests must run under Node 20, the repository's supported native-module baseline.
- Do not publish GHCR tags or deploy to VPS unless the online official build, artifact verification, local Linux image build, and authenticated image smoke all pass.
- Never claim GHCR or VPS evidence that was not actually executed.

---

### Task 1: Make Deployment Contract Tests Line-Ending Independent

**Files:**
- Modify: `tools/n8n-knowledge-mcp/src/deployment-contract.test.ts`

**Interfaces:**
- Consumes: workflow and shell-script text read with the checkout's native line endings.
- Produces: `extractBetween(contents, startMarker, endMarker)` that recognizes LF markers when `contents` uses LF or CRLF.

- [ ] **Step 1: Preserve the observed RED evidence**

Run:

```powershell
npx --yes node@20 ./node_modules/vitest/vitest.mjs run src/deployment-contract.test.ts --maxWorkers=1
```

Expected: two embedded-health tests fail with `missing embedded Node start marker` because the clean Windows checkout uses CRLF.

- [ ] **Step 2: Normalize only the searched source text**

Change `extractBetween` to:

```ts
function extractBetween(contents: string, startMarker: string, endMarker: string): string {
  const normalizedContents = contents.replace(/\r\n/g, "\n");
  const start = normalizedContents.indexOf(startMarker);
  expect(start, `missing embedded Node start marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const bodyStart = start + startMarker.length;
  const end = normalizedContents.indexOf(endMarker, bodyStart);
  expect(end, `missing embedded Node end marker: ${endMarker}`).toBeGreaterThan(bodyStart);
  return normalizedContents.slice(bodyStart, end);
}
```

- [ ] **Step 3: Verify GREEN and the package baseline**

```powershell
npx --yes node@20 ./node_modules/vitest/vitest.mjs run src/deployment-contract.test.ts --maxWorkers=1
npx --yes node@20 ./node_modules/vitest/vitest.mjs run --maxWorkers=1
```

Expected: deployment contract 9/9 PASS and the complete Knowledge suite has zero failures.

- [ ] **Step 4: Commit**

```powershell
git add -- tools/n8n-knowledge-mcp/src/deployment-contract.test.ts
git commit -m "test(knowledge): support CRLF deployment contracts"
```

---

### Task 2: Make Production Knowledge Builds Official-Only

**Files:**
- Create: `tools/n8n-knowledge-mcp/src/package-fetch-policy.ts`
- Create: `tools/n8n-knowledge-mcp/src/package-fetch-policy.test.ts`
- Modify: `tools/n8n-knowledge-mcp/scripts/1-fetch-packages.ts`
- Modify: `tools/n8n-knowledge-mcp/package.json`
- Modify: `.github/workflows/n8n-knowledge-mcp.yml`
- Modify: `tools/n8n-knowledge-mcp/src/build-artifact-contract.test.ts`
- Modify: `tools/n8n-knowledge-mcp/src/deployment-contract.test.ts`
- Modify: `tools/n8n-knowledge-mcp/README.md`

**Interfaces:**
- Consumes: `process.argv` and `process.env.N8N_KNOWLEDGE_SKIP_COMMUNITY`.
- Produces: `shouldSkipCommunityPackages(argv: readonly string[], skipEnvironmentValue?: string): boolean`.
- Produces: npm script `build:nodes:official`, selected by `build:knowledge` and the production workflow.

- [ ] **Step 1: Write failing policy and workflow contract tests**

Create `src/package-fetch-policy.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shouldSkipCommunityPackages } from "./package-fetch-policy.js";

describe("package fetch policy", () => {
  it("skips community packages for the official-only CLI selector", () => {
    expect(shouldSkipCommunityPackages(["node", "script", "--official-only"], undefined)).toBe(true);
  });

  it("keeps the environment compatibility selector", () => {
    expect(shouldSkipCommunityPackages(["node", "script"], "1")).toBe(true);
  });

  it("keeps community enrichment enabled for the generic build", () => {
    expect(shouldSkipCommunityPackages(["node", "script"], undefined)).toBe(false);
    expect(shouldSkipCommunityPackages(["node", "script"], "0")).toBe(false);
  });
});
```

Extend `src/deployment-contract.test.ts` to read `package.json` and `scripts/1-fetch-packages.ts`, then assert:

```ts
expect(pkg.scripts["build:nodes:official"]).toContain("--official-only");
expect(pkg.scripts["build:knowledge"]).toContain("npm run build:nodes:official");
expect(step(workflow, "Build node database")).toContain("npm run build:nodes:official");
expect(fetchScript).toContain("shouldSkipCommunityPackages(process.argv");
```

Update only the obsolete production-entry assertions in `src/build-artifact-contract.test.ts`:

```ts
expect(pkg.scripts["build:knowledge"]).toBe(
  "npm run build:nodes:official && npm run fetch:templates && npm run build:templates && npm run emit:stats && npm run verify:knowledge",
);
expect([...workflow.matchAll(/npm run build:nodes:official/g)]).toHaveLength(1);
const buildNodesAt = workflow.indexOf("npm run build:nodes:official");
```

Keep every remaining artifact-verification, fallback, Docker, and smoke ordering assertion unchanged.

- [ ] **Step 2: Run focused tests to verify RED**

```powershell
npx --yes node@20 ./node_modules/vitest/vitest.mjs run src/package-fetch-policy.test.ts src/deployment-contract.test.ts src/build-artifact-contract.test.ts --maxWorkers=1
```

Expected: FAIL because the policy module and official-only entry point do not exist.

- [ ] **Step 3: Implement the pure policy**

Create `src/package-fetch-policy.ts`:

```ts
export function shouldSkipCommunityPackages(
  argv: readonly string[],
  skipEnvironmentValue = process.env.N8N_KNOWLEDGE_SKIP_COMMUNITY,
): boolean {
  return argv.includes("--official-only") || skipEnvironmentValue === "1";
}
```

Import it in `scripts/1-fetch-packages.ts` and define the fetch policy after loading `packages.json`:

```ts
const SKIP_COMMUNITY = shouldSkipCommunityPackages(process.argv);
```

Wrap the existing community search, download-count filter, and community ref additions in:

```ts
if (!SKIP_COMMUNITY) {
  // Existing community discovery and ref population stays here unchanged.
} else {
  console.log("[fetch] skipping community packages for the official-only build");
}
```

Official package resolution and download remain outside this branch, so both modes still produce the official node database.

- [ ] **Step 4: Wire official production entry points**

In `package.json`, add and select:

```json
"build:nodes:official": "tsx scripts/1-fetch-packages.ts --official-only && tsx scripts/2-parse-nodes.ts && tsx scripts/3-parse-docs.ts && tsx scripts/4-build-db.ts",
"build:knowledge": "npm run build:nodes:official && npm run fetch:templates && npm run build:templates && npm run emit:stats && npm run verify:knowledge"
```

Change only the workflow's `Build node database` command to:

```yaml
run: npm run build:nodes:official
```

- [ ] **Step 5: Document the production/community boundary**

Update the README to state that `npm run build:knowledge` is official-only, `npm run build:nodes` retains optional community enrichment, and `N8N_KNOWLEDGE_SKIP_COMMUNITY=1 npm run fetch` remains compatible.

- [ ] **Step 6: Verify GREEN**

```powershell
npx --yes node@20 ./node_modules/vitest/vitest.mjs run src/package-fetch-policy.test.ts src/deployment-contract.test.ts src/build-artifact-contract.test.ts --maxWorkers=1
npx --yes node@20 ./node_modules/vitest/vitest.mjs run --maxWorkers=1
npx --yes node@20 ./node_modules/typescript/bin/tsc -p tsconfig.json
```

Expected: focused and complete tests PASS; TypeScript exits 0.

- [ ] **Step 7: Commit**

```powershell
git add -- .github/workflows/n8n-knowledge-mcp.yml tools/n8n-knowledge-mcp/README.md tools/n8n-knowledge-mcp/package.json tools/n8n-knowledge-mcp/scripts/1-fetch-packages.ts tools/n8n-knowledge-mcp/src/build-artifact-contract.test.ts tools/n8n-knowledge-mcp/src/deployment-contract.test.ts tools/n8n-knowledge-mcp/src/package-fetch-policy.ts tools/n8n-knowledge-mcp/src/package-fetch-policy.test.ts
git commit -m "fix(knowledge): keep production builds official-only"
```

---

### Task 3: Synchronize the Production Lockfile on Linux

**Files:**
- Modify: `tools/n8n-knowledge-mcp/package-lock.json`

**Interfaces:**
- Consumes: the unchanged `tools/n8n-knowledge-mcp/package.json` dependency graph.
- Produces: a lockfile accepted by `npm ci` under `node:20-bookworm` with npm 10.8.2.

- [ ] **Step 1: Preserve the clean Linux RED evidence**

Use the Task 3 evidence report from the first release attempt. A clean `git archive HEAD` in `node:20-bookworm` ran:

```bash
npm ci --no-audit --no-fund
```

Expected observed RED: exit 1 with missing lock entries `@emnapi/core@1.11.2` and `@emnapi/runtime@1.11.2`.

- [ ] **Step 2: Regenerate only the lockfile with the production Node/npm family**

From the repository root in PowerShell:

```powershell
$packageDir=(Resolve-Path 'tools/n8n-knowledge-mcp').Path
docker run --rm --mount "type=bind,src=$packageDir,dst=/workspace" -w /workspace node:20-bookworm npm install --package-lock-only --ignore-scripts --no-audit --no-fund
```

Expected: exit 0; only `tools/n8n-knowledge-mcp/package-lock.json` changes.

- [ ] **Step 3: Verify GREEN in a fresh Linux volume**

Create a disposable `node:20-bookworm` container with a fresh named volume mounted at `/workspace`, copy only the updated `package.json` and `package-lock.json` into it with `docker cp`, and start it with:

```bash
npm ci --ignore-scripts --no-audit --no-fund
```

Expected: exit 0. Remove the test container and named volume after the run and verify both are absent.

- [ ] **Step 4: Verify package tests and TypeScript**

```powershell
npx --yes node@20 ./node_modules/vitest/vitest.mjs run --maxWorkers=1
npx --yes node@20 ./node_modules/typescript/bin/tsc -p tsconfig.json
git diff --check -- tools/n8n-knowledge-mcp/package-lock.json
```

Expected: complete Knowledge suite and TypeScript exit 0; lockfile diff check exits 0.

- [ ] **Step 5: Commit**

```powershell
git add -- tools/n8n-knowledge-mcp/package-lock.json
git commit -m "fix(knowledge): synchronize production lockfile"
```

---

### Task 4: Enforce Linux Shell Line Endings

**Files:**
- Create: `.gitattributes`
- Normalize: `deploy/update-knowledge.sh`

**Interfaces:**
- Consumes: the committed VPS deployment script.
- Produces: Git blobs for shell scripts with LF line endings on every checkout.

- [ ] **Step 1: Preserve the Linux RED evidence**

From a clean Linux copy of the committed source, the deployment contract must reproduce:

```text
deploy/update-knowledge.sh: line 2: set: pipefail\r: invalid option name
```

Expected: deployment contract fails because the committed shell blob contains CRLF.

- [ ] **Step 2: Add the repository line-ending contract**

Create `.gitattributes`:

```gitattributes
*.sh text eol=lf
```

Renormalize only the production deployment script:

```powershell
git add --renormalize -- deploy/update-knowledge.sh
```

Do not change script logic.

- [ ] **Step 3: Verify the normalized blob and Linux shell syntax**

Verify the staged blob contains no carriage returns, then run in Linux:

```bash
bash -n deploy/update-knowledge.sh
```

Expected: no carriage-return bytes; Bash syntax exits 0.

- [ ] **Step 4: Run focused deployment contracts on Windows and Linux**

Run `src/deployment-contract.test.ts` under Node 20 in the Windows worktree and in a real Linux Git checkout that includes `.git` metadata.

Expected: 9/9 PASS in both environments.

- [ ] **Step 5: Commit**

```powershell
git add -- .gitattributes deploy/update-knowledge.sh
git commit -m "fix(deploy): enforce LF shell scripts"
```

---

### Task 5: Collect Fresh Release Evidence Without Overclaiming

**Files:**
- Create: `.superpowers/sdd/knowledge-release-evidence.md` (scratch evidence; do not commit).
- Modify: `src/data/n8n-stats.json` only through the verified build command if the online build succeeds.

**Interfaces:**
- Consumes: Task 2 official-only `build:knowledge`, Task 3 Linux-clean `npm ci` lockfile, and Task 4 LF-normalized deployment scripts.
- Produces: fresh evidence separating local, online build, Docker smoke, GHCR, and VPS status.

- [ ] **Step 1: Run the official online build under Node 20**

```powershell
npx --yes node@20 "C:\Program Files\nodejs\node_modules\npm\bin\npm-cli.js" run build:knowledge
```

Expected: logs explicitly skip community packages; the quality report has `ok: true` with 4,750-5,000 templates.

- [ ] **Step 2: Inspect the generated database**

```powershell
python -c "import json,sqlite3; db=sqlite3.connect(r'tools/n8n-knowledge-mcp/data/nodes.db'); t=db.execute('select count(*) from templates').fetchone()[0]; f=db.execute('select count(*) from templates_fts').fetchone()[0]; assert 4750 <= t <= 5000 and t == f, (t,f); r=json.load(open(r'tools/n8n-knowledge-mcp/data/knowledge-quality-report.json',encoding='utf-8')); assert r['ok'] is True; print({'templates':t,'fts':f,'acceptedOfficial':r['acceptedOfficial']})"
```

Expected: matching template/FTS counts between 4,750 and 5,000.

- [ ] **Step 3: Run static and package verification**

```powershell
npx --yes node@20 ./node_modules/vitest/vitest.mjs run --maxWorkers=1
npx --yes node@20 ./node_modules/typescript/bin/tsc -p tsconfig.json
git diff --check
```

Expected: every command exits 0.

- [ ] **Step 4: Build and smoke the local Linux image when Docker is available**

```powershell
docker build -t n8n-knowledge-mcp:release-evidence tools/n8n-knowledge-mcp
docker run --rm -d --name n8n-knowledge-mcp-release-evidence -e AUTH_TOKEN=test-token -p 127.0.0.1:39000:3000 n8n-knowledge-mcp:release-evidence
curl.exe -fsS -H "Authorization: Bearer test-token" http://127.0.0.1:39000/health
docker stop n8n-knowledge-mcp-release-evidence
```

Expected: authenticated health reports `ok: true` and the verified template count.

- [ ] **Step 5: Record external evidence boundaries**

Record GHCR push and VPS deployment as not executed unless credentials and explicit production authority are available and the commands actually run. Do not publish or deploy merely to satisfy this plan.
