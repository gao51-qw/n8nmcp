# Knowledge Global Setup Settlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Knowledge MCP Vitest global runtime build settle deterministically after its 60-second build deadline plus one four-second termination grace, even when the compiler child never emits `close`.

**Architecture:** Extract the existing runtime build into an exported helper with production defaults and a narrow test-only control seam. Preserve all pre-deadline behavior; after timeout, record the kill result, wait one four-second grace, then destroy local pipes, unref the child, and reject exactly once if no close arrives. Extend an existing compiled-start test case with a deterministic child double so the suite remains 18 files and 210 tests.

**Tech Stack:** TypeScript, Node.js child processes and streams, Vitest 4 fake timers, Node 20.20.2.

## Global Constraints

- Production build deadline remains exactly 60,000 ms.
- Termination grace is exactly 4,000 ms.
- The forced rejection is scheduled no later than 64,000 ms after spawn, excluding normal event-loop scheduling delay.
- Keep exactly 18 Vitest files and 210 tests; do not add, remove, skip, retry, or weaken assertions.
- Run every test and TypeScript command with `C:\Users\0\AppData\Local\npm-cache\_npx\50885608f1fc53f3\node_modules\node\bin\node.exe`.
- Modify exactly `tools/n8n-knowledge-mcp/vitest.global-setup.ts` and `tools/n8n-knowledge-mcp/src/compiled-start.test.ts`.
- Do not modify production server or scripts, Vitest configuration, dependencies, lockfiles, generated databases, Docker assets, workflows, images, GHCR, VPS state, or unrelated timeout values.
- Do not access the network or run online knowledge builds.

---

### Task 16: Bound Global Runtime-Build Settlement

**Files:**
- Modify: `tools/n8n-knowledge-mcp/vitest.global-setup.ts`
- Modify: `tools/n8n-knowledge-mcp/src/compiled-start.test.ts`

**Interfaces:**
- Produces: `runRuntimeTestBuild(control?: RuntimeBuildControl): Promise<void>`.
- Produces: `RuntimeBuildChild`, the child-process subset used by the helper.
- Produces: `RuntimeBuildControl { spawnBuild?, buildDeadlineMs?, terminationGraceMs? }`.
- Preserves: the default global-setup export, the real `node .../typescript/bin/tsc -p tsconfig.json` invocation, successful build behavior, spawn-failure diagnostics, non-zero compiler failure diagnostics, and ordinary timeout-through-close behavior.

- [ ] **Step 1: Record the task base and add an exported-helper RED**

Record the implementation base before editing:

```powershell
$taskBase = git rev-parse HEAD
```

In the existing `uses the emitted server path and one global runtime build` test, after the existing source/config assertions and before spawning the signal child, add:

```ts
const globalSetup = await import("../vitest.global-setup.js") as {
  runRuntimeTestBuild?: (control?: unknown) => Promise<void>;
};
expect(globalSetup.runRuntimeTestBuild).toBeTypeOf("function");
```

Run only that existing test:

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/compiled-start.test.ts -t "uses the emitted server path" --maxWorkers=1
```

Expected RED: exit 1 because `runRuntimeTestBuild` is `undefined`. The Vitest case count remains two.

- [ ] **Step 2: Extract the current behavior behind the helper**

In `vitest.global-setup.ts`, replace the imports and module constants with:

```ts
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const BUILD_DEADLINE_MS = 60_000;
const TERMINATION_GRACE_MS = 4_000;
const packageRoot = fileURLToPath(new URL(".", import.meta.url));

type RuntimeBuildStream = {
  on(event: "data", listener: (chunk: unknown) => void): unknown;
  destroy(): unknown;
};

export type RuntimeBuildChild = {
  pid?: number;
  exitCode: number | null;
  signalCode: NodeJS.Signals | null;
  stdout: RuntimeBuildStream | null;
  stderr: RuntimeBuildStream | null;
  kill(): boolean;
  unref(): void;
  once(event: "error", listener: (error: Error) => void): unknown;
  once(
    event: "close",
    listener: (code: number | null, signal: NodeJS.Signals | null) => void,
  ): unknown;
};

