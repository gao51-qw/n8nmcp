import Database from "better-sqlite3";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
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
  it("uses the emitted server path in package and Docker metadata", () => {
    const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as {
      scripts: { start: string };
    };
    const dockerfile = readFileSync(resolve("Dockerfile"), "utf8");

    expect(packageJson.scripts.start).toBe("node dist/src/server.js");
    expect(dockerfile).toContain('CMD ["node", "dist/src/server.js"]');
  });

  it("builds and starts the compiled server, then serves anonymous health", async () => {
    execFileSync(
      process.execPath,
      [resolve("node_modules/typescript/bin/tsc"), "-p", "tsconfig.json"],
      { stdio: "pipe" },
    );
    temporaryDirectory = mkdtempSync(join(tmpdir(), "knowledge-compiled-start-"));
    const dbPath = join(temporaryDirectory, "nodes.db");
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE nodes (is_ai_tool INTEGER, is_trigger INTEGER, is_webhook INTEGER);
      CREATE TABLE templates (id INTEGER PRIMARY KEY);
    `);
    db.close();
    const port = await reservePort();
    let stderr = "";
    child = spawn(process.execPath, [resolve("dist/src/server.js")], {
      env: { ...process.env, AUTH_TOKEN: "compiled-smoke", DB_PATH: dbPath, PORT: String(port) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

    const response = await waitForHealth(`http://127.0.0.1:${port}/health`, () => stderr);
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

async function waitForHealth(url: string, stderr: () => string): Promise<Response> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      return await fetch(url);
    } catch {
      if (child?.exitCode !== null) throw new Error(`Compiled server exited early: ${stderr()}`);
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
  }
  throw new Error(`Compiled server did not become healthy: ${stderr()}`);
}
