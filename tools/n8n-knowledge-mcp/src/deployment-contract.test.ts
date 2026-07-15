import { spawn, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(process.cwd(), "../..");
const workflowPath = resolve(repositoryRoot, ".github/workflows/n8n-knowledge-mcp.yml");
const deployPath = resolve(repositoryRoot, "deploy/update-knowledge.sh");
const packagePath = resolve(process.cwd(), "package.json");
const fetchScriptPath = resolve(process.cwd(), "scripts/1-fetch-packages.ts");
const workflow = readFileSync(workflowPath, "utf8");
const deploy = existsSync(deployPath) ? readFileSync(deployPath, "utf8") : "";
const pkg = JSON.parse(readFileSync(packagePath, "utf8"));
const fetchScript = readFileSync(fetchScriptPath, "utf8");

describe("knowledge publication and deployment contracts", () => {
  it("keeps weekly/manual entry points and makes the official/fallback paths fail closed", () => {
    expect(workflow).toContain('cron: "0 2 * * 1"');
    expect(workflow).toMatch(/^\s*workflow_dispatch:\s*$/m);
    expect(workflow).toContain("continue-on-error: true");
    expect(workflow).toContain("if: steps.official.outcome == 'success'");
    expect(workflow).toContain("if: steps.official.outcome != 'success'");
    expect(pkg.scripts["build:nodes:official"]).toContain("--official-only");
    expect(pkg.scripts["build:knowledge"]).toContain("npm run build:nodes:official");
    expect(step(workflow, "Build node database")).toContain("npm run build:nodes:official");
    expect(fetchScript).toContain("shouldSkipCommunityPackages(process.argv");
    expect(fetchScript).toMatch(
      /assertOfficialPackageCoverage\(CFG\.official as string\[\], index\)/,
    );

    expectOrdered(workflow, [
      "name: Fetch official templates",
      "name: Build and verify official template database",
      "name: Build curated fallback database",
      "name: Upload degraded fallback",
      "name: Stop after degraded fallback",
      "name: Verify production artifacts",
      "name: Build local Linux image",
    ]);

    const fallback = step(workflow, "Build curated fallback database");
    expect(fallback).toContain("data/curated-templates");
    expect(fallback).toContain("npm run verify:knowledge:fallback");
    expect(step(workflow, "Upload degraded fallback")).toContain("degraded-knowledge-fallback");
    expect(step(workflow, "Stop after degraded fallback")).toMatch(/run:\s*exit 1/);
    expect(step(workflow, "Verify production artifacts")).toContain(
      "npm run verify:production-artifacts",
    );
  });

  it("smokes the local image before publishing immutable/latest from that same image", () => {
    expectOrdered(workflow, [
      "name: Build local Linux image",
      "name: Smoke local image",
      "name: Login to GHCR",
      "name: Push immutable image",
      "name: Push latest image",
      "name: Deploy immutable image to VPS",
    ]);

    const build = step(workflow, "Build local Linux image");
    const smoke = step(workflow, "Smoke local image");
    const immutable = step(workflow, "Push immutable image");
    const latest = step(workflow, "Push latest image");
    expect(build).toContain('knowledge-local:${GITHUB_RUN_ID}');
    expect(smoke).toContain('knowledge-local:${GITHUB_RUN_ID}');
    expect(smoke).toContain("AUTH_TOKEN");
    expect(smoke).toContain("knowledge-quality-report.json");
    expect(smoke).toMatch(/body\.templates\s*!==\s*Number\(expected\)/);
    expect(immutable).toContain(
      'docker tag "knowledge-local:${GITHUB_RUN_ID}" "ghcr.io/${GITHUB_REPOSITORY_OWNER}/n8n-knowledge-mcp:${IMMUTABLE_TAG}"',
    );
    expect(latest).toContain(
      'docker tag "knowledge-local:${GITHUB_RUN_ID}" "ghcr.io/${GITHUB_REPOSITORY_OWNER}/n8n-knowledge-mcp:latest"',
    );
  });

  it("installs strict known_hosts and deploys with the immutable tag and expected count", () => {
    expect(workflow).not.toContain("StrictHostKeyChecking=no");
    expectOrdered(workflow, [
      "name: Install VPS SSH credentials",
      "VPS_KNOWN_HOSTS",
      "name: Deploy immutable image to VPS",
    ]);
    const ssh = step(workflow, "Install VPS SSH credentials");
    expect(ssh).toContain("chmod 600 ~/.ssh/id_ed25519 ~/.ssh/known_hosts");
    const deployStep = step(workflow, "Deploy immutable image to VPS");
    expect(deployStep).toContain("StrictHostKeyChecking=yes");
    expect(deployStep).toContain("../../deploy/update-knowledge.sh");
    expect(deployStep).toContain("'${IMMUTABLE_TAG}' '${EXPECTED_TEMPLATES}'");
  });

  it("defines an atomic mcp-only deployment with authenticated count verification and rollback", async () => {
    expect(existsSync(deployPath)).toBe(true);
    expect(deploy).toMatch(/OLD_TAG=.*MCP_IMAGE_TAG=/s);
    expect(deploy).toContain("mktemp");
    expect(deploy).toContain("awk");
    expect(deploy).toContain(".bak");
    expect(deploy).toContain("trap rollback ERR");
    expect(deploy).toContain("n8n-knowledge-mcp");
    expect(deploy).toContain("process.env.AUTH_TOKEN");
    expect(deploy).toMatch(/body\.templates\s*!==\s*Number\(expected\)/);
    expect(deploy.match(/docker compose[^\n]+up[^\n]+\bmcp\b/g)?.length).toBeGreaterThanOrEqual(2);
    expect(deploy).toContain("--pull never");
    expectOrdered(deploy, [
      'rm -f -- "${ENV_FILE}.bak"',
      'docker image rm "${IMAGE}:${ROLLBACK_TAG}"',
    ]);
    expect(deploy).not.toMatch(/docker compose[^\n]+(?:up|restart|stop)[^\n]+\b(?:app|caddy)\b/);

    const signalOutcome = runDeploymentCommand(
      process.execPath,
      ["-e", "setTimeout(() => {}, 2_500)"],
      { cwd: process.cwd(), env: process.env },
      { onSpawn: (child: ChildProcess) => { child.kill("SIGTERM"); } },
    ).then(
      (result) => `resolved status=${result.status} signal=${result.signal}`,
      (error: unknown) => String(error),
    );
    const descendantLifetimeMs = 4_000;
    const treeCloseLimitMs = 3_000;
    const treeStartedAt = Date.now();
    const treeOutcome = runDeploymentCommand(
      process.execPath,
      [
        "-e",
        `const { spawn } = require("node:child_process");
const descendant = spawn(process.execPath, ["-e", "setTimeout(() => {}, ${descendantLifetimeMs})"], {
  stdio: "inherit",
});
descendant.once("error", (error) => { throw error; });
setTimeout(() => {}, ${descendantLifetimeMs});`,
      ],
      { cwd: process.cwd(), env: process.env },
      { deadlineMs: 100 },
    ).then(
      (result) => `resolved status=${result.status} signal=${result.signal}`,
      (error: unknown) => String(error),
    );
    const [signalResult, treeResult] = await Promise.all([signalOutcome, treeOutcome]);
    const treeElapsedMs = Date.now() - treeStartedAt;
    expect({
      signalRejected: /unexpected signal.*SIGTERM/is.test(signalResult),
      treeRejected: /exceeded 100ms/is.test(treeResult),
      treeClosedPromptly: treeElapsedMs < treeCloseLimitMs,
    }, `signal=${signalResult}\ntree=${treeResult}\ntreeElapsedMs=${treeElapsedMs}`).toEqual({
      signalRejected: true,
      treeRejected: true,
      treeClosedPromptly: true,
    });
  });

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

  it.each([
    ["remote deployment", () => extractBetween(
      deploy,
      "docker exec n8n-knowledge-mcp node -e '\n",
      "\n  ' \"$expected\"",
    )],
    ["workflow smoke", () => extractBetween(
      step(workflow, "Smoke local image"),
      "node <<'NODE'\n",
      "\n          NODE",
    )],
  ])("keeps invalid JSON response fragments out of %s health stderr", async (_label, code) => {
    const marker = "SENSITIVE_RESPONSE_MARKER";
    const result = await runEmbeddedHealth(code(), marker);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("health response was not valid JSON");
    expect(result.stderr).not.toContain(marker);
  });
});

function step(contents: string, name: string): string {
  const start = contents.indexOf(`- name: ${name}`);
  expect(start, `missing workflow step: ${name}`).toBeGreaterThanOrEqual(0);
  const next = contents.indexOf("\n      - ", start + 1);
  return contents.slice(start, next < 0 ? undefined : next);
}

function expectOrdered(contents: string, markers: string[]): void {
  let previous = -1;
  for (const marker of markers) {
    const index = contents.indexOf(marker, previous + 1);
    expect(index, `missing or out-of-order marker: ${marker}`).toBeGreaterThan(previous);
    previous = index;
  }
}

const DEPLOY_STUB_DEADLINE_MS = 30_000;

type DeployCommandResult = {
  status: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

type DeploymentCommandControl = {
  deadlineMs?: number;
  onSpawn?: (child: ChildProcess) => void;
};

type DeployStubResult = {
  status: number | null;
  stderr: string;
  env: string;
  log: string;
  backupExists: boolean;
};

async function runDeploymentCommand(
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv },
  control: DeploymentCommandControl = {},
): Promise<DeployCommandResult> {
  const startedAt = Date.now();
  return await new Promise<DeployCommandResult>((resolveCommand, rejectCommand) => {
    const child = spawn(command, args, {
      ...options,
      detached: process.platform !== "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let settled = false;
    let postSpawnError: Error | null = null;
    let terminationPromise: Promise<string> | null = null;

    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });

    const diagnostics = (status: number | null, signal: NodeJS.Signals | null) =>
      `command=${command} ${args.join(" ")} elapsedMs=${Date.now() - startedAt} `
      + `status=${status} signal=${signal ?? "none"} stdout=${stdout} stderr=${stderr}`
      + ` postSpawnError=${postSpawnError?.message ?? "none"}`;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      callback();
    };
    const deadlineMs = control.deadlineMs ?? DEPLOY_STUB_DEADLINE_MS;
    const deadline = setTimeout(() => {
      timedOut = true;
      if (child.pid === undefined) {
        terminationPromise = Promise.resolve("pid=unavailable");
      } else if (process.platform === "win32") {
        terminationPromise = terminateWindowsProcessTree(child.pid);
      } else {
        terminationPromise = Promise.resolve().then(() => {
          process.kill(-child.pid!, "SIGKILL");
          return `processGroup=${-child.pid!} signal=SIGKILL`;
        });
      }
    }, deadlineMs);

    child.once("error", (error) => {
      if (child.pid === undefined) {
        finish(() => rejectCommand(new Error(
          `Deployment stub failed to start: ${error.message}; ${diagnostics(child.exitCode, child.signalCode)}`,
        )));
      } else {
        postSpawnError ??= error;
      }
    });
    child.once("spawn", () => {
      try {
        control.onSpawn?.(child);
      } catch (error) {
        postSpawnError ??= error instanceof Error ? error : new Error(String(error));
      }
    });
    child.once("close", async (status, signal) => {
      if (timedOut) {
        let terminationDiagnostics: string;
        try {
          terminationDiagnostics = await (terminationPromise ?? Promise.resolve("not-started"));
        } catch (error) {
          terminationDiagnostics = `failed=${error instanceof Error ? error.message : String(error)}`;
        }
        finish(() => rejectCommand(new Error(
          `Deployment stub exceeded ${deadlineMs}ms; termination=${terminationDiagnostics}; `
          + diagnostics(status, signal),
        )));
      } else if (postSpawnError !== null) {
        const processError = postSpawnError;
        finish(() => rejectCommand(new Error(
          `Deployment stub process error after start: ${processError.message}; `
          + diagnostics(status, signal),
        )));
      } else if (signal !== null) {
        finish(() => rejectCommand(new Error(
          `Deployment stub exited with unexpected signal ${signal}; ${diagnostics(status, signal)}`,
        )));
      } else if (status === null) {
        finish(() => rejectCommand(new Error(
          `Deployment stub closed without a numeric exit status; ${diagnostics(status, signal)}`,
        )));
      } else {
        finish(() => resolveCommand({ status, signal, stdout, stderr }));
      }
    });
  });
}

