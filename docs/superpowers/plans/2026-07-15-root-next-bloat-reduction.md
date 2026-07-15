# Root Next.js Bloat Reduction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the root Next.js application the only application, remove the abandoned workspace architecture and mixed pnpm/Turbo installation state, reclaim rebuildable disk space, and preserve every unrelated user change.

**Architecture:** Keep the root Next.js application and `tools/n8n-knowledge-mcp` as two explicit npm verification boundaries. Remove the untracked legacy workspace tree and workspace metadata, regenerate the root npm lockfile, clean only an exact allowlist of rebuildable paths, reinstall through npm, and enforce the resulting architecture with tests.

**Tech Stack:** Next.js 16, React 19, TypeScript 5.8, npm 11.6.2, Vitest 4, Node.js 20, PowerShell, Git linked worktrees.

## Global Constraints

- The root Next.js application is the sole application; `tools/n8n-knowledge-mcp` remains the only separate package/runtime.
- Use npm 11.6.2 only; do not retain or invoke pnpm or Turborepo.
- Do not change API behavior, routes, authentication, billing, MCP tools, schemas, or deployment topology.
- Do not modify, unstage, overwrite, delete, or commit unrelated staged, modified, deleted, or untracked user paths.
- Capture `git status --porcelain=v2` before mutation and require an exact after-state match when approved paths are excluded.
- Use `git commit --only -- <approved paths>` so the existing staged user changes never enter these commits.
- Never run `git clean`, `git reset --hard`, wildcard deletion, or `git gc --prune=now`.
- Resolve every recursive deletion target to an exact absolute path under `D:\n8nmcp` before deletion.
- Keep `.worktrees`, `.git`, `.superpowers`, source files, environment files, migrations, and unrelated untracked files.
- Run Knowledge MCP behavioral verification through Node 20 with `--maxWorkers=1`.
- Do not raise timeouts, add retries, remove assertions, or weaken lint, type, test, build, deployment, or lifecycle contracts.
- If a baseline failure touches active root or Knowledge code, or any unrelated-state comparison fails, stop without performing later cleanup. A lint failure confined entirely to the approved legacy `apps/` or `packages/` paths may be recorded and rechecked after their removal.

---

### Task 1: Establish the Single-Application Architecture Contract

**Files:**
- Create: `src/lib/__tests__/single-app-architecture.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Delete exact untracked paths: `apps/`, `packages/`, `turbo.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml`
- Evidence only: `.superpowers/sdd/root-next-bloat-progress.md`

**Interfaces:**
- Consumes: the approved design, current root npm manifest, current staged/untracked user state.
- Produces: a root npm package with no workspaces and a regression test that rejects resurrection of the legacy workspace.

- [ ] **Step 1: Record the immutable baseline before any mutation**

Run from `D:\n8nmcp`:

```powershell
git status --porcelain=v2
git diff --cached --name-status
git ls-files --others --exclude-standard
git rev-parse HEAD
git worktree list --porcelain
git count-objects -vH
```

Record the complete outputs, current disk totals, and SHA-256 hashes for `package.json`, `package-lock.json`, and `.gitignore` in `.superpowers/sdd/root-next-bloat-progress.md` using `apply_patch`. Expected preconditions:

```text
HEAD contains the approved design commit.
No unmerged entries exist.
apps/, packages/, turbo.json, pnpm-lock.yaml, and pnpm-workspace.yaml are untracked.
```

Run `git ls-files -u`; expected output is empty. If any precondition differs, stop before deletion.

- [ ] **Step 2: Run the pre-cleanup behavioral baseline**

Run from the repository root:

```powershell
npm run lint
npm run type-check
npm test
npm run build
```

Run from `D:\n8nmcp\tools\n8n-knowledge-mcp`:

```powershell
npx.cmd --yes node@20 ./node_modules/vitest/vitest.mjs run --maxWorkers=1
npx.cmd --yes node@20 ./node_modules/typescript/bin/tsc -p tsconfig.json
```

Expected: type-check, tests, build, and both Knowledge commands exit `0`; the Knowledge suite reports at least the current 232 tests with zero failures. Root lint should exit `0`. If root lint fails only on files under the approved legacy `apps/` or `packages/` paths, record the exact diagnostics and continue to the post-removal lint gate; any diagnostic outside those paths blocks mutation. Append commands, exit codes, test counts, and build result to the progress ledger.

- [ ] **Step 3: Write the architecture guard RED**

Create `src/lib/__tests__/single-app-architecture.test.ts` with `apply_patch`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(resolve(root, path), "utf8")) as Record<string, unknown>;
}

describe("single application architecture", () => {
  it("uses the root npm package without workspaces", () => {
    const manifest = readJson("package.json");
    expect(manifest.packageManager).toBe("npm@11.6.2");
    expect(manifest).not.toHaveProperty("workspaces");
  });

  it("does not retain the retired workspace tree or pnpm and Turbo files", () => {
    for (const path of [
      "apps",
      "packages",
      "turbo.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
    ]) {
      expect(existsSync(resolve(root, path)), path).toBe(false);
    }
  });

  it("keeps workspace packages out of the npm lockfile", () => {
    const lock = readJson("package-lock.json") as {
      packages?: Record<string, { workspaces?: string[] }>;
    };
    const packageKeys = Object.keys(lock.packages ?? {});
    expect(lock.packages?.[""]?.workspaces).toBeUndefined();
    expect(
      packageKeys.filter(
        (key) =>
          key.startsWith("apps/") ||
          key.startsWith("packages/") ||
          key.startsWith("node_modules/@n8nmcp/"),
      ),
    ).toEqual([]);
  });
});
```

