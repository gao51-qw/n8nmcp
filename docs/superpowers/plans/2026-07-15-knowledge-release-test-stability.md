# Knowledge Release Test Stability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the two confirmed test-harness timing defects that block the fresh Node 20 Linux release suite without weakening product behavior, validation rules, or test timeouts.

**Architecture:** Keep all production import, verification, server, database, and health behavior unchanged. Compile the external-candidate CLI scripts once per test file and execute emitted JavaScript for data-driven fixtures while retaining one `tsx` smoke per CLI entrypoint; separately replace the compiled-server attempt counter with a condition-driven race among health readiness, child error, child exit, and one overall test deadline.

**Tech Stack:** TypeScript, Node.js 20, Vitest, child_process, better-sqlite3.

## Global Constraints

- Do not change importer, verifier, server, database, health endpoint, knowledge quality, or release behavior.
- Do not increase Vitest's default 5,000 ms test timeout and do not change the existing 30,000 ms compiled-start test timeout.
- Do not replace one arbitrary retry count with a larger arbitrary retry count.
- Preserve all malformed/empty JSON, rollback, FTS parity, CLI help, emitted-entrypoint, and anonymous-health assertions.
- Run tests and TypeScript under Node 20.
- Do not add dependencies.
- Do not access the network, download packages/templates, generate the production knowledge database, build images, push GHCR, or deploy VPS state.
- Each task must commit only its listed files and must receive an independent spec/code-quality review before the next task.

---

### Task 10: Run Data-Driven External Candidate Checks Against Emitted JavaScript

**Files:**
- Modify: `tools/n8n-knowledge-mcp/src/external-candidates.test.ts`

**Interfaces:**
- Consumes: the existing TypeScript compiler at `node_modules/typescript/bin/tsc`.
- Produces: ignored emitted entrypoints `dist/scripts/7-import-external-candidates.js` and `dist/scripts/8-verify-external-nodes.js` once in `beforeAll`.
- Preserves: the two existing `tsx` `--help` tests as CLI-loader wiring smoke.

- [ ] **Step 1: Preserve and cite the confirmed RED evidence**

Record the existing fresh Node 20 Linux failure from `.superpowers/sdd/knowledge-release-evidence.md`:

```text
external-candidates.test.ts:
5 tests timed out at 5000 ms
malformed properties_schema / credentials_required / operations
empty and whitespace-only properties_schema
```

The root-cause report `.superpowers/sdd/root-cause-external-candidates.md` proves each failed case synchronously launches two or three full `node -> tsx -> TypeScript CLI -> SQLite` processes and that the underlying direct-compiled work completes correctly in 1.26-2.11 seconds.

- [ ] **Step 2: Add one compile boundary for data-driven integration cases**

Change the Vitest import and add emitted script constants:

```ts
import { afterEach, beforeAll, describe, expect, it } from "vitest";

const packageRoot = process.cwd();
const tsxCli = resolve(packageRoot, "node_modules/tsx/dist/cli.mjs");
const importCompiled = resolve(packageRoot, "dist/scripts/7-import-external-candidates.js");
const verifyCompiled = resolve(packageRoot, "dist/scripts/8-verify-external-nodes.js");
```

Compile once before the file's tests:

```ts
beforeAll(() => {
  execFileSync(
    process.execPath,
    [resolve(packageRoot, "node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
    { cwd: packageRoot, stdio: "pipe" },
  );
});
```

Do not add a hook timeout; the existing hook budget is sufficient for the measured Node 20 compile.

- [ ] **Step 3: Keep CLI-loader smoke and move fixtures to emitted entrypoints**

Keep the `--help` tests on `tsx` by using `tsxCli` and the source paths. Change only the data-fixture helpers:

```ts
function runImporter(root: string, externalPath: string) {
  return spawnSync(
    process.execPath,
    [importCompiled],
    {
      cwd: root,
      encoding: "utf8",
      env: { ...process.env, EXTERNAL_N8N_MCP_DB: externalPath },
    },
  );
}

function runVerifier(root: string) {
  return spawnSync(
    process.execPath,
    [verifyCompiled],
    { cwd: root, encoding: "utf8", env: process.env },
  );
}
```

The help-path launch remains:

```ts
const result = spawnSync(
  process.execPath,
  [tsxCli, resolve(packageRoot, file), "--help"],
  { cwd: packageRoot, encoding: "utf8" },
);
```

- [ ] **Step 4: Verify focused GREEN and compile safety**

Run:

```powershell
npx.cmd --offline --yes node@20 ./node_modules/vitest/vitest.mjs run src/external-candidates.test.ts --maxWorkers=1
npx.cmd --offline --yes node@20 ./node_modules/typescript/bin/tsc -p tsconfig.json
git diff --check
```

Expected: `external-candidates.test.ts` passes 14/14 with no 5,000 ms timeout; TypeScript and diff check exit 0. Confirm `git status --short` lists only `src/external-candidates.test.ts`.

- [ ] **Step 5: Commit**

