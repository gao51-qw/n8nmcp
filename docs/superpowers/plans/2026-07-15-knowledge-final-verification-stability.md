# Knowledge Final Verification Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the final two lifecycle review findings and remove the two synchronous CLI timeout domains so the unchanged Knowledge MCP suite passes 210/210 under Node 20.

**Architecture:** One final review-repair wave changes four test-harness files. External tests clone a once-imported SQLite baseline, production-artifact tests execute the globally compiled verifier, deployment timeout settlement requires both top-level closure and successful tree termination, and compiled-server cleanup awaits a pre-registered terminal settlement.

**Tech Stack:** TypeScript, Node.js 20.20.2, Vitest 4, better-sqlite3, Node child-process APIs, Git Bash/MSYS on Windows.

## Global Constraints

- Keep exactly 18 test files and 210 tests; do not add, remove, skip, or weaken business assertions.
- Do not increase global, hook, or per-test timeouts and do not add retries.
- Run every test and TypeScript command with `C:\Users\0\AppData\Local\npm-cache\_npx\50885608f1fc53f3\node_modules\node\bin\node.exe`.
- Use the existing Vitest global build output under `tools/n8n-knowledge-mcp/dist`; no test file may start `tsx` or `tsc` for runtime verification.
- A deployment timeout is cleanup-safe only after the top-level child emitted `close` and tree termination completed successfully within the existing four-second grace.
- Compiled-server fixture deletion must follow a settlement observer registered immediately after `spawn`.
- Do not modify production scripts, deployment scripts, server source, Vitest config/global setup, dependencies, lockfiles, generated databases, Docker assets, workflows, images, GHCR, or VPS state.
- Do not access the network or run online knowledge builds.

---

### Task 15: Final Review and Full-Suite Stability Repair Wave

**Files:**
- Modify: `tools/n8n-knowledge-mcp/src/production-artifact-verifier.test.ts`
- Modify: `tools/n8n-knowledge-mcp/src/external-candidates.test.ts`
- Modify: `tools/n8n-knowledge-mcp/src/compiled-start.test.ts`
- Modify: `tools/n8n-knowledge-mcp/src/deployment-contract.test.ts`

**Interfaces:**
- Produces: production-artifact `runVerifier()` executing `dist/scripts/10-verify-production-artifacts.js` directly.
- Produces: `ImportedFixtureSnapshot` and `createImportedFixture()` for per-row SQLite baseline cloning.
- Produces: `ChildSettlement { closed: Promise<void>; isClosed(): boolean }` and `observeChildSettlement(child)`.
- Extends: test-only `DeploymentCommandControl.terminationFactory?: (pid: number) => ProcessTreeTermination`.
- Preserves: all existing result/status/stdout/stderr assertions, 30-second deployment deadline, four-second termination grace, 35-second deployment wrappers, explicit Git Bash/PATH, and 210-test count.

- [ ] **Step 1: Record the four existing RED domains before editing**

Record the task base before any test-file edit:

```powershell
$taskBase = git rev-parse HEAD
```

The controller already captured these exact RED results at tracked head `0e594b4`; the later commits through the plan commit change documentation only:

```text
external empty/whitespace focus: 6 failed, 8 skipped; every row timed out in 5.12-6.34s
production-artifact file: 18 failed, 3 passed; passing rows took 4.69-4.93s
whole suite: 12 failed, 198 passed; failures only in the two files above
whole-branch review: two Important lifecycle findings in deployment-contract and compiled-start
```