async function terminateWindowsProcessTree(pid: number): Promise<string> {
  const taskkill = resolve(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
  const args = ["/PID", String(pid), "/T", "/F"];
  return await new Promise<string>((resolveTermination, rejectTermination) => {
    const child = spawn(taskkill, args, {
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let postSpawnError: Error | null = null;
    let settled = false;

    child.stdout?.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    const diagnostics = (status: number | null, signal: NodeJS.Signals | null) =>
      `command=${taskkill} ${args.join(" ")} status=${status} signal=${signal ?? "none"} `
      + `stdout=${stdout} stderr=${stderr}`;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      callback();
    };

    child.once("error", (error) => {
      if (child.pid === undefined) {
        finish(() => rejectTermination(new Error(
          `Process-tree termination failed to start: ${error.message}; `
          + diagnostics(child.exitCode, child.signalCode),
        )));
      } else {
        postSpawnError ??= error;
      }
    });
    child.once("close", (status, signal) => {
      if (postSpawnError !== null) {
        const terminationError = postSpawnError;
        finish(() => rejectTermination(new Error(
          `Process-tree termination error after start: ${terminationError.message}; `
          + diagnostics(status, signal),
        )));
      } else if (signal !== null || status !== 0) {
        finish(() => rejectTermination(new Error(
          `Process-tree termination failed; ${diagnostics(status, signal)}`,
        )));
      } else {
        finish(() => resolveTermination(diagnostics(status, signal)));
      }
    });
  });
}

async function runDeployStub(options: {
  currentImageId?: string | null;
  failFirstHealth: boolean;
  oldTag?: string;
  remoteLatestImageId?: string;
}): Promise<DeployStubResult> {
  const root = mkdtempSync(join(tmpdir(), "knowledge-deploy-contract-"));
  const bin = join(root, "bin");
  const envFile = join(root, ".env");
  const logFile = join(root, "docker.log");
  const healthState = join(root, "health-state");
  const dockerStub = join(bin, "docker");
  try {
    mkdirSync(bin);
    writeFileSync(
      envFile,
      `GHCR_OWNER=example\nMCP_IMAGE_TAG=${options.oldTag ?? "old-stable"}\n`,
      "utf8",
    );
    writeFileSync(logFile, "", "utf8");
    writeFileSync(
      dockerStub,
      `#!/usr/bin/bash
printf '%s\\n' "$*" >> "$DOCKER_LOG"
if [[ "$1" == "inspect" ]]; then
  if [[ "$3" == "{{.Image}}" ]]; then
    if [[ -z "\${CURRENT_IMAGE_ID:-}" ]]; then
      exit 1
    fi
    printf '%s\\n' "$CURRENT_IMAGE_ID"
    exit 0
  fi
  printf 'healthy\\n'
  exit 0
fi
if [[ "$1" == "compose" ]]; then
  compose_tag="$(grep -m1 -E '^MCP_IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2-)"
  printf 'compose-tag=%s remote-latest=%s\\n' "$compose_tag" "\${REMOTE_LATEST_IMAGE_ID:-}" >> "$DOCKER_LOG"
fi
if [[ "$1" == "exec" && "\${FAIL_FIRST_HEALTH:-0}" == "1" && ! -f "$HEALTH_STATE" ]]; then
  : > "$HEALTH_STATE"
  exit 1
fi
exit 0
`,
      "utf8",
    );
    chmodSync(dockerStub, 0o755);
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
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function extractBetween(contents: string, startMarker: string, endMarker: string): string {
  const normalizedContents = contents.replace(/\r\n/g, "\n");
  const start = normalizedContents.indexOf(startMarker);
  expect(start, `missing embedded Node start marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const bodyStart = start + startMarker.length;
  const end = normalizedContents.indexOf(endMarker, bodyStart);
  expect(end, `missing embedded Node end marker: ${endMarker}`).toBeGreaterThan(bodyStart);
  return normalizedContents.slice(bodyStart, end);
}

async function runEmbeddedHealth(code: string, marker: string): Promise<{
  status: number | null;
  stderr: string;
}> {
  const healthUrl = `data:application/json,${encodeURIComponent(`${marker}{`)}`;
  const executableCode = code.replace("http://127.0.0.1:3000/health", healthUrl);
  expect(executableCode).not.toBe(code);
  const result = await runDeploymentCommand(
    process.execPath,
    ["-e", executableCode, "42"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AUTH_TOKEN: "test-health-token",
        EXPECTED_TEMPLATES: "42",
      },
    },
  );
  return { status: result.status, stderr: result.stderr };
}
