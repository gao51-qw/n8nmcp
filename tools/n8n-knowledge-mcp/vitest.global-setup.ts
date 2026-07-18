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

export default async function buildRuntimeTestArtifacts(): Promise<void> {
  await runRuntimeTestBuild();
}

export async function runRuntimeTestBuild(control: RuntimeBuildControl = {}): Promise<void> {
  const compiler = resolve(packageRoot, "node_modules/typescript/bin/tsc");
  const args = [compiler, "-p", "tsconfig.json"];
  const startedAt = Date.now();
  const buildDeadlineMs = control.buildDeadlineMs ?? BUILD_DEADLINE_MS;
  const terminationGraceMs = control.terminationGraceMs ?? TERMINATION_GRACE_MS;
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
    let killRequested: boolean | null = null;
    let killError = "none";
    let terminationGrace: ReturnType<typeof setTimeout> | undefined;

    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

    const diagnostics = (
      code: number | null,
      signal: NodeJS.Signals | null,
      settlement: "close" | "termination-grace" | "ordinary",
    ) =>
      `command=${process.execPath} ${args.join(" ")} elapsedMs=${Date.now() - startedAt} `
      + `pid=${child.pid ?? "unknown"} code=${code} signal=${signal ?? "none"} `
      + `killRequested=${killRequested ?? "not-attempted"} killError=${killError} `
      + `settlement=${settlement} stdout=${stdout} stderr=${stderr}`;

    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (terminationGrace) clearTimeout(terminationGrace);
      callback();
    };

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
  });
}
