# Knowledge Test Harness Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the remaining load-sensitive Knowledge MCP test failures by compiling emitted artifacts once per Vitest invocation and replacing the blocking, path-ambiguous deployment fixture with a deterministic asynchronous process boundary.

**Architecture:** Vitest global setup owns the single TypeScript build and fails before tests consume an incomplete `dist` tree. Deployment contract tests use an explicit Git Bash environment and an asynchronous `spawn` helper whose `error`, `close`, and execution deadline race without blocking the Node event loop. A separate bounded termination-confirmation grace handles failed tree termination without unsafe fixture cleanup.

**Tech Stack:** TypeScript, Node.js 20, Vitest 4, Node child-process APIs, Git Bash/MSYS on Windows.

## Global Constraints

- Compile runtime test artifacts exactly once per Vitest invocation; no test file or file-level hook may invoke `tsc`.
- Preserve all external-import, compiled-server health, successful-deployment, rollback, image-pinning, and mcp-only recreation assertions.
- Use explicit Git Bash and Git utility paths on Windows; never resolve Bash through the WSL shim or inherited host path order.
- Deployment subprocess handling must be asynchronous and bounded by a 30-second execution deadline followed, only on timeout, by a four-second termination-confirmation grace; the Vitest wrapper remains 35 seconds so helper diagnostics win.
- Grace expiry must reject with `cleanupSafe: false`, release local pipe/termination handles, and retain the fixture directory with its path in diagnostics. It must not retry the command or convert a failure into success.
- Compiler setup must be asynchronous and bounded by one terminating 60-second total deadline.
- Do not change production source, `deploy/update-knowledge.sh`, dependencies, lockfiles, generated databases, Dockerfiles, or release workflows.
- Do not increase global Vitest `testTimeout` or `hookTimeout`, skip platform coverage, retry failures, or weaken assertions.
- Run tests and TypeScript under Node 20.
- Do not access the network, download packages/templates, generate production databases, build images, push GHCR, or deploy VPS state.

---

### Task 13: Build Runtime Test Artifacts Once Per Vitest Invocation

**Files:**
- Create: `tools/n8n-knowledge-mcp/vitest.global-setup.ts`
- Modify: `tools/n8n-knowledge-mcp/vitest.config.ts`
- Modify: `tools/n8n-knowledge-mcp/src/external-candidates.test.ts`
- Modify: `tools/n8n-knowledge-mcp/src/compiled-start.test.ts`

**Interfaces:**
- Produces: default-exported Vitest global setup that prepares the package `dist` tree before tests start.
- Preserves: emitted paths `dist/scripts/7-import-external-candidates.js`, `dist/scripts/8-verify-external-nodes.js`, and `dist/src/server.js`.
- Preserves: compiled server readiness through HTTP health, child `error`/`exit`, and the existing 30-second server deadline.

- [ ] **Step 1: Extend the existing metadata test with a failing single-build contract**

Replace the existing `uses the emitted server path in package and Docker metadata`
test in `src/compiled-start.test.ts` with:

```ts
it("uses the emitted server path and one global runtime build", () => {
  const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
    scripts: { start: string };
  };
  const dockerfile = readFileSync(resolve("Dockerfile"), "utf8");
  const config = readFileSync(resolve("vitest.config.ts"), "utf8");
  const externalTest = readFileSync(resolve("src/external-candidates.test.ts"), "utf8");
  const compiledTest = readFileSync(resolve("src/compiled-start.test.ts"), "utf8");

  expect(packageJson.scripts.start).toBe("node dist/src/server.js");
  expect(dockerfile).toContain('CMD ["node", "dist/src/server.js"]');
  expect(config).toContain('globalSetup: ["./vitest.global-setup.ts"]');
  expect(externalTest).not.toMatch(/beforeAll\(\(\) => \{\s*execFileSync\([\s\S]*typescript\/bin\/tsc/);
  expect(compiledTest).not.toMatch(/execFileSync\([\s\S]*typescript\/bin\/tsc/);
});
```

The regex text is escaped in the source file, so it does not match its own literal; it matches only a real `execFileSync(...typescript/bin/tsc...)` call.

- [ ] **Step 2: Run the contract to verify RED**

Run from `tools/n8n-knowledge-mcp` with the approved Node 20 executable:

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/compiled-start.test.ts -t "uses the emitted server path and one global runtime build" --maxWorkers=1
```

Expected: FAIL because `vitest.config.ts` has no `globalSetup` and both test files still contain local compiler calls. Do not change production code or increase a timeout.

- [ ] **Step 3: Create asynchronous global setup**

Create `vitest.global-setup.ts`:

```ts
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const BUILD_DEADLINE_MS = 60_000;
const packageRoot = fileURLToPath(new URL(".", import.meta.url));

