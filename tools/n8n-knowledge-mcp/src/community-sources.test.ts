import { describe, expect, it } from "vitest";
import {
  dedupeVerifiedNodes,
  parseNpmSearchPage,
  parseVerifiedPage,
  selectCommunityCandidates,
  type NpmSearchPackage,
} from "./community-sources.js";

const sri = "sha512-eFMPCNEm+NRW4OiFnCAkJCXoJGCzSBOVX2HexNyqqugDTGucMhqOodkPk0fhvWiQqr2Tik5EbatYOBAt+47xOg==";

function verifiedEntry(overrides: Record<string, unknown> = {}) {
  return {
    name: "n8n-nodes-ticktick.tickTick",
    packageName: "n8n-nodes-ticktick",
    npmVersion: "2.2.2",
    checksum: sri,
    displayName: "TickTick",
    description: "Manage TickTick tasks",
    isOfficialNode: false,
    isPublished: true,
    numberOfDownloads: 275,
    updatedAt: "2026-10-01T00:00:00.000Z",
    nodeDescription: {
      name: "n8n-nodes-preview-ticktick.tickTick",
      displayName: "TickTick",
      properties: [{ name: "resource", type: "options" }],
    },
    ...overrides,
  };
}

describe("parseVerifiedPage", () => {
  it("reads entries and the page count", () => {
    const page = parseVerifiedPage({
      data: [verifiedEntry(), { attributes: verifiedEntry({ name: "n8n-nodes-ticktick.list" }) }],
      meta: { pagination: { page: 1, pageCount: 23, total: 2203 } },
    });
    expect(page.pageCount).toBe(23);
    expect(page.nodes.map((node) => node.nodeType)).toEqual([
      "n8n-nodes-ticktick.tickTick",
      "n8n-nodes-ticktick.list",
    ]);
    expect(page.nodes[0]).toMatchObject({
      packageName: "n8n-nodes-ticktick",
      npmVersion: "2.2.2",
      checksum: sri,
      displayName: "TickTick",
      downloads: 275,
    });
  });

  it("uses the workflow node type, not the preview name inside nodeDescription", () => {
    const page = parseVerifiedPage({ data: [verifiedEntry({ name: undefined })], meta: {} });
    expect(page.nodes[0]?.nodeType).toBe("n8n-nodes-ticktick.tickTick");
  });

  it.each([
    ["unpublished", { isPublished: false }],
    ["an invalid package name", { packageName: "left-pad" }],
    ["a missing version", { npmVersion: "" }],
    ["a non-SRI checksum", { checksum: "deadbeef" }],
    ["no node description", { nodeDescription: null }],
  ])("drops entries that are %s", (_label, overrides) => {
    expect(parseVerifiedPage({ data: [verifiedEntry(overrides)], meta: {} }).nodes).toEqual([]);
  });

  it("rejects an unexpected response shape", () => {
    expect(() => parseVerifiedPage({ error: "rate limited" })).toThrow(/unexpected response/);
  });
});

describe("parseNpmSearchPage", () => {
  it("reads packages with weekly downloads", () => {
    expect(
      parseNpmSearchPage({
        total: 14193,
        objects: [
          {
            package: { name: "n8n-nodes-a", version: "1.0.0", date: "2026-10-01T00:00:00Z" },
            downloads: { weekly: 120, monthly: 500 },
          },
          { package: { name: "n8n-nodes-b" } },
        ],
      }),
    ).toEqual({
      total: 14193,
      packages: [
        {
          name: "n8n-nodes-a",
          version: "1.0.0",
          publishedAt: "2026-10-01T00:00:00Z",
          weeklyDownloads: 120,
          description: null,
        },
      ],
    });
  });
});

describe("selectCommunityCandidates", () => {
  const now = new Date("2026-11-04T00:00:00Z");
  const policy = { now, maxAgeMonths: 24, minWeeklyDownloads: 50, maxPackages: 2, blacklist: ["n8n-nodes-starter"] };
  const pkg = (name: string, weeklyDownloads: number, publishedAt = "2026-06-01T00:00:00Z"): NpmSearchPackage => ({
    name,
    version: "1.0.0",
    publishedAt,
    weeklyDownloads,
    description: null,
  });

  it("keeps recent, popular, unreviewed packages, most downloaded first", () => {
    const selected = selectCommunityCandidates(
      [
        pkg("n8n-nodes-small", 10),
        pkg("n8n-nodes-old", 900, "2023-01-01T00:00:00Z"),
        pkg("n8n-nodes-starter", 900),
        pkg("left-pad", 900),
        pkg("n8n-nodes-reviewed", 900),
        pkg("n8n-nodes-mid", 60),
        pkg("@acme/n8n-nodes-top", 700),
        pkg("n8n-nodes-third", 55),
      ],
      new Set(["n8n-nodes-reviewed"]),
      policy,
    );
    expect(selected.map((candidate) => candidate.name)).toEqual(["@acme/n8n-nodes-top", "n8n-nodes-mid"]);
  });

  it("drops packages without a publish date", () => {
    expect(
      selectCommunityCandidates([{ ...pkg("n8n-nodes-x", 999), publishedAt: null }], new Set(), policy),
    ).toEqual([]);
  });
});

describe("dedupeVerifiedNodes", () => {
  it("keeps the most recently updated entry per node type", () => {
    const [older, newer] = [
      parseVerifiedPage({ data: [verifiedEntry({ updatedAt: "2026-01-01" })], meta: {} }).nodes[0]!,
      parseVerifiedPage({ data: [verifiedEntry({ updatedAt: "2026-09-01", npmVersion: "3.0.0" })], meta: {} }).nodes[0]!,
    ];
    expect(dedupeVerifiedNodes([older, newer])).toEqual([newer]);
  });
});
