import { defineConfig, devices } from "@playwright/test";

/**
 * E2E config for accessibility/interaction smoke tests. Specs live in
 * `tests/e2e/` and run against an inlined HTML page (no dev server needed),
 * so we can validate browser-level behaviour like `:focus-visible`'s
 * keyboard-vs-mouse heuristic without booting the full app.
 */
export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: true,
  reporter: "list",
  use: {
    ...devices["Desktop Chrome"],
    headless: true,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});