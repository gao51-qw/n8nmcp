import { describe, expect, it } from "vitest";
import {
  assertCommunityQuality,
  communityPackageRows,
  parsedNodeRows,
  verifiedNodeRows,
} from "./community-db.js";
import type { CommunityCandidate, VerifiedCommunityNode } from "./community-sources.js";
import type { ParsedNode } from "./node-package-parser.js";

const verified: VerifiedCommunityNode = {
  nodeType: "n8n-nodes-ticktick.tickTick",
  packageName: "n8n-nodes-ticktick",
  npmVersion: "2.2.2",
  checksum: "sha512-abc==",
  displayName: "TickTick",
  description: "Manage TickTick tasks",
  isOfficialNode: false,
  downloads: 275,
  updatedAt: "2026-10-01T00:00:00Z",
  nodeDescription: {
    name: "n8n-nodes-preview-ticktick.tickTick",
    displayName: "TickTick (preview)",
    group: ["transform"],
    version: [1, 2],
    usableAsTool: true,
    properties: [{ name: "resource", type: "options", required: true }],
  },
};

const candidate = (name: string): CommunityCandidate => ({
  name,
  version: "1.0.0",
  publishedAt: "2026-06-01T00:00:00Z",
  weeklyDownloads: 120,
  description: null,
  reason: "popular",
});

const parsedNode = (packageName: string, nodeType: string): ParsedNode => ({
  node_type: nodeType,
  package_name: packageName,
  display_name: nodeType,
  description: null,
  category: null,
  version: "1",
  is_ai_tool: 0,
  is_trigger: 0,
  is_webhook: 0,
  properties_json: "[]",
  credentials_json: "[]",
  source_path: "dist/x.node.js",
  source_excerpt: "",
});

describe("verifiedNodeRows", () => {
  it("builds rows from n8n's reviewed description under the workflow node type", () => {
    const [row] = verifiedNodeRows([verified]);
    expect(row).toMatchObject({
      node_type: "n8n-nodes-ticktick.tickTick",
      package_name: "n8n-nodes-ticktick",
      display_name: "TickTick",
      description: "Manage TickTick tasks",
      category: "transform",
      version: "2",
      is_ai_tool: 1,
      source: "community",
      trust_level: "verified",
      package_version: "2.2.2",
      package_integrity: "sha512-abc==",
    });
    expect(JSON.parse(row!.properties_json)).toEqual([
      { name: "resource", type: "options", required: true },
    ]);
  });
});

describe("parsedNodeRows", () => {
  it("marks statically parsed nodes and drops packages that were not fetched", () => {
    const rows = parsedNodeRows(
      [parsedNode("n8n-nodes-a", "n8n-nodes-a.a"), parsedNode("n8n-nodes-b", "n8n-nodes-b.b")],
      new Map([["n8n-nodes-a", { version: "1.0.0", integrity: "sha512-a==" }]]),
    );
    expect(rows).toEqual([
      expect.objectContaining({
        node_type: "n8n-nodes-a.a",
        trust_level: "parsed",
        package_version: "1.0.0",
        package_integrity: "sha512-a==",
      }),
    ]);
  });
});

describe("communityPackageRows", () => {
  it("records verified, parsed and listed packages once each", () => {
    const rows = communityPackageRows(
      [verified, { ...verified, nodeType: "n8n-nodes-ticktick.list" }],
      [candidate("n8n-nodes-parsed"), candidate("n8n-nodes-listed"), candidate("n8n-nodes-ticktick")],
      new Map([["n8n-nodes-parsed", 3]]),
      new Map([["n8n-nodes-parsed", "sha512-p=="]]),
    );
    expect(rows).toEqual([
      expect.objectContaining({ package_name: "n8n-nodes-listed", trust_level: "listed", node_count: 0 }),
      expect.objectContaining({
        package_name: "n8n-nodes-parsed",
        trust_level: "parsed",
        node_count: 3,
        integrity: "sha512-p==",
      }),
      expect.objectContaining({ package_name: "n8n-nodes-ticktick", trust_level: "verified", node_count: 2 }),
    ]);
  });
});

describe("assertCommunityQuality", () => {
  it("passes above both floors and names every shortfall otherwise", () => {
    expect(() =>
      assertCommunityQuality({ communityNodes: 2000, verifiedNodes: 400 }, { minCommunityNodes: 1500, minVerifiedNodes: 300 }),
    ).not.toThrow();
    expect(() =>
      assertCommunityQuality({ communityNodes: 10, verifiedNodes: 5 }, { minCommunityNodes: 1500, minVerifiedNodes: 300 }),
    ).toThrow(/community nodes 10 < 1500; verified nodes 5 < 300/);
  });
});