- [ ] **Step 4: Run RED and confirm the expected failures**

```powershell
npx.cmd vitest run src/lib/__tests__/single-app-architecture.test.ts
```

Expected: three tests fail because `workspaces`, the legacy paths, and workspace lock entries still exist. The failure must not be a syntax or collection error.

- [ ] **Step 5: Prove no live runtime dependency points into the legacy tree**

```powershell
rg -n '@n8nmcp/|apps/(api|dashboard)|packages/types' `
  src deploy supabase tests tools Dockerfile next.config.ts tsconfig.json `
  eslint.config.js vitest.config.ts
```

Expected: no matches and `rg` exit `1`. Historical plans/reports and `AGENTS.md` are excluded intentionally; `AGENTS.md` is corrected in Task 2. Any match in production code or active configuration blocks deletion and requires a focused migration test before continuing.

- [ ] **Step 6: Remove the root workspace declaration**

Use `apply_patch` to remove only this property from `package.json`:

```json
"workspaces": [
  "apps/api",
  "apps/dashboard",
  "packages/*"
],
```

Retain `"packageManager": "npm@11.6.2"` and every existing dependency and script.

- [ ] **Step 7: Delete only the approved legacy paths**

Run one PowerShell process so path verification and deletion remain in the same shell:

```powershell
$repo = (Resolve-Path -LiteralPath 'D:\n8nmcp').Path
if ($repo -ne 'D:\n8nmcp') { throw "Unexpected repository path: $repo" }

$targets = @(
  'D:\n8nmcp\apps',
  'D:\n8nmcp\packages',
  'D:\n8nmcp\turbo.json',
  'D:\n8nmcp\pnpm-lock.yaml',
  'D:\n8nmcp\pnpm-workspace.yaml'
)

foreach ($target in $targets) {
  $full = [IO.Path]::GetFullPath($target)
  if ($full -ne $target -or -not $full.StartsWith("$repo\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unexpected deletion target: $full"
  }
}

foreach ($target in $targets) {
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}
```

Expected: all five exact paths are absent; `.worktrees`, `.git`, and `.superpowers` remain present.

- [ ] **Step 8: Regenerate the root npm lockfile**

```powershell
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
```

Expected: exit `0`; `package-lock.json` contains no `apps/`, `packages/`, or `node_modules/@n8nmcp/` package keys.

- [ ] **Step 9: Run GREEN and scope gates**

```powershell
npx.cmd vitest run src/lib/__tests__/single-app-architecture.test.ts
git diff --check -- package.json package-lock.json src/lib/__tests__/single-app-architecture.test.ts
git status --porcelain=v2
```

Expected: three tests pass. Compare current status to the Step 1 baseline after excluding only the five deleted legacy paths and these approved files:

```text
package.json
package-lock.json
src/lib/__tests__/single-app-architecture.test.ts
```

Expected unrelated delta: zero.

- [ ] **Step 10: Commit only the architecture contract**

```powershell
git add -- package.json package-lock.json src/lib/__tests__/single-app-architecture.test.ts
git commit --only -m "refactor: retire legacy workspace architecture" -- `
  package.json package-lock.json src/lib/__tests__/single-app-architecture.test.ts
