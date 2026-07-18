import Database from "better-sqlite3";
import { spawn, type ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  runRuntimeTestBuild,
  type RuntimeBuildChild,
} from "../vitest.global-setup.js";

let child: ChildProcess | undefined;
let childSettlement: ChildSettlement | undefined;
let temporaryDirectory: string | undefined;

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

describe("compiled server entrypoint", () => {
  it("uses the emitted server path and one global runtime build", async () => {
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
  });

  it("builds and starts the compiled server, then serves anonymous health", async () => {
    const deadline = Date.now() + 29_000;
    temporaryDirectory = mkdtempSync(join(tmpdir(), "knowledge-compiled-start-"));
    const dbPath = join(temporaryDirectory, "nodes.db");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE nodes (is_ai_tool INTEGER, is_trigger INTEGER, is_webhook INTEGER);
      CREATE TABLE templates (id INTEGER PRIMARY KEY);
    `);
    db.close();
    const port = await reservePort();
    let stdout = "";
    let stderr = "";
    child = spawn(process.execPath, [resolve("dist/src/server.js")], {
      env: { ...process.env, AUTH_TOKEN: "compiled-smoke", DB_PATH: dbPath, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    childSettlement = observeChildSettlement(child);
    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

    const response = await waitForHealth(
      `http://127.0.0.1:${port}/health`,
      child,
      { stdout: () => stdout, stderr: () => stderr },
      deadline,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  }, 30_000);
});

async function reservePort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Unable to reserve a TCP port");
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
  return address.port;
}

type ChildOutput = {
  stdout: () => string;
  stderr: () => string;
};

type ChildSettlement = { closed: Promise<void>; isClosed: () => boolean };

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
      finish(() => rejectHealth(new Error(
        `Compiled server did not become healthy before deadline: ${diagnostics()}`,
      )));
    };

    void poll();
  });
}