type SpawnRuntimeBuild = (
  command: string,
  args: string[],
  options: { cwd: string; stdio: ["ignore", "pipe", "pipe"] },
) => RuntimeBuildChild;

export type RuntimeBuildControl = {
  spawnBuild?: SpawnRuntimeBuild;
  buildDeadlineMs?: number;
  terminationGraceMs?: number;
};
```

Replace the default function with a delegating export and move the existing Promise body into the named helper. At this RED/GREEN boundary, keep the current unbounded post-kill behavior; the next failing test proves the lifecycle defect:

```ts
export default async function buildRuntimeTestArtifacts(): Promise<void> {
  await runRuntimeTestBuild();
}

export async function runRuntimeTestBuild(control: RuntimeBuildControl = {}): Promise<void> {
  const compiler = resolve(packageRoot, "node_modules/typescript/bin/tsc");
  const args = [compiler, "-p", "tsconfig.json"];
  const startedAt = Date.now();
  const buildDeadlineMs = control.buildDeadlineMs ?? BUILD_DEADLINE_MS;
  const spawnBuild: SpawnRuntimeBuild = control.spawnBuild
    ?? ((command, commandArgs, options) => spawn(command, commandArgs, options));

  await new Promise<void>((resolveBuild, rejectBuild) => {
    const child = spawnBuild(process.execPath, args, {
      cwd: packageRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

    const diagnostics = (code: number | null, signal: NodeJS.Signals | null) =>
      `command=${process.execPath} ${args.join(" ")} elapsedMs=${Date.now() - startedAt} `
      + `code=${code} signal=${signal ?? "none"} stdout=${stdout} stderr=${stderr}`;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback();
    };

    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, buildDeadlineMs);

    child.once("error", (error) => {
      finish(() => rejectBuild(new Error(
        `Runtime test build failed to start: ${error.message}; ${diagnostics(child.exitCode, child.signalCode)}`,
      )));
    });
    child.once("close", (code, signal) => {
      if (timedOut) {
        finish(() => rejectBuild(new Error(
          `Runtime test build exceeded ${buildDeadlineMs}ms; ${diagnostics(code, signal)}`,
        )));
      } else if (code !== 0) {
        finish(() => rejectBuild(new Error(`Runtime test build failed; ${diagnostics(code, signal)}`)));
      } else {
        finish(resolveBuild);
      }
    });
  });
}
```

Run the focused test again. Expected GREEN: 1 passed, 1 skipped. This verifies the public seam without yet claiming the lifecycle bug is fixed.

- [ ] **Step 3: Add the no-close lifecycle RED inside the same test case**

Extend imports in `compiled-start.test.ts`:

```ts
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runRuntimeTestBuild,
  type RuntimeBuildChild,
} from "../vitest.global-setup.js";
```

Remove the temporary dynamic-import contract from Step 1 because the static import now provides the same interface contract.

At the end of the existing first test, after the missing-executable settlement assertions, add the following block. It uses fake timers only for this regression and restores real timers in `finally`:

```ts
vi.useFakeTimers();
try {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const events = new EventEmitter();
  let killCalls = 0;
  let unrefCalls = 0;
  const fakeChild = Object.assign(events, {
    pid: 43_210,
    exitCode: null,
    signalCode: null,
    stdout,
    stderr,
    kill: () => {
      killCalls += 1;
      return false;
    },
    unref: () => { unrefCalls += 1; },
  }) as RuntimeBuildChild;
  let outcome: Error | null | undefined;
  const observed = runRuntimeTestBuild({
    spawnBuild: () => fakeChild,
    buildDeadlineMs: 60_000,
    terminationGraceMs: 4_000,
  }).then(
    () => { outcome = null; },
    (error: unknown) => { outcome = error as Error; },
  );
  stdout.write("compiler stdout");
  stderr.write("compiler stderr");

  await vi.advanceTimersByTimeAsync(60_000);
  expect(killCalls).toBe(1);
  expect(outcome).toBeUndefined();
  await vi.advanceTimersByTimeAsync(3_999);
  expect(outcome).toBeUndefined();
  await vi.advanceTimersByTimeAsync(1);
  await observed;

  expect(outcome).toBeInstanceOf(Error);
  expect(String(outcome)).toContain("pid=43210");
  expect(String(outcome)).toContain("killRequested=false");
  expect(String(outcome)).toContain("killError=none");
  expect(String(outcome)).toContain("settlement=termination-grace");
  expect(String(outcome)).toContain("compiler stdout");
  expect(String(outcome)).toContain("compiler stderr");
  expect(stdout.destroyed).toBe(true);
  expect(stderr.destroyed).toBe(true);
  expect(unrefCalls).toBe(1);

  const settledMessage = String(outcome);
  events.emit("close", null, null);
  events.emit("error", new Error("late error"));
  expect(String(outcome)).toBe(settledMessage);
  expect(unrefCalls).toBe(1);

  const throwingStdout = new PassThrough();
  const throwingStderr = new PassThrough();
  const throwingEvents = new EventEmitter();
  let throwingUnrefCalls = 0;
  const throwingChild = Object.assign(throwingEvents, {
    pid: 43_211,
    exitCode: null,
    signalCode: null,
    stdout: throwingStdout,
    stderr: throwingStderr,
    kill: () => { throw new Error("kill refused"); },
    unref: () => { throwingUnrefCalls += 1; },
  }) as RuntimeBuildChild;
  let throwingOutcome: Error | null | undefined;
  const throwingObserved = runRuntimeTestBuild({
    spawnBuild: () => throwingChild,
    buildDeadlineMs: 60_000,
    terminationGraceMs: 4_000,
  }).then(
    () => { throwingOutcome = null; },
    (error: unknown) => { throwingOutcome = error as Error; },
  );
  await vi.advanceTimersByTimeAsync(64_000);
  await throwingObserved;
  expect(String(throwingOutcome)).toContain("pid=43211");
  expect(String(throwingOutcome)).toContain("killRequested=false");
  expect(String(throwingOutcome)).toContain("killError=kill refused");
  expect(String(throwingOutcome)).toContain("settlement=termination-grace");
  expect(throwingStdout.destroyed).toBe(true);
  expect(throwingStderr.destroyed).toBe(true);
  expect(throwingUnrefCalls).toBe(1);
} finally {
  vi.useRealTimers();
}
```

Run the focused test. Expected RED: after 64,000 ms of fake time, `outcome` remains `undefined`; stream-destroy, unref, and diagnostic assertions cannot pass. No real 64-second wait occurs.

- [ ] **Step 4: Implement the four-second termination grace**

In `runRuntimeTestBuild`, consume both deadline controls:

```ts
const terminationGraceMs = control.terminationGraceMs ?? TERMINATION_GRACE_MS;
```

Add state beside `timedOut` and `settled`:

```ts
let killRequested: boolean | null = null;
let killError = "none";
let terminationGrace: ReturnType<typeof setTimeout> | undefined;
```

Extend diagnostics:

```ts
const diagnostics = (
  code: number | null,
  signal: NodeJS.Signals | null,
  settlement: "close" | "termination-grace" | "ordinary",
) =>
  `command=${process.execPath} ${args.join(" ")} elapsedMs=${Date.now() - startedAt} `
  + `pid=${child.pid ?? "unknown"} code=${code} signal=${signal ?? "none"} `
  + `killRequested=${killRequested ?? "not-attempted"} killError=${killError} `
  + `settlement=${settlement} stdout=${stdout} stderr=${stderr}`;
