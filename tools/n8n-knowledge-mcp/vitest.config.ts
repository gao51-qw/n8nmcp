import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    globalSetup: ["./vitest.global-setup.ts"],
    include: ["src/**/*.{test,spec}.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