```

Expected: the commit contains exactly these three tracked paths; existing unrelated staged paths remain staged and unchanged.

---

### Task 2: Converge Active Documentation and Ignore Policy

**Files:**
- Modify: `.gitignore`
- Replace: `AGENTS.md`
- Modify: `src/lib/__tests__/single-app-architecture.test.ts`

**Interfaces:**
- Consumes: Task 1's root-only architecture.
- Produces: active contributor instructions and regression coverage that prevent local cache/workspace pollution.

- [ ] **Step 1: Add documentation and ignore-policy RED tests**

Append to the existing `describe` block in `src/lib/__tests__/single-app-architecture.test.ts`:

```ts
  it("ignores reproducible local workspace state", () => {
    const gitignore = readFileSync(resolve(root, ".gitignore"), "utf8");
    for (const rule of [
      ".tmp/",
      ".npm-cache/",
      ".worktrees/",
      "test-results/",
      "*.tsbuildinfo",
      ".superpowers/sdd/",
    ]) {
      expect(gitignore, rule).toContain(rule);
    }
  });

  it("documents the root Next application as the active architecture", () => {
    const guide = readFileSync(resolve(root, "AGENTS.md"), "utf8");
    expect(guide).toContain("Root Next.js application");
    expect(guide).toContain("tools/n8n-knowledge-mcp");
    expect(guide).toContain("npm ci");
    expect(guide).not.toMatch(/Turborepo|pnpm|apps\/api|apps\/dashboard|packages\/types/);
  });
```

- [ ] **Step 2: Run RED**

```powershell
npx.cmd vitest run src/lib/__tests__/single-app-architecture.test.ts
```

Expected: the three Task 1 tests pass and the two new tests fail on missing ignore rules and stale `AGENTS.md` architecture text.

- [ ] **Step 3: Add the exact root ignore rules**

Append this block to `.gitignore` with `apply_patch`:

```gitignore
# Reproducible local workspace state
.tmp/
.npm-cache/
.worktrees/
test-results/
*.tsbuildinfo
.superpowers/sdd/
```

Do not remove existing environment, Next.js, editor, or deployment ignore rules.

- [ ] **Step 4: Replace the stale agent guide**

Replace `AGENTS.md` with this complete active guide using `apply_patch`:

```markdown
# n8n-mcp Agent Guide

## Active architecture

This repository has one application: the Root Next.js application.

- `src/app/` contains pages, route handlers, and the public MCP endpoint.
- `src/lib/` contains application, MCP, billing, support, audit, and workflow-agent logic.
- `tools/n8n-knowledge-mcp/` is the only separately built package/runtime.
- `deploy/` and the root `Dockerfile` define the VPS Docker deployment.
- `supabase/` contains database configuration, migrations, and database tests.

The retired Express/dashboard workspace architecture must not be recreated.

## Package management

Use npm only. The root package manager is npm 11.6.2.

```powershell
npm ci
npm run dev
npm run lint
npm run type-check
npm test
npm run build
```

Verify the Knowledge MCP package independently:

```powershell
Set-Location tools/n8n-knowledge-mcp
npm ci
npx.cmd --yes node@20 ./node_modules/vitest/vitest.mjs run --maxWorkers=1
npx.cmd --yes node@20 ./node_modules/typescript/bin/tsc -p tsconfig.json
```

## Code boundaries

- Pages and HTTP route handlers belong under `src/app/`.
- Shared server behavior belongs under `src/lib/`.
- Shared React components belong under `src/components/`.
- Database changes require a migration under `supabase/migrations/` and relevant tests.
- Knowledge acquisition, parsing, validation, and serving code stays under `tools/n8n-knowledge-mcp/`.

## Workflow Agent Mode

Production n8n workflow creation or mutation is not ordinary repository CRUD. Use the workflow-agent safety sequence: template and node knowledge lookup, node validation, workflow validation, diff preview, partial update, deployment/test gates, audit snapshots, and rollback metadata. Validation errors block deployment; warnings block automatic activation.

Repository code, tests, documentation, and Dashboard changes use Code Agent Mode.

## Security requirements

- Never store API keys or service credentials in plaintext.
- Validate inputs with the existing schemas and fail closed.
- Route user-controlled outbound URLs through the SSRF protections in `src/lib/ssrf-guard.server.ts`.
- Preserve audit logging for mutating workflow operations.
- Official GitHub node source is parsed statically and must remain contained within its package root.
- Community package tarballs require trusted-host and SRI verification before extraction.