export default async function buildRuntimeTestArtifacts(): Promise<void> {
  const compiler = resolve(packageRoot, "node_modules/typescript/bin/tsc");
  const args = [compiler, "-p", "tsconfig.json"];
  const startedAt = Date.now();

  await new Promise<void>((resolveBuild, rejectBuild) => {
    const child = spawn(process.execPath, args, {
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
    }, BUILD_DEADLINE_MS);

    child.once("error", (error) => {
      finish(() => rejectBuild(new Error(
        `Runtime test build failed to start: ${error.message}; ${diagnostics(child.exitCode, child.signalCode)}`,
      )));
    });
    child.once("close", (code, signal) => {
      if (timedOut) {
        finish(() => rejectBuild(new Error(`Runtime test build exceeded ${BUILD_DEADLINE_MS}ms; ${diagnostics(code, signal)}`)));
      } else if (code !== 0) {
        finish(() => rejectBuild(new Error(`Runtime test build failed; ${diagnostics(code, signal)}`)));
      } else {
        finish(resolveBuild);
      }
    });
  });
}
```

Do not add a second fallback timer or retry. The direct compiler child has no grandchildren and must settle after `kill()`.

- [ ] **Step 4: Register setup and remove duplicate compilers**

Add to `vitest.config.ts` inside `test`:

```ts
globalSetup: ["./vitest.global-setup.ts"],
```

In `external-candidates.test.ts`:

- remove `beforeAll` from the Vitest import;
- delete the `beforeAll` block that runs `tsc`;
- retain `execFileSync` because the tracked-file assertions still use it.

In `compiled-start.test.ts`:

- remove `execFileSync` from the child-process import;
- delete the local `tsc` call at the start of the server test;
- keep the existing HTTP health/child event readiness helper and 30-second test limit unchanged.

- [ ] **Step 5: Verify GREEN for both consumers together**

Run:

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/external-candidates.test.ts src/compiled-start.test.ts --maxWorkers=1
```

Expected: 2 files pass, 16/16 tests pass, zero skipped. The extended metadata
contract proves setup registration and the absence of file-local compiler calls; no
hook timeout occurs.

Run TypeScript and diff checks:

```powershell
& $node ./node_modules/typescript/bin/tsc -p tsconfig.json
git diff --check
```

Expected: both exit zero.

- [ ] **Step 6: Self-review and commit Task 13**

Confirm only the four Task 13 files changed and the working patch contains exactly one `node_modules/typescript/bin/tsc` invocation, in `vitest.global-setup.ts`.

```powershell
git add -- tools/n8n-knowledge-mcp/vitest.global-setup.ts tools/n8n-knowledge-mcp/vitest.config.ts tools/n8n-knowledge-mcp/src/external-candidates.test.ts tools/n8n-knowledge-mcp/src/compiled-start.test.ts
git commit -m "test(knowledge): build runtime artifacts once"
```

---

### Task 14: Make Deployment Contract Execution Deterministic and Interruptible

**Files:**
- Modify: `tools/n8n-knowledge-mcp/src/deployment-contract.test.ts`

**Interfaces:**
- Changes test-only `runDeployStub(options)` from a synchronous result to `Promise<DeployStubResult>`.
- Produces: asynchronous child-process settlement over `error`, `close`, or one 30-second deadline.
- Preserves: the production deployment script and every healthy/rollback assertion.

- [ ] **Step 1: Capture focused RED under Node 20**

Run the two existing behavioral tests separately:

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/deployment-contract.test.ts -t "persists the new tag and recreates only mcp after a healthy deployment" --maxWorkers=1
& $node ./node_modules/vitest/vitest.mjs run src/deployment-contract.test.ts -t "pins the running image before changes and rolls latest back locally without pulling" --maxWorkers=1
```

Expected on the affected Windows host: each test fails at the default 5-second timeout after the synchronous Git Bash chain returns, reproducing the previously measured 10-12 second durations. If the host happens to run faster, temporarily prepend a fixture-only fake `bash` sentinel to the inherited host path for the RED test; do not edit production files or retain the sentinel after RED.

- [ ] **Step 2: Convert the behavioral tests to await the helper**

Change both tests to async and await `runDeployStub`:

```ts
it("persists the new tag and recreates only mcp after a healthy deployment", async () => {
  if (!existsSync(deployPath)) return;
  const result = await runDeployStub({ failFirstHealth: false });
  expect(result.status, result.stderr).toBe(0);
  expect(result.env).toContain("MCP_IMAGE_TAG=20260714-123");
  expect(result.log).toContain("pull ghcr.io/example/n8n-knowledge-mcp:20260714-123");
  expect(result.log).toContain("compose -f compose.yml up -d --no-deps mcp");
  expect(result.log).toContain("exec n8n-knowledge-mcp node");
  expect(result.log).toContain(" 42");
  expect(result.log).not.toMatch(/\b(?:app|caddy)\b/);
  expect(result.backupExists).toBe(false);
}, 35_000);