Do not repeat the full suite for RED. Reproduce only the external six-row focus before its implementation:

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/external-candidates.test.ts -t "rejects empty or whitespace-only" --maxWorkers=1 --reporter=verbose
```

Expected: six timeouts at the unchanged default 5,000ms. This is the behavioral RED for the baseline-snapshot change.

- [ ] **Step 2: Add a deterministic RED contract for the compiled artifact verifier**

In the first existing verifier test, read only the `runVerifier` function slice so the assertion strings cannot satisfy themselves:

```ts
const testSource = readFileSync(resolve("src/production-artifact-verifier.test.ts"), "utf8");
const runVerifierSource = testSource.slice(
  testSource.indexOf("function runVerifier"),
  testSource.indexOf("function sha256"),
);
expect(runVerifierSource).toContain("dist/scripts/10-verify-production-artifacts.js");
expect(runVerifierSource).not.toContain("node_modules/tsx");
```

Run only that existing test:

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/production-artifact-verifier.test.ts -t "rejects malformed quality report JSON" --maxWorkers=1
```

Expected: exit 1 because the `runVerifier` slice still contains `node_modules/tsx` and lacks the compiled path. The existing malformed-report assertion must still execute after GREEN.

- [ ] **Step 3: Make production-artifact verification consume the global build**

Add the compiled path near the module constants:

```ts
const verifierCompiled = resolve(process.cwd(), "dist/scripts/10-verify-production-artifacts.js");
```

Replace the `spawnSync` argv with:

```ts
const result = spawnSync(
  process.execPath,
  [verifierCompiled],
  {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      DB_PATH: artifacts.dbPath,
      STATS_PATH: artifacts.statsPath,
      QUALITY_REPORT_PATH: artifacts.reportPath,
      ...expectedHashes,
    },
  },
);
```

Run the complete file:

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/production-artifact-verifier.test.ts --maxWorkers=1 --reporter=verbose
```

Expected: 1 file, 21/21 tests, zero skipped, no timeout warnings.

- [ ] **Step 4: Replace per-row successful imports with one SQLite baseline snapshot**

Extend imports:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
```

Add the exact snapshot interface and helper state:

```ts
type ImportedFixtureSnapshot = {
  local: Buffer;
  external: Buffer;
};

let importedFixtureSnapshot: ImportedFixtureSnapshot | undefined;
```

After `runVerifier`, prepare the baseline once:

```ts
beforeAll(() => {
  const fixture = createImportFixture([{ node_type: "n8n-nodes-fixture.previous" }]);
  const initial = runImporter(fixture.root, fixture.externalPath);
  if (initial.status !== 0) {
    throw new Error(`Unable to prepare imported fixture: ${initial.stderr}`);
  }
  importedFixtureSnapshot = {
    local: readFileSync(fixture.localPath),
    external: readFileSync(fixture.externalPath),
  };
});

function createImportedFixture() {
  if (!importedFixtureSnapshot) throw new Error("Imported fixture snapshot is unavailable");
  const fixture = createImportFixture([]);
  writeFileSync(fixture.localPath, importedFixtureSnapshot.local);
  writeFileSync(fixture.externalPath, importedFixtureSnapshot.external);
  return fixture;
}
```

In the six-row empty/whitespace block, replace:

```ts
const fixture = createImportFixture([{ node_type: "n8n-nodes-fixture.previous" }]);
const initial = runImporter(fixture.root, fixture.externalPath);
expect(initial.status, initial.stderr).toBe(0);
```

with:

```ts
const fixture = createImportedFixture();
```

Keep the failed importer, verifier, four table assertions, FTS checks, and promotion checks unchanged.

Run:

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/external-candidates.test.ts -t "rejects empty or whitespace-only" --maxWorkers=1 --reporter=verbose
& $node ./node_modules/vitest/vitest.mjs run src/external-candidates.test.ts --maxWorkers=1
```

Expected: focused 6/6 and complete file 14/14, zero skipped, no timeout warnings.

- [ ] **Step 5: Add compiled-server settlement RED inside the existing metadata test**

Change the first compiled-start test to async and add two child lifecycle scenarios without creating new Vitest cases:

```ts
const signaled = spawn(process.execPath, ["-e", "process.kill(process.pid, 'SIGTERM')"], {
  stdio: "ignore",
});
const signaledSettlement = observeChildSettlement(signaled);
await signaledSettlement.closed;
expect(signaledSettlement.isClosed()).toBe(true);