## Working-tree safety

- Preserve unrelated staged, modified, deleted, and untracked user paths.
- Do not use `git clean`, `git reset --hard`, or broad wildcard deletion.
- Use `apply_patch` for source edits.
- Use Node 20 and `--maxWorkers=1` for Knowledge MCP verification.
- Run focused tests while iterating and the complete relevant suite before completion.

## Deployment

The production authority is the root Next.js standalone image deployed through VPS Docker Compose and Caddy. Do not add active Vercel, Cloudflare Worker, legacy Express, or split-domain deployment instructions without an approved architecture change.
```

- [ ] **Step 5: Run GREEN and active-reference scans**

```powershell
npx.cmd vitest run src/lib/__tests__/single-app-architecture.test.ts
rg -n 'Turborepo|pnpm|apps/api|apps/dashboard|packages/types' `
  AGENTS.md package.json package-lock.json Dockerfile deploy .github `
  --glob '*.md' --glob '*.json' --glob '*.yml' --glob '*.yaml' --glob 'Dockerfile'
git diff --check -- .gitignore AGENTS.md src/lib/__tests__/single-app-architecture.test.ts
```

Expected: all five architecture tests pass; active-reference scan has no matches. Historical reports outside these active paths are intentionally unchanged.

- [ ] **Step 6: Prove ignore behavior**

```powershell
git check-ignore -v -- .tmp .npm-cache .worktrees test-results tsconfig.tsbuildinfo .superpowers/sdd
```

Expected: every path is ignored by the new root rules. Re-run the unrelated-state comparison, excluding only `.gitignore`, `AGENTS.md`, and the architecture test; expected unrelated delta is zero.

- [ ] **Step 7: Commit only active documentation and hygiene**

```powershell
git add -- .gitignore AGENTS.md src/lib/__tests__/single-app-architecture.test.ts
git commit --only -m "chore: enforce root application workspace hygiene" -- `
  .gitignore AGENTS.md src/lib/__tests__/single-app-architecture.test.ts
```

Expected: exactly these three paths are committed; unrelated staged user state remains unchanged.

---

### Task 3: Replace Mixed Install Trees with Clean npm Installs

**Files:**
- Delete exact rebuildable directories/files only; no tracked source modifications.
- Evidence only: `.superpowers/sdd/root-next-bloat-progress.md`

**Interfaces:**
- Consumes: Tasks 1-2 manifests and ignore policy.
- Produces: root and Knowledge dependency trees installed only by npm with no `.pnpm` store.

- [ ] **Step 1: Reconfirm cleanup preconditions**

```powershell
git ls-files -u
git status --porcelain=v2
git worktree list --porcelain
Test-Path -LiteralPath 'D:\n8nmcp\.worktrees'
```

Expected: no unmerged entries; the linked worktree remains registered and present. Compare unrelated state to Task 1's baseline before deleting rebuildable paths.

- [ ] **Step 2: Verify the exact cleanup allowlist**

Use this exact PowerShell allowlist:

```powershell
$repo = (Resolve-Path -LiteralPath 'D:\n8nmcp').Path
if ($repo -ne 'D:\n8nmcp') { throw "Unexpected repository path: $repo" }

$targets = @(
  'D:\n8nmcp\node_modules',
  'D:\n8nmcp\.next',
  'D:\n8nmcp\.tmp',
  'D:\n8nmcp\.npm-cache',
  'D:\n8nmcp\test-results',
  'D:\n8nmcp\tsconfig.tsbuildinfo',
  'D:\n8nmcp\tools\n8n-knowledge-mcp\node_modules',
  'D:\n8nmcp\tools\n8n-knowledge-mcp\.tmp',
  'D:\n8nmcp\tools\n8n-knowledge-mcp\dist',
  'D:\n8nmcp\tools\n8n-knowledge-mcp\data\nodes.db'
)

foreach ($target in $targets) {
  $full = [IO.Path]::GetFullPath($target)
  if ($full -ne $target -or -not $full.StartsWith("$repo\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unexpected cleanup target: $full"
  }
}

$targets | ForEach-Object {
  [pscustomobject]@{ Path = $_; Exists = Test-Path -LiteralPath $_ }
} | Format-Table -AutoSize
```

Expected: every computed path exactly matches the literal allowlist. `.worktrees`, `.git`, `.superpowers`, `.env`, `src`, `deploy`, `supabase`, and `docs` are not in the allowlist.

