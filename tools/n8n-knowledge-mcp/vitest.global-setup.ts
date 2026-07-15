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