const missing = spawn(join(tmpdir(), "knowledge-missing-executable"), [], { stdio: "ignore" });
const missingSettlement = observeChildSettlement(missing);
await missingSettlement.closed;
expect(missingSettlement.isClosed()).toBe(true);
```

Add this temporary throwing TDD stub below `ChildOutput` so the test compiles and fails for the intended missing behavior:

```ts
type ChildSettlement = { closed: Promise<void>; isClosed: () => boolean };

function observeChildSettlement(_process: ChildProcess): ChildSettlement {
  throw new Error("observeChildSettlement is not implemented");
}
```

Run:

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/compiled-start.test.ts -t "uses the emitted server path" --maxWorkers=1
```

Expected: exit 1 with `observeChildSettlement is not implemented`. Remove the throwing stub body during GREEN; it must not remain in the final diff.

- [ ] **Step 6: Implement pre-registered compiled-server settlement**

Add module state:

```ts
let childSettlement: ChildSettlement | undefined;
```

Replace the throwing stub with:

```ts
function observeChildSettlement(process: ChildProcess): ChildSettlement {
  let closed = false;
  let resolveClosed!: () => void;
  const closedPromise = new Promise<void>((resolve) => { resolveClosed = resolve; });
  const finish = () => {
    if (closed) return;
    closed = true;
    resolveClosed();
  };
  process.once("close", finish);
  process.once("error", () => {
    if (process.pid === undefined) finish();
  });
  return { closed: closedPromise, isClosed: () => closed };
}
```

Immediately after the real server `spawn`, register:

```ts
childSettlement = observeChildSettlement(child);
```

Replace `afterEach` with settlement-aware cleanup:

```ts
afterEach(async () => {
  if (child && childSettlement) {
    if (!childSettlement.isClosed() && child.exitCode === null && child.signalCode === null) {
      child.kill();
    }
    await childSettlement.closed;
  }
  child = undefined;
  childSettlement = undefined;
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});
```

Run:

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/compiled-start.test.ts --maxWorkers=1
```

Expected: 1 file, 2/2 tests, zero skipped; signal, missing executable, real readiness, and cleanup all settle.

- [ ] **Step 7: Add RED for top-level close while tree termination remains pending**

Extend the test-only control type before changing runner behavior:

```ts
terminationFactory?: (pid: number) => ProcessTreeTermination;
```

Inside the existing atomic deployment lifecycle test, add a pending termination handle and reuse the existing result-object pattern:

```ts
let pendingTerminationReleased = false;
const pendingTerminationOutcome = runDeploymentCommand(
  process.execPath,
  ["-e", ""],
  { cwd: process.cwd(), env: process.env },
  {
    deadlineMs: 5_000,
    terminationGraceMs: 100,
    triggerDeadlineOnExit: true,
    terminationFactory: () => ({
      completion: new Promise<string>(() => {}),
      release: () => {
        pendingTerminationReleased = true;
        return "pending termination released";
      },
    }),
  },
).then(
  (result) => ({ error: null, result }),
  (error: unknown) => ({ error, result: null }),
);
```

Await it with the existing signal/tree outcomes and require:

```ts
pendingResult.result === null
pendingResult.error instanceof DeploymentCommandError
pendingResult.error.cleanupSafe === false
/termination grace/is.test(String(pendingResult.error))
pendingTerminationReleased === true
```

Run only the existing atomic test. Expected RED: the runner ignores the injected factory, observes top-level close, and returns cleanup-safe before the pending handle's grace/release contract can win.

- [ ] **Step 8: Require child close plus successful termination completion**

In `beginDeadline`, select the factory without changing normal callers:

```ts
const createTermination = control.terminationFactory
  ?? ((pid: number) => process.platform === "win32"
    ? terminateWindowsProcessTree(pid)
    : terminatePosixProcessGroup(pid));