- [ ] **Step 3: Delete only the verified rebuildable paths**

In the same PowerShell process after the Step 2 verification:

```powershell
foreach ($target in $targets) {
  if (Test-Path -LiteralPath $target) {
    Remove-Item -LiteralPath $target -Recurse -Force
  }
}
```

Expected: all allowlisted paths are absent; `.worktrees`, `.git`, `.superpowers`, and all source roots remain present.

- [ ] **Step 4: Perform the clean root npm install**

```powershell
Set-Location 'D:\n8nmcp'
npm ci --ignore-scripts --no-audit --no-fund
```

Expected: exit `0`; `node_modules` exists and `node_modules/.pnpm` does not.

- [ ] **Step 5: Perform the clean Knowledge npm install**

```powershell
Set-Location 'D:\n8nmcp\tools\n8n-knowledge-mcp'
npm ci --ignore-scripts --no-audit --no-fund
```

Expected: exit `0`; the package's `node_modules` exists and contains no `.pnpm` directory.

- [ ] **Step 6: Verify dependency-tree convergence**

```powershell
Set-Location 'D:\n8nmcp'
npm ls --depth=0
Test-Path -LiteralPath 'D:\n8nmcp\node_modules\.pnpm'
Test-Path -LiteralPath 'D:\n8nmcp\pnpm-lock.yaml'
Test-Path -LiteralPath 'D:\n8nmcp\pnpm-workspace.yaml'
Test-Path -LiteralPath 'D:\n8nmcp\turbo.json'
```

Expected: `npm ls --depth=0` exits `0`; all four `Test-Path` results are `False`. Re-run the Git unrelated-state comparison; deleting ignored/rebuildable paths must produce no unrelated tracked or untracked delta.

---

### Task 4: Run Full Behavioral Verification from the Clean npm State

**Files:**
- No source changes expected.
- Evidence only: `.superpowers/sdd/root-next-bloat-progress.md`

**Interfaces:**
- Consumes: clean npm dependency trees from Task 3.
- Produces: fresh root and Knowledge verification evidence.

- [ ] **Step 1: Run all root application gates**

```powershell
Set-Location 'D:\n8nmcp'
npm run lint
npm run type-check
npm test
npm run build
```

Expected: all commands exit `0`, test output has zero failures, and the Next.js production build completes successfully. Append exact counts, duration, and exit codes to the progress ledger.

- [ ] **Step 2: Run all Knowledge MCP gates**

```powershell
Set-Location 'D:\n8nmcp\tools\n8n-knowledge-mcp'
npx.cmd --yes node@20 ./node_modules/vitest/vitest.mjs run --maxWorkers=1
npx.cmd --yes node@20 ./node_modules/typescript/bin/tsc -p tsconfig.json
```

Expected: exit `0`, zero failures, and at least the current 232 tests pass through one worker.

- [ ] **Step 3: Run architecture, diff, and marker gates**

```powershell
Set-Location 'D:\n8nmcp'
npx.cmd vitest run src/lib/__tests__/single-app-architecture.test.ts
git diff --check
git ls-files -u
rg -n '^(<<<<<<<|=======|>>>>>>>)' src tools deploy supabase tests
```

Expected: architecture tests pass; `diff --check` and `ls-files -u` produce no output; `rg` exits `1` with no marker matches.

- [ ] **Step 4: Remove verification outputs that are reproducible**

Resolve the repository path again, then delete only outputs recreated by Task 4:

```powershell
$repo = (Resolve-Path -LiteralPath 'D:\n8nmcp').Path
if ($repo -ne 'D:\n8nmcp') { throw "Unexpected repository path: $repo" }

$outputs = @(
  'D:\n8nmcp\.next',
  'D:\n8nmcp\test-results',
  'D:\n8nmcp\tsconfig.tsbuildinfo',
  'D:\n8nmcp\tools\n8n-knowledge-mcp\.tmp',
  'D:\n8nmcp\tools\n8n-knowledge-mcp\dist',
  'D:\n8nmcp\tools\n8n-knowledge-mcp\data\nodes.db'
)

foreach ($output in $outputs) {
  $full = [IO.Path]::GetFullPath($output)
  if ($full -ne $output -or -not $full.StartsWith("$repo\", [StringComparison]::OrdinalIgnoreCase)) {
    throw "Unexpected verification-output target: $full"
  }
  if (Test-Path -LiteralPath $output) {
    Remove-Item -LiteralPath $output -Recurse -Force
  }
}
```

