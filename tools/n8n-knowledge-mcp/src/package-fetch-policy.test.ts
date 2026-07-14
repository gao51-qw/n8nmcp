import { describe, expect, it } from "vitest";
import { shouldSkipCommunityPackages } from "./package-fetch-policy.js";

describe("package fetch policy", () => {
  it("skips community packages for the official-only CLI selector", () => {
    expect(shouldSkipCommunityPackages(["node", "script", "--official-only"], undefined)).toBe(true);
  });

  it("keeps the environment compatibility selector", () => {
    expect(shouldSkipCommunityPackages(["node", "script"], "1")).toBe(true);
  });

  it("keeps community enrichment enabled for the generic build", () => {
    expect(shouldSkipCommunityPackages(["node", "script"], undefined)).toBe(false);
    expect(shouldSkipCommunityPackages(["node", "script"], "0")).toBe(false);
  });
});
