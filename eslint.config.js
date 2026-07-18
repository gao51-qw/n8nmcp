import js from "@eslint/js";
import eslintPluginPrettier from "eslint-plugin-prettier/recommended";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      ".agents/**",
      ".next/**",
      ".next-dev.err.log",
      ".next-dev.log",
      ".npm-cache/**",
      ".output/**",
      ".playwright-mcp/**",
      ".remember/**",
      ".superpowers/sdd/**",
      ".tmp/**",
      ".vinxi/**",
      ".worktrees/**",
      "apps/**",
      "deploy/**",
      "dist/**",
      "migrations/**",
      "n8n-mcp-main/**",
      "next-env.d.ts",
      "packages/**",
      "scripts/**",
      "supabase/functions/**",
      "test-audit-system.js",
      "test-results/**",
      "tests/e2e/**",
      "tools/**",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": "off",
    },
  },
  eslintPluginPrettier,
);