termination = createTermination(terminationTargetPid);
```

Extract the current POSIX completion/release object into `terminatePosixProcessGroup(pid)` so both platform paths share the factory signature.

```ts
function terminatePosixProcessGroup(pid: number): ProcessTreeTermination {
  const processGroup = -pid;
  return {
    completion: Promise.resolve().then(() => {
      process.kill(processGroup, "SIGKILL");
      return `processGroup=${processGroup} signal=SIGKILL`;
    }),
    release: () => `processGroup=${processGroup} release=not-required`,
  };
}
```

Track:

```ts
let childClosure: { status: number | null; signal: NodeJS.Signals | null } | null = null;
let terminationSucceeded = false;
```

Create one settlement function:

```ts
const tryFinishTimedOutCommand = () => {
  if (!timedOut || !childClosure || !terminationSucceeded || settled) return;
  if (terminationGraceExpiresAt === null || Date.now() >= terminationGraceExpiresAt) return;
  const { status, signal } = childClosure;
  finish(() => {
    const releaseDiagnostics = termination?.release() ?? "termination=unavailable";
    rejectCommand(new DeploymentCommandError(
      `Deployment stub exceeded ${deadlineMs}ms; termination grace confirmed closure and tree termination; `
      + `cleanupSafe=true termination=${terminationDiagnostics} release=${releaseDiagnostics}; `
      + diagnostics(status, signal),
      true,
    ));
  });
};
```

The termination promise fulfillment sets `terminationDiagnostics`, marks
`terminationSucceeded = true`, and calls `tryFinishTimedOutCommand()`. Rejection records
failure but never marks success. The child `close` handler stores
`childClosure = { status, signal }` and calls the same function. The existing grace
callback remains the sole incomplete/failed path, releases handles, destroys pipes, and
rejects `cleanupSafe: false`. Late events remain settle-once no-ops.

Run:

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/deployment-contract.test.ts -t "defines an atomic mcp-only deployment with authenticated count verification and rollback" --maxWorkers=1
& $node ./node_modules/vitest/vitest.mjs run src/deployment-contract.test.ts --maxWorkers=1
```

Expected: lifecycle focus 1/1 and complete file 9/9, zero skipped. The pending handle must be released by grace and never report cleanup-safe.

- [ ] **Step 9: Run cross-domain and static gates**

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/production-artifact-verifier.test.ts src/external-candidates.test.ts src/compiled-start.test.ts src/deployment-contract.test.ts --maxWorkers=1
& $node ./node_modules/typescript/bin/tsc -p tsconfig.json
git diff --check
git diff --name-only $taskBase
```

Expected: 4 files, 46/46 tests, zero skipped; TypeScript and diff check exit zero. The name-only result lists exactly the four assigned test files and no production or documentation file.

Do not run the complete 210-test suite. The controller owns the one fresh full run after independent review.

- [ ] **Step 10: Self-review, report, and commit**

Confirm:

- `runVerifier` contains the compiled JS path and no `node_modules/tsx`.
- The six-row external block contains no successful `initial = runImporter` call.
- Deployment cleanup-safe requires both child closure and successful termination completion.
- Compiled cleanup checks both `exitCode` and `signalCode` and awaits pre-registered settlement.
- Test count remains 210 and no timeout configuration changed.

Append RED/GREEN commands and outputs to `.superpowers/sdd/task-15-report.md`, then commit only the four test files:

```powershell
git add -- tools/n8n-knowledge-mcp/src/production-artifact-verifier.test.ts tools/n8n-knowledge-mcp/src/external-candidates.test.ts tools/n8n-knowledge-mcp/src/compiled-start.test.ts tools/n8n-knowledge-mcp/src/deployment-contract.test.ts
git commit -m "test(knowledge): stabilize final verification harness"
```

---

## Review and Completion Boundary

Generate a review package from the plan commit to the Task 15 head and require independent specification and code-quality approval. After approval, the controller runs one fresh Node 20 complete suite, TypeScript, diff check, and a new whole-branch review. Online build, image, GHCR, and VPS actions remain unauthorized and require separate SHA-bound approval.