```

Replace `finish` with a version that clears both handles:

```ts
const finish = (callback: () => void) => {
  if (settled) return;
  settled = true;
  clearTimeout(deadline);
  if (terminationGrace) clearTimeout(terminationGrace);
  callback();
};
```

Replace the deadline callback:

```ts
const deadline = setTimeout(() => {
  timedOut = true;
  try {
    killRequested = child.kill();
  } catch (error) {
    killRequested = false;
    killError = error instanceof Error ? error.message : String(error);
  }
  terminationGrace = setTimeout(() => {
    child.stdout?.destroy();
    child.stderr?.destroy();
    child.unref();
    finish(() => rejectBuild(new Error(
      `Runtime test build exceeded ${buildDeadlineMs}ms; `
      + diagnostics(child.exitCode, child.signalCode, "termination-grace"),
    )));
  }, terminationGraceMs);
}, buildDeadlineMs);
```

Replace the event handlers so timeout errors do not masquerade as spawn failures and all late events remain settle-once no-ops:

```ts
child.once("error", (error) => {
  if (timedOut) {
    if (killError === "none") killError = error.message;
    return;
  }
  finish(() => rejectBuild(new Error(
    `Runtime test build failed to start: ${error.message}; `
    + diagnostics(child.exitCode, child.signalCode, "ordinary"),
  )));
});
child.once("close", (code, signal) => {
  if (timedOut) {
    finish(() => rejectBuild(new Error(
      `Runtime test build exceeded ${buildDeadlineMs}ms; `
      + diagnostics(code, signal, "close"),
    )));
  } else if (code !== 0) {
    finish(() => rejectBuild(new Error(
      `Runtime test build failed; ${diagnostics(code, signal, "ordinary")}`,
    )));
  } else {
    finish(resolveBuild);
  }
});
```

Run:

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/compiled-start.test.ts -t "uses the emitted server path" --maxWorkers=1
& $node ./node_modules/vitest/vitest.mjs run src/compiled-start.test.ts --maxWorkers=1
```

