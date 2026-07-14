import { describe, expect, it } from "vitest";
import { validateExternalNodeCandidate } from "./external-node-validation";

const baseCandidate = {
  source: "czlonkowski/n8n-mcp",
  package_name: "n8n-nodes-example",
  node_type: "n8n-nodes-example.example",
  normalized_node_type: "example",
  display_name: "Example",
  version: "1",
  candidate_kind: "community",
  properties_json: "[]",
  credentials_json: "[]",
  operations_json: "[]",
  source_metadata_json: "{}",
  npm_package_name: "n8n-nodes-example",
  npm_version: "1.2.3",
  normalized_tool_variant_of: null,
};

describe("external node candidate validation", () => {
  it("accepts a community candidate with complete package metadata and empty optional schema arrays", () => {
    const result = validateExternalNodeCandidate(baseCandidate, new Set());

    expect(result.passed).toBe(true);
    expect(result.errors).toEqual([]);
    expect(result.warnings).toContain("properties_json is empty");
  });

  it("rejects a tool variant that does not map to an official node", () => {
    const result = validateExternalNodeCandidate(
      {
        ...baseCandidate,
        package_name: "n8n-nodes-base",
        node_type: "nodes-base.unknownTool",
        candidate_kind: "tool_variant",
        npm_package_name: null,
        npm_version: null,
        normalized_tool_variant_of: "unknown",
      },
      new Set(["knownNode"]),
    );

    expect(result.passed).toBe(false);
    expect(result.errors).toContain("tool_variant base node is not present in official nodes");
  });

  it("rejects malformed property definitions", () => {
    const result = validateExternalNodeCandidate(
      {
        ...baseCandidate,
        properties_json: JSON.stringify([{ name: "operation" }]),
      },
      new Set(),
    );

    expect(result.passed).toBe(false);
    expect(result.errors).toContain("properties_json[0].type must be a non-empty string");
  });
});