```powershell
git add -- tools/n8n-knowledge-mcp/src/external-candidates.test.ts
git commit -m "test(knowledge): avoid repeated tsx fixture startups"
```

---

### Task 11: Make Compiled Server Readiness Condition-Driven

**Files:**
- Modify: `tools/n8n-knowledge-mcp/src/compiled-start.test.ts`

**Interfaces:**
- Consumes: spawned `ChildProcess`, anonymous health URL, captured stdout/stderr, and one absolute deadline created before `tsc`.
- Produces: `waitForHealth(url, child, output, deadline): Promise<Response>`.
- Rejects immediately on child `error` or pre-readiness `exit`, with PID/exit/signal/stdout/stderr diagnostics.

- [ ] **Step 1: Preserve and cite the confirmed RED evidence**

Record the fresh Linux failure:

```text
compiled-start.test.ts:
Compiled server did not become healthy
```

The root-cause report `.superpowers/sdd/root-cause-compiled-start.md` proves the current loop rejects a live child at approximately 4,996.8 ms while the unchanged child prints `listening` at 5,035.5 ms and returns anonymous health 200 at 5,076.8 ms.

- [ ] **Step 2: Capture a single outer deadline and complete process telemetry**

At the beginning of the async test, before `tsc`, add:

```ts
const deadline = Date.now() + 29_000;
```

Capture both streams:

```ts
let stdout = "";
let stderr = "";
child = spawn(process.execPath, [resolve("dist/src/server.js")], {
  env: { ...process.env, AUTH_TOKEN: "compiled-smoke", DB_PATH: dbPath, PORT: String(port) },
  stdio: ["ignore", "pipe", "pipe"],
});
child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
```

Call:

```ts
const response = await waitForHealth(
  `http://127.0.0.1:${port}/health`,
  child,
  { stdout: () => stdout, stderr: () => stderr },
  deadline,
);
```

- [ ] **Step 3: Replace the attempt counter with a condition-driven race**

Use this interface and behavior:

```ts
type ChildOutput = {
  stdout: () => string;
  stderr: () => string;
};

async function waitForHealth(
  url: string,
  process: ChildProcess,
  output: ChildOutput,
  deadline: number,
): Promise<Response> {
  return await new Promise<Response>((resolveHealth, rejectHealth) => {
    let settled = false;

    const diagnostics = () =>
      `pid=${process.pid ?? "unknown"} exit=${process.exitCode ?? "running"} `
      + `signal=${process.signalCode ?? "none"} stdout=${output.stdout()} stderr=${output.stderr()}`;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      process.off("error", onError);
      process.off("exit", onExit);
      callback();
    };

    const onError = (error: Error) => {
      finish(() => rejectHealth(new Error(`Compiled server spawn failed: ${error.message}; ${diagnostics()}`)));
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      finish(() => rejectHealth(new Error(
        `Compiled server exited before health: code=${code} signal=${signal}; ${diagnostics()}`,
      )));
    };

    process.once("error", onError);
    process.once("exit", onExit);

    const poll = async () => {
      while (!settled && Date.now() < deadline) {
        const remaining = deadline - Date.now();
        try {
          const response = await fetch(url, {
            signal: AbortSignal.timeout(Math.max(1, Math.min(500, remaining))),
          });
          finish(() => resolveHealth(response));
          return;
        } catch {
          await new Promise((resolveWait) => setTimeout(resolveWait, Math.min(50, Math.max(1, remaining))));
        }
      }
      finish(() => rejectHealth(new Error(`Compiled server did not become healthy before deadline: ${diagnostics()}`)));
    };

    void poll();
  });
}
```

Do not key readiness solely to the stdout message; the actual HTTP response remains the success condition.

- [ ] **Step 4: Verify focused GREEN and regression safety**

Run:

```powershell
npx.cmd --offline --yes node@20 ./node_modules/vitest/vitest.mjs run src/compiled-start.test.ts src/server-health.test.ts --maxWorkers=1
npx.cmd --offline --yes node@20 ./node_modules/vitest/vitest.mjs run --maxWorkers=1
npx.cmd --offline --yes node@20 ./node_modules/typescript/bin/tsc -p tsconfig.json
git diff --check
```

Expected: focused tests and all 206 Knowledge tests pass with zero failures; TypeScript and diff check exit 0. Confirm no source or release behavior changed and `git status --short` lists only `src/compiled-start.test.ts` before commit.

- [ ] **Step 5: Commit**

```powershell
git add -- tools/n8n-knowledge-mcp/src/compiled-start.test.ts
git commit -m "test(knowledge): await compiled server readiness"
```

---

## Final branch verification

After both task reviews are clean:

```powershell
npx.cmd --offline --yes node@20 ./node_modules/vitest/vitest.mjs run --maxWorkers=1
npx.cmd --offline --yes node@20 ./node_modules/typescript/bin/tsc -p tsconfig.json
git diff --check
```

Expected: 18/18 files and 206/206 tests pass, TypeScript and diff check exit 0. This local verification does not authorize another online build, image push, or VPS action.