it("pins the running image before changes and rolls latest back locally without pulling", async () => {
  if (!existsSync(deployPath)) return;
  const oldImageId = `sha256:${"a".repeat(64)}`;
  const remoteLatestImageId = `sha256:${"b".repeat(64)}`;
  const result = await runDeployStub({
    currentImageId: oldImageId,
    failFirstHealth: true,
    oldTag: "latest",
    remoteLatestImageId,
  });
  expect(result.status).not.toBe(0);
  expect(result.env).toContain("MCP_IMAGE_TAG=latest");
  expect(result.log).toContain(`remote-latest=${remoteLatestImageId}`);
  expect(result.log).toMatch(
    new RegExp(`tag ${oldImageId} ghcr\\.io/example/n8n-knowledge-mcp:rollback-[A-Za-z0-9._-]+`),
  );
  const rollbackTag = result.log.match(
    /tag sha256:[a-f0-9]{64} ghcr\.io\/example\/n8n-knowledge-mcp:(rollback-[A-Za-z0-9._-]+)/,
  )?.[1];
  expect(rollbackTag).toBeDefined();
  expect(result.log).toContain(`compose-tag=${rollbackTag}`);
  expect(result.log).not.toContain("compose-tag=latest");
  expect(result.log).toMatch(/compose -f compose\.yml up -d --no-deps --pull never mcp/);
  expect(result.log.match(/exec n8n-knowledge-mcp node/g)).toHaveLength(2);
  expect(result.log).toContain(`image rm ghcr.io/example/n8n-knowledge-mcp:${rollbackTag}`);
  expect(result.log).not.toMatch(/\b(?:app|caddy)\b/);
}, 35_000);

it("fails before pull, tag persistence, or compose when the running image ID is unavailable", async () => {
  if (!existsSync(deployPath)) return;
  const result = await runDeployStub({ currentImageId: null, failFirstHealth: false });
  expect(result.status).not.toBe(0);
  expect(result.env).toContain("MCP_IMAGE_TAG=old-stable");
  expect(result.log).toContain("inspect --format {{.Image}} n8n-knowledge-mcp");
  expect(result.log).not.toMatch(/^(?:pull|tag|compose)\b/m);
  expect(result.backupExists).toBe(false);
}, 35_000);
```

- [ ] **Step 3: Make Bash and PATH deterministic**

Replace `spawnSync` with `spawn` in the child-process import.

Change the Docker stub shebang from:

```bash
#!/usr/bin/env bash
```

to:

```bash
#!/usr/bin/bash
```

Construct the shell and child path inside `runDeployStub`:

```ts
const bash = process.platform === "win32"
  ? "C:\\Program Files\\Git\\bin\\bash.exe"
  : "bash";
const childPath = process.platform === "win32"
  ? [
      bin,
      "C:\\Program Files\\Git\\usr\\bin",
      "C:\\Program Files\\Git\\bin",
      process.env.PATH ?? "",
    ].join(delimiter)
  : [bin, process.env.PATH ?? ""].join(delimiter);
```

Pass `PATH: childPath`. Do not use `where bash`, `command -v bash`, WSL, or a host-dependent search.

- [ ] **Step 4: Implement the asynchronous deployment runner**

Add test-only types and constants near `runDeployStub`:

```ts
const DEPLOY_STUB_DEADLINE_MS = 30_000;

type DeployCommandResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

