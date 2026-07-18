import { vi } from "vitest";

function createMemoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      return entries.has(key) ? entries.get(key)! : null;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(key);
    },
    setItem(key: string, value: string) {
      entries.set(key, String(value));
    },
  };
}

const localStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

if (!("value" in (localStorageDescriptor ?? {}))) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    writable: true,
    value: createMemoryStorage(),
  });
}

/**
 * `next/font/google` loaders are build-time only — they are not callable in
 * the vitest/jsdom runtime. Any test that transitively imports a module which
 * calls them (e.g. `app/layout.tsx`) would otherwise throw
 * "<Font> is not a function". Return stubs matching the loader's shape so the
 * font CSS-variable wiring resolves to inert class/variable names under test.
 *
 * Explicit named exports (rather than a Proxy) keep the mocked module from
 * looking thenable to the ESM loader, which would break the import.
 */
vi.mock("next/font/google", () => {
  const loader = () => ({
    className: "font-stub",
    variable: "font-stub-variable",
    style: { fontFamily: "stub" },
  });
  return {
    Bricolage_Grotesque: loader,
    Hanken_Grotesk: loader,
    JetBrains_Mono: loader,
  };
});
