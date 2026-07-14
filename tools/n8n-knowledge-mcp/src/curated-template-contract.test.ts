import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertTemplateContainsNoSecrets,
  PROHIBITED_TEMPLATE_NODE_TYPES,
} from "./template-ingestion/template-security.js";

const curatedDir = resolve(process.cwd(), "data/curated-templates");
const expectedIds = [1750, 2327, 5171, 584, 1954, 2397, 2089, 2732, 2462, 2859, 3986, 1747];

describe("curated template trust set", () => {
  it("matches the reviewed implementation-plan IDs exactly", () => {
    const manifest = JSON.parse(readFileSync(resolve(curatedDir, "manifest.json"), "utf8"));
    expect(manifest.templateIds).toEqual(expectedIds);
    expect(
      readdirSync(curatedDir)
        .filter((name) => /^\d+\.json$/.test(name))
        .map((name) => Number(name.slice(0, -5)))
        .sort((a, b) => a - b),
    ).toEqual([...expectedIds].sort((a, b) => a - b));
  });

  it("contains no credential-like name/value parameter in stored workflow bodies", () => {
    for (const id of expectedIds) {
      const envelope = JSON.parse(readFileSync(resolve(curatedDir, `${id}.json`), "utf8"));
      const findings = findCredentialLikePairs(envelope.workflow.workflow);
      expect(findings, `credential-like pairs in curated template ${id}`).toEqual([]);
      expect(JSON.stringify(envelope.workflow.workflow).toLowerCase()).not.toContain(
        "super-secret-key",
      );
    }
  });

  it("contains only safe nodes and complete, non-stale connection descriptors", () => {
    for (const id of expectedIds) {
      const envelope = JSON.parse(readFileSync(resolve(curatedDir, `${id}.json`), "utf8"));
      const workflow = envelope.workflow.workflow as {
        nodes: Array<{ name: string; type: string }>;
        connections: Record<string, Record<string, unknown[]>>;
      };
      expect(() => assertTemplateContainsNoSecrets(workflow)).not.toThrow();
      const nodeNames = new Set(workflow.nodes.map((node) => node.name));
      expect(workflow.nodes.some((node) => PROHIBITED_TEMPLATE_NODE_TYPES.has(node.type))).toBe(false);

      for (const [source, outputTypes] of Object.entries(workflow.connections)) {
        expect(nodeNames.has(source), `stale source ${source} in ${id}`).toBe(true);
        for (const branches of Object.values(outputTypes)) {
          expect(Array.isArray(branches), `malformed branches for ${source} in ${id}`).toBe(true);
          for (const branch of branches) {
            expect(Array.isArray(branch), `malformed branch for ${source} in ${id}`).toBe(true);
            for (const descriptor of branch as unknown[]) {
              expect(isCompleteDescriptor(descriptor), `malformed descriptor for ${source} in ${id}`).toBe(true);
              expect(nodeNames.has((descriptor as { node: string }).node), `stale target in ${id}`).toBe(true);
            }
          }
        }
      }
    }
  });
});

function findCredentialLikePairs(value: unknown, path = "workflow"): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((child, index) => findCredentialLikePairs(child, `${path}[${index}]`));
  }
  if (!value || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  const normalizedName = typeof record.name === "string"
    ? record.name.toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";
  const findings = new Set(["xapikey", "authorization", "password", "token"]).has(normalizedName)
    && Object.hasOwn(record, "value")
    ? [path]
    : [];
  return findings.concat(
    Object.entries(record).flatMap(([key, child]) => findCredentialLikePairs(child, `${path}.${key}`)),
  );
}

function isCompleteDescriptor(value: unknown): value is { node: string; type: string; index: number } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const descriptor = value as Record<string, unknown>;
  return typeof descriptor.node === "string"
    && descriptor.node.trim().length > 0
    && typeof descriptor.type === "string"
    && descriptor.type.trim().length > 0
    && typeof descriptor.index === "number"
    && Number.isInteger(descriptor.index)
    && descriptor.index >= 0;
}
