import { describe, expect, it } from "vitest";
import { sharedCookieDomain } from "../cookie-domain";

const PRODUCTION_HOSTS = [
  "mcp.n8nworkflow.com",
  "docs.n8nworkflow.com",
  "blog.n8nworkflow.com",
  "dashboard.n8nworkflow.com",
];

describe("sharedCookieDomain", () => {
  it("uses the parent domain shared by every surface", () => {
    expect(sharedCookieDomain(PRODUCTION_HOSTS, "dashboard.n8nworkflow.com")).toBe(
      ".n8nworkflow.com",
    );
    expect(sharedCookieDomain(PRODUCTION_HOSTS, "docs.n8nworkflow.com")).toBe(".n8nworkflow.com");
    expect(
      sharedCookieDomain(["app.eu.example.com", "docs.eu.example.com"], "app.eu.example.com"),
    ).toBe(".eu.example.com");
    expect(sharedCookieDomain(["example.com", "dashboard.example.com"], "example.com")).toBe(
      ".example.com",
    );
  });

  it("falls back to a host-only cookie for local and single-origin setups", () => {
    expect(sharedCookieDomain(["localhost", "localhost"], "localhost")).toBeUndefined();
    expect(sharedCookieDomain(PRODUCTION_HOSTS, "localhost")).toBeUndefined();
    expect(sharedCookieDomain(PRODUCTION_HOSTS, "127.0.0.1")).toBeUndefined();
    expect(
      sharedCookieDomain(["app.test.localhost", "docs.test.localhost"], "app.test.localhost"),
    ).toBeUndefined();
    expect(sharedCookieDomain(["mcp.example.com"], "mcp.example.com")).toBeUndefined();
  });

  it("refuses a suffix that is too broad or does not contain the page", () => {
    // Only the TLD is shared: Domain=.com would be rejected by the browser.
    expect(sharedCookieDomain(["a.example.com", "b.other.com"], "a.example.com")).toBeUndefined();
    // A preview host outside the configured domain keeps a host-only cookie.
    expect(sharedCookieDomain(PRODUCTION_HOSTS, "preview.vercel-like.app")).toBeUndefined();
    expect(sharedCookieDomain(PRODUCTION_HOSTS, "eviln8nworkflow.com")).toBeUndefined();
  });
});