type DeployStubResult = {
  status: number | null;
  stderr: string;
  env: string;
  log: string;
  backupExists: boolean;
};
```

Implement the process boundary:

```ts
async function runDeploymentCommand(
  bash: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
): Promise<DeployCommandResult> {
  const startedAt = Date.now();
  return await new Promise<DeployCommandResult>((resolveCommand, rejectCommand) => {
    const child = spawn(bash, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;

    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

    const diagnostics = (status: number | null, signal: NodeJS.Signals | null) =>
      `command=${bash} ${args.join(" ")} elapsedMs=${Date.now() - startedAt} `
      + `status=${status} signal=${signal ?? "none"} stdout=${stdout} stderr=${stderr}`;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback();
    };
    const deadline = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, DEPLOY_STUB_DEADLINE_MS);

    child.once("error", (error) => {
      finish(() => rejectCommand(new Error(
        `Deployment stub failed to start: ${error.message}; ${diagnostics(child.exitCode, child.signalCode)}`,
      )));
    });
    child.once("close", (status, signal) => {
      if (timedOut) {
        finish(() => rejectCommand(new Error(
          `Deployment stub exceeded ${DEPLOY_STUB_DEADLINE_MS}ms; ${diagnostics(status, signal)}`,
        )));
      } else {
        finish(() => resolveCommand({ status, signal, stdout, stderr }));
      }
    });
  });
}
```

Change the signature to:

```ts
async function runDeployStub(options: {
  currentImageId?: string | null;
  failFirstHealth: boolean;
  oldTag?: string;
  remoteLatestImageId?: string;
}): Promise<DeployStubResult> {
```

Keep the existing fixture creation and environment keys, but replace the synchronous
call with:

```ts
const result = await runDeploymentCommand(
  bash,
  [deployPath, "20260714-123", "42"],
  {
    cwd: root,
    env: {
      ...process.env,
      COMPOSE_FILE: "compose.yml",
      CURRENT_IMAGE_ID: options.currentImageId === null
        ? ""
        : options.currentImageId ?? `sha256:${"a".repeat(64)}`,
      DOCKER_LOG: logFile,
      ENV_FILE: envFile,
      FAIL_FIRST_HEALTH: options.failFirstHealth ? "1" : "0",
      HEALTH_STATE: healthState,
      REMOTE_LATEST_IMAGE_ID: options.remoteLatestImageId ?? `sha256:${"b".repeat(64)}`,
      PATH: childPath,
    },
  },
);
return {
  status: result.status,
  stderr: result.stderr,
  env: readFileSync(envFile, "utf8"),
  log: readFileSync(logFile, "utf8"),
  backupExists: existsSync(`${envFile}.bak`),
};
```

Keep the existing `finally` cleanup, which now runs only after the child settles.

- [ ] **Step 5: Verify focused GREEN and unchanged behavior**

Run:

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/deployment-contract.test.ts --maxWorkers=1
```

Expected: 1 file passes, 9/9 tests pass. The two process tests may take longer than five seconds on Windows, but must settle through the helper before 30 seconds and preserve all healthy/rollback assertions.

Run the cross-domain focused set:

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/external-candidates.test.ts src/compiled-start.test.ts src/deployment-contract.test.ts --maxWorkers=1
```

Expected: 3 files pass, 25/25 tests pass, zero skipped.

- [ ] **Step 6: Run the complete verification once**

Run:

```powershell
& $node ./node_modules/vitest/vitest.mjs run --maxWorkers=1
& $node ./node_modules/typescript/bin/tsc -p tsconfig.json
git diff --check
```

Expected: 18/18 test files and 210/210 tests pass with zero skipped; TypeScript and diff check exit zero.

- [ ] **Step 7: Self-review and commit Task 14**

Confirm only `src/deployment-contract.test.ts` changed since the Task 13 commit, the production deployment script is untouched, no `spawnSync` remains in the file, the Docker stub uses `/usr/bin/bash`, and no global timeout changed.

```powershell
git add -- tools/n8n-knowledge-mcp/src/deployment-contract.test.ts
git commit -m "test(knowledge): await deployment contract processes"
```

### Task 14 Review Repair: Bound Failed Termination Without Unsafe Cleanup

**Files:**
- Modify: `tools/n8n-knowledge-mcp/src/deployment-contract.test.ts`

**Interfaces:**
- Extends test-only `DeploymentCommandControl` with `terminationGraceMs?: number`, `triggerDeadlineOnExit?: boolean`, and `terminationTargetPid?: number`; normal callers use the four-second grace default, real child PID, and never trigger a deadline from `exit`.
- Produces: `DeploymentCommandError` with readonly `cleanupSafe: boolean`.
- Preserves: the 30-second execution deadline, 35-second behavioral wrappers, explicit Git Bash/PATH boundary, numeric-status rules, and every deployment assertion.

- [ ] **Step 1: Replace the current lifecycle fixture with the parent-exited RED**

In the existing `defines an atomic mcp-only deployment...` test, replace the tree fixture so the direct Node parent spawns a descendant with inherited stdout/stderr and exits immediately. Give the descendant a finite 2,000ms lifetime so a failed RED cannot leak indefinitely. Invoke `runDeploymentCommand` with `deadlineMs: 5_000`, `terminationGraceMs: 300`, `triggerDeadlineOnExit: true`, and `terminationTargetPid: 2_147_483_647`. The exit trigger must call the same idempotent handler used by the real execution timer; the target override must feed the real Windows `taskkill` or POSIX group-kill implementation. Neither may create a second implementation path.

The assertion must require deterministic rejection before 1,500ms, `cleanupSafe === false`, and diagnostics containing `termination grace` on every platform. Keep this inside the existing test so the suite remains 210 tests.

- [ ] **Step 2: Run the lifecycle test and verify the correct RED**

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/deployment-contract.test.ts -t "defines an atomic mcp-only deployment with authenticated count verification and rollback" --maxWorkers=1
```

Expected before implementation: exit 1 because the parent-exited descendant keeps the inherited pipe open beyond the new bounded-settlement assertion, or because the old helper lacks `terminationGraceMs`/`triggerDeadlineOnExit`/`terminationTargetPid`/`cleanupSafe`. A TypeScript signature failure alone does not count; use a temporary test-local type adaptation until the behavioral failure executes, then remove it before GREEN.

- [ ] **Step 3: Implement a single bounded termination-confirmation stage**

Add:

```ts
const DEPLOY_TERMINATION_GRACE_MS = 4_000;

class DeploymentCommandError extends Error {
  constructor(message: string, readonly cleanupSafe: boolean) {
    super(message);
    this.name = "DeploymentCommandError";
  }
}
```

Extend `DeploymentCommandControl` with `terminationGraceMs?: number`, `triggerDeadlineOnExit?: boolean`, and `terminationTargetPid?: number`. Extract the execution timer callback into one idempotent deadline handler. The normal timer and, only when explicitly enabled by the regression, the direct child's `exit` event call that same handler. The handler terminates `control.terminationTargetPid ?? child.pid`, so normal callers always use the real child PID. Start the existing Windows tree termination or POSIX process-group termination and one grace timer. If `close` is confirmed, clear both timers and reject the original timeout with `cleanupSafe: true`. If grace expires first, stop waiting on the termination command, destroy the original child's local stdout/stderr streams, unref any still-running termination helper, and reject exactly once with `cleanupSafe: false` plus command, elapsed, termination, and fixture diagnostics. Late `close`, `error`, or termination completion must be settle-once no-ops.

Change the Windows termination helper to return both its completion promise and a release function so the single grace timer can destroy its pipes, attempt to kill it, and unref it. Do not add retries or another timer.

- [ ] **Step 4: Gate fixture cleanup on the error contract**

In `runDeployStub`, track whether cleanup remains safe. A `DeploymentCommandError` with `cleanupSafe: false` must be rethrown with `fixtureRetained=<root>` diagnostics and must skip `rmSync(root, ...)`. All pre-spawn errors, confirmed closures, normal numeric exits, and unrelated post-command assertion/read failures retain existing cleanup behavior.

- [ ] **Step 5: Verify focused GREEN and static scope**

```powershell
& $node ./node_modules/vitest/vitest.mjs run src/deployment-contract.test.ts --maxWorkers=1
& $node ./node_modules/typescript/bin/tsc -p tsconfig.json
git diff --check
git diff --name-only 3c229b4
```

Expected: 1 file, 9/9 tests, zero skipped; TypeScript and diff check exit zero; only the design, plan, and `tools/n8n-knowledge-mcp/src/deployment-contract.test.ts` differ from `3c229b4`; production deployment code and global timeout configuration remain unchanged.

- [ ] **Step 6: Commit the review repair**

```powershell
git add -- docs/superpowers/specs/2026-07-15-knowledge-test-harness-stability-design.md docs/superpowers/plans/2026-07-15-knowledge-test-harness-stability.md tools/n8n-knowledge-mcp/src/deployment-contract.test.ts
git commit -m "test(knowledge): bound deployment termination grace"
```

---

## Review and External Evidence Boundary

After each task, generate a review package from its recorded base to head and require independent specification and code-quality approval. After Task 14, run one broad final branch review and controller-owned fresh Node 20 verification.

The resulting final commit still requires a new explicit SHA-bound authorization before a clean Linux online build, image build, or authenticated smoke. GHCR and VPS remain unauthorized.
