import Database from "better-sqlite3";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";

let child: ChildProcess | undefined;
let temporaryDirectory: string | undefined;

afterEach(async () => {
  if (child && child.exitCode === null) {
    child.kill();
    await new Promise<void>((resolveExit) => child!.once("exit", () => resolveExit()));
  }
  child = undefined;
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe("compiled server entrypoint", () => {
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