Expected: outputs are absent; npm dependency trees remain installed; source and linked worktrees remain untouched.

- [ ] **Step 5: Confirm final source and user-state integrity**

```powershell
git status --porcelain=v2
git diff --check
git ls-files -u
git worktree list --porcelain
```

Compare against the Task 1 baseline after excluding only approved task paths and the explicitly deleted legacy/rebuildable paths. Expected unrelated ordered delta: zero.

---

### Task 5: Compact Git Objects Conservatively

**Files:**
- Git object database maintenance only; no working-tree or index mutation.
- Evidence only: `.superpowers/sdd/root-next-bloat-progress.md`

**Interfaces:**
- Consumes: passing Task 4 verification and exact user-state snapshot.
- Produces: a packed Git object database without aggressive pruning or history rewriting.

- [ ] **Step 1: Record Git maintenance preconditions**

```powershell
git status --porcelain=v2
git worktree list --porcelain
git count-objects -vH
git fsck --no-dangling
```

Expected: `fsck` exits `0`; the linked worktree is registered; status matches Task 4 exactly. Stop if another Git process is active or any lock file exists under `.git`.

- [ ] **Step 2: Run conservative Git garbage collection**

```powershell
git gc
```

Use Git's default grace period. Do not pass `--prune=now`, do not expire reflogs, and do not delete temporary object files manually.

- [ ] **Step 3: Verify Git integrity and state after compaction**

```powershell
git fsck --no-dangling
git count-objects -vH
git status --porcelain=v2
git worktree list --porcelain
```

Expected: `fsck` exits `0`; all branches/worktrees remain; the status output is byte-for-byte identical to Step 1; packed size is reported and loose-object size is materially reduced.

---

### Task 6: Publish Final Bloat-Reduction Evidence

**Files:**
- Create: `docs/reports/2026-07-15-root-next-bloat-reduction-report.md`

**Interfaces:**
- Consumes: Tasks 1-5 progress evidence.
- Produces: an auditable before/after report and final implementation commit.

- [ ] **Step 1: Measure the final disk state**

Run the same top-level recursive size measurement used before implementation and record at least:

```text
Total workspace MiB
node_modules MiB
tools/n8n-knowledge-mcp/node_modules MiB
.next MiB
.tmp MiB
.npm-cache MiB
.worktrees MiB
.git MiB and git count-objects output
```

Expected: pnpm/Turbo/legacy paths and rebuildable caches are absent; workspace disk usage is materially below the approximately 2.82 GiB baseline.

- [ ] **Step 2: Create the final report with exact evidence**

Create `docs/reports/2026-07-15-root-next-bloat-reduction-report.md` using `apply_patch` with these completed sections:

```markdown
# Root Next.js Bloat Reduction Report

## Outcome

## Architecture Changes

## Package-Manager Convergence

## Disk Usage Before and After

## Verification Results

## Git and User-State Integrity

## Remaining Follow-up Work
```

Populate every section with actual commands, exit codes, test counts, before/after MiB values, implementation SHAs, and the unrelated-state comparison. Do not leave placeholders. Remaining follow-up work must list only the separately approved future projects: large-file decomposition and historical root-document archival.

- [ ] **Step 3: Run the final evidence gates**

```powershell
rg -n 'T[B]D|T[O]DO|implement la[t]er|fill i[n]' docs/reports/2026-07-15-root-next-bloat-reduction-report.md
git diff --check -- docs/reports/2026-07-15-root-next-bloat-reduction-report.md
npx.cmd vitest run src/lib/__tests__/single-app-architecture.test.ts
git ls-files -u
```

Expected: placeholder scan exits `1`; diff check passes; architecture tests pass; no unmerged entries exist.

- [ ] **Step 4: Commit only the evidence report**

```powershell
git add -- docs/reports/2026-07-15-root-next-bloat-reduction-report.md
git commit --only -m "docs: report root application bloat reduction" -- `
  docs/reports/2026-07-15-root-next-bloat-reduction-report.md
```

Expected: only the report is committed and every unrelated staged user path remains staged exactly as before.

- [ ] **Step 5: Request final review**

Use `superpowers:requesting-code-review` over the implementation commit range. The reviewer must inspect architecture alignment, package-lock convergence, deletion scope, ignore policy, verification evidence, disk measurements, and unrelated-state preservation. Fix every Critical or Important finding, rerun its covering tests, and repeat the final state comparison before completion.