Expected GREEN: focused 1/1 and file 2/2, zero skipped in the full file, with the fake child proving rejection only at the four-second grace boundary.

- [ ] **Step 5: Run cross-domain and static gates**

Run with fixed Node 20:

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/production-artifact-verifier.test.ts src/external-candidates.test.ts src/compiled-start.test.ts src/deployment-contract.test.ts --maxWorkers=1
& $node ./node_modules/typescript/bin/tsc -p tsconfig.json
git diff --check
git diff --name-only $taskBase
```

Expected: four files, 46/46 tests; TypeScript and diff check exit zero. Name-only output lists exactly:

```text
tools/n8n-knowledge-mcp/src/compiled-start.test.ts
tools/n8n-knowledge-mcp/vitest.global-setup.ts
```

Do not run the complete 210-test suite. The controller owns the fresh full run after independent review.

- [ ] **Step 6: Self-review, report, and commit**

Confirm:

- the default export still invokes the real compiler with 60,000/4,000 ms production defaults;
- success, spawn error, non-zero close, timeout close, and timeout grace each settle once;
- `kill()` false and thrown errors both still reach the grace path;
- grace expiry destroys both pipes and unrefs exactly once;
- late error and close events cannot change the settled outcome;
- the suite remains 18 files and 210 tests;
- only the two authorized files changed.

Write RED/GREEN commands and relevant outputs to `.superpowers/sdd/task-16-report.md`, then commit only the two implementation files:

```powershell
git add -- tools/n8n-knowledge-mcp/vitest.global-setup.ts tools/n8n-knowledge-mcp/src/compiled-start.test.ts
git commit -m "test(knowledge): bound global setup settlement"
```

## Review and Completion Boundary

Generate a Task 16 review package from `$taskBase` to the Task 16 head and require independent specification and code-quality approval. After approval, the controller runs one fresh fixed-Node-20 complete 18-file/210-test suite, TypeScript, diff check, and a new whole-branch lifecycle review. Network, image, GHCR, and VPS actions remain unauthorized.
