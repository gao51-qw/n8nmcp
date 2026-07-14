import { spawnSync } from "node:child_process";
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
const workflow = readFileSync(workflowPath, "utf8");
const deploy = existsSync(deployPath) ? readFileSync(deployPath, "utf8") : "";

describe("knowledge publication and deployment contracts", () => {
  it("keeps weekly/manual entry points and makes the official/fallback paths fail closed", () => {
    expect(workflow).toContain('cron: "0 2 * * 1"');
    expect(workflow).toMatch(/^\s*workflow_dispatch:\s*$/m);
    expect(workflow).toContain("continue-on-error: true");
    expect(workflow).toContain("if: steps.official.outcome == 'success'");
    expect(workflow).toContain("if: steps.official.outcome != 'success'");

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

  it("defines an atomic mcp-only deployment with authenticated count verification and rollback", () => {
    expect(existsSync(deployPath)).toBe(true);
    expect(deploy).toMatch(/OLD_TAG=.*MCP_IMAGE_TAG=/s);
    expect(deploy).toContain("mktemp");
    expect(deploy).toContain("awk");
    expect(deploy).toContain(".bak");
    expect(deploy).toContain("trap rollback ERR");
    expect(deploy).toContain("n8n-knowledge-mcp");
    expect(deploy).toContain("process.env.AUTH_TOKEN");
    expect(deploy).toMatch(/body\.templates\s*!==\s*Number\(expected\)/);
    expect(deploy.match(/docker compose[^\n]+up -d --no-deps mcp/g)?.length).toBeGreaterThanOrEqual(2);
    expect(deploy).not.toMatch(/docker compose[^\n]+(?:up|restart|stop)[^\n]+\b(?:app|caddy)\b/);
  });

  it("persists the new tag and recreates only mcp after a healthy deployment", () => {
    if (!existsSync(deployPath)) return;
    const result = runDeployStub({ failFirstHealth: false });
    expect(result.status, result.stderr).toBe(0);
    expect(result.env).toContain("MCP_IMAGE_TAG=20260714-123");
    expect(result.log).toContain("pull ghcr.io/example/n8n-knowledge-mcp:20260714-123");
    expect(result.log).toContain("compose -f compose.yml up -d --no-deps mcp");
    expect(result.log).toContain("exec n8n-knowledge-mcp node");
    expect(result.log).toContain(" 42");
    expect(result.log).not.toMatch(/\b(?:app|caddy)\b/);
    expect(result.backupExists).toBe(false);
  });

  it("restores the old tag and verifies rollback health when the new count check fails", () => {
    if (!existsSync(deployPath)) return;
    const result = runDeployStub({ failFirstHealth: true });
    expect(result.status).not.toBe(0);
    expect(result.env).toContain("MCP_IMAGE_TAG=old-stable");
    expect(result.log.match(/compose -f compose\.yml up -d --no-deps mcp/g)).toHaveLength(2);
    expect(result.log.match(/exec n8n-knowledge-mcp node/g)).toHaveLength(2);
    expect(result.log).not.toMatch(/\b(?:app|caddy)\b/);
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

function runDeployStub(options: { failFirstHealth: boolean }): {
  status: number | null;
  stderr: string;
  env: string;
  log: string;
  backupExists: boolean;
} {
  const root = mkdtempSync(join(tmpdir(), "knowledge-deploy-contract-"));
  const bin = join(root, "bin");
  const envFile = join(root, ".env");
  const logFile = join(root, "docker.log");
  const healthState = join(root, "health-state");
  const dockerStub = join(bin, process.platform === "win32" ? "docker" : "docker");
  try {
    mkdirSync(bin);
    writeFileSync(envFile, "GHCR_OWNER=example\nMCP_IMAGE_TAG=old-stable\n", "utf8");
    writeFileSync(logFile, "", "utf8");
    writeFileSync(
      dockerStub,
      `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$DOCKER_LOG"
if [[ "$1" == "inspect" ]]; then
  printf 'healthy\\n'
  exit 0
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
    const result = spawnSync(bash, [deployPath, "20260714-123", "42"], {
      cwd: root,
      encoding: "utf8",
      env: {
        ...process.env,
        COMPOSE_FILE: "compose.yml",
        DOCKER_LOG: logFile,
        ENV_FILE: envFile,
        FAIL_FIRST_HEALTH: options.failFirstHealth ? "1" : "0",
        HEALTH_STATE: healthState,
        PATH: `${bin}${delimiter}${process.env.PATH ?? ""}`,
      },
    });
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
