import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const composeFiles = [
  "deploy/docker-compose.yml",
  "deploy/docker-compose.local.yml",
  "deploy/docker-compose.aapanel.yml",
] as const;

function serviceBlock(source: string, service: string): string {
  const match = source.match(
    new RegExp(
      `(?:^|\\n)  ${service}:\\r?\\n([\\s\\S]*?)(?=\\r?\\n  [a-z][a-z0-9_-]*:\\r?(?:\\n|$)|\\r?\\n(?:volumes|networks):|\\s*$)`,
    ),
  );
  if (!match) throw new Error(`Missing ${service} service`);
  return match[1];
}

describe("workflow-agent Docker contract", () => {
  it.each(composeFiles)("wires the app to the healthy internal MCP in %s", (relativePath) => {
    const source = readFileSync(resolve(root, relativePath), "utf8");
    const app = serviceBlock(source, "app");
    const mcp = serviceBlock(source, "mcp");

    expect(app).toMatch(/depends_on:\s+mcp:\s+condition: service_healthy/);
    expect(app).toContain("UPSTREAM_N8N_MCP_URL: http://mcp:3000/mcp");
    expect(app).toMatch(/UPSTREAM_N8N_MCP_TOKEN: \$\{MCP_AUTH_TOKEN(?::\?required)?\}/);
    expect(mcp).toMatch(/AUTH_TOKEN: \$\{MCP_AUTH_TOKEN(?::\?required)?\}/);
    expect(mcp).not.toMatch(/^ {4}ports:/m);
  });

  it("documents the fixed server-only Knowledge MCP configuration", () => {
    const example = readFileSync(resolve(root, "deploy/.env.app.example"), "utf8");
    expect(example).toContain("UPSTREAM_N8N_MCP_URL=http://mcp:3000/mcp");
    expect(example).toContain("UPSTREAM_N8N_MCP_TOKEN=same-as-MCP_AUTH_TOKEN-in-.env");
  });
});
