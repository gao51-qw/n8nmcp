import { describe, expect, it } from "vitest";
import {
  assertOfficialPackageCoverage,
  shouldSkipCommunityPackages,
} from "./package-fetch-policy.js";

describe("package fetch policy", () => {
  it("skips community packages for the official-only CLI selector", () => {
    expect(shouldSkipCommunityPackages(["node", "script", "--official-only"], undefined)).toBe(true);
  });

  it("keeps the environment compatibility selector", () => {
    expect(shouldSkipCommunityPackages(["node", "script"], "1")).toBe(true);
  });

  it("keeps community enrichment enabled for the generic build", () => {
    expect(shouldSkipCommunityPackages(["node", "script"], "")).toBe(false);
  });

  it("rejects a fetched index missing a configured official package", () => {
    expect(() =>
      assertOfficialPackageCoverage(
        ["n8n-nodes-base", "@n8n/n8n-nodes-langchain"],
        [{ name: "n8n-nodes-base", source: "official" }],
      ),
    ).toThrow("Missing official packages after fetch: @n8n/n8n-nodes-langchain");
  });

  it("ignores optional community packages when checking official coverage", () => {
    expect(() =>
      assertOfficialPackageCoverage(
        ["n8n-nodes-base"],
        [
          { name: "n8n-nodes-base", source: "official" },
          { name: "n8n-nodes-example", source: "community" },
        ],
      ),
    ).not.toThrow();
  });

  it("counts official GitHub checkouts as configured official coverage", () => {
    expect(() =>
      assertOfficialPackageCoverage(
        ["n8n-nodes-base", "@n8n/n8n-nodes-langchain"],
        [
          { name: "n8n-nodes-base", source: "official-github" },
          { name: "@n8n/n8n-nodes-langchain", source: "official-github" },
        ],
      ),
    ).not.toThrow();
  });
});
