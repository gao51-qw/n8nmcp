import { describe, expect, it } from "vitest";
import { createExpiringStore, pruneExpired } from "../expiring-store";

describe("createExpiringStore", () => {
  it("returns values until they expire", () => {
    const store = createExpiringStore<string>({ maxEntries: 10 });
    store.set("a", "one", 1_000, 0);
    expect(store.get("a", 999)).toBe("one");
    expect(store.get("a", 1_000)).toBeUndefined();
    expect(store.size).toBe(0);
  });

  it("take returns the value once", () => {
    const store = createExpiringStore<string>({ maxEntries: 10 });
    store.set("a", "one", 1_000, 0);
    expect(store.take("a", 1)).toBe("one");
    expect(store.take("a", 2)).toBeUndefined();
  });

  it("sweeps abandoned expired keys on later writes", () => {
    const store = createExpiringStore<number>({ maxEntries: 100, sweepIntervalMs: 10 });
    for (let i = 0; i < 20; i++) store.set(`k${i}`, i, 5, 0);
    expect(store.size).toBe(20);
    store.set("fresh", 1, 1_000, 50);
    expect(store.size).toBe(1);
  });

  it("evicts the oldest entry when full", () => {
    const store = createExpiringStore<number>({ maxEntries: 2 });
    store.set("a", 1, 1_000, 0);
    store.set("b", 2, 1_000, 0);
    store.set("c", 3, 1_000, 0);
    expect(store.get("a", 1)).toBeUndefined();
    expect(store.get("b", 1)).toBe(2);
    expect(store.get("c", 1)).toBe(3);
  });
});

describe("pruneExpired", () => {
  it("drops entries at or past their expiry", () => {
    const map = new Map([
      ["old", { resetAt: 5 }],
      ["new", { resetAt: 50 }],
    ]);
    pruneExpired(map, (v) => v.resetAt, 5);
    expect([...map.keys()]).toEqual(["new"]);
  });
});
