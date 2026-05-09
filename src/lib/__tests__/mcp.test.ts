import { describe, it, expect, beforeEach } from "vitest";
import { shortWindowAllow } from "../mcp.server";

describe("shortWindowAllow", () => {
  beforeEach(() => {
    // unique user per test
  });

  it("allows up to 60 req / 10s window", () => {
    const u = `user-${Math.random()}`;
    let allowed = 0;
    for (let i = 0; i < 65; i++) if (shortWindowAllow(u)) allowed++;
    expect(allowed).toBe(60);
  });

  it("isolates buckets per user", () => {
    const a = `a-${Math.random()}`;
    const b = `b-${Math.random()}`;
    for (let i = 0; i < 60; i++) shortWindowAllow(a);
    expect(shortWindowAllow(a)).toBe(false);
    expect(shortWindowAllow(b)).toBe(true);
  });
});
