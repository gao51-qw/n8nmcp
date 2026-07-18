import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("Next.js architecture guard", () => {
  it("uses Next.js as the app framework and build target", () => {
    const pkg = JSON.parse(read("package.json")) as {
      scripts: Record<string, string>;
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };

    expect(pkg.dependencies.next).toBeDefined();
    expect(pkg.scripts.dev).toBe("next dev");
    expect(pkg.scripts.build).toBe("next build");
    expect(pkg.scripts.start).toBe("next start");
  });

  it("does not keep TanStack Start/Router or Vite app framework dependencies", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };

    expect(deps["@tanstack/react-start"]).toBeUndefined();
    expect(deps["@tanstack/react-router"]).toBeUndefined();
    expect(deps["@tanstack/router-plugin"]).toBeUndefined();
    expect(deps["@tanstack/zod-adapter"]).toBeUndefined();
    expect(deps.vite).toBeUndefined();
    expect(deps["@vitejs/plugin-react"]).toBeUndefined();
    expect(deps["@tailwindcss/vite"]).toBeUndefined();
    expect(deps["@cloudflare/vite-plugin"]).toBeUndefined();
    expect(deps["@lovable.dev/vite-tanstack-config"]).toBeUndefined();
    expect(deps["vite-tsconfig-paths"]).toBeUndefined();
  });

  it("removes obsolete TanStack/Vite entry files", () => {
    for (const path of [
      "vite.config.ts",
      "vite.config.vps.ts",
      "src/start.ts",
      "src/server.ts",
      "src/router.tsx",
      "src/routeTree.gen.ts",
      "wrangler.jsonc",
    ]) {
      expect(existsSync(join(root, path))).toBe(false);
    }
  });

  it("serves public protocols through Next.js route handlers", () => {
    expect(existsSync(join(root, "src/app/mcp/route.ts"))).toBe(true);
    expect(existsSync(join(root, "src/app/api/public/mcp/route.ts"))).toBe(true);
    expect(existsSync(join(root, "src/app/api/public/paddle-webhook/route.ts"))).toBe(true);
    expect(read("src/app/mcp/route.ts")).toContain('export const runtime = "nodejs"');
    expect(read("src/app/api/public/mcp/route.ts")).toContain('export const runtime = "nodejs"');
    expect(read("src/app/api/public/mcp/route.ts")).toContain("Compatibility endpoint");
    expect(read("src/app/api/public/mcp/route.ts")).not.toContain("checkShortWindowQuota");
    expect(read("src/app/api/public/paddle-webhook/route.ts")).toContain(
      'export const runtime = "nodejs"',
    );
  });

  it("declares support observability and notification dependencies", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies: Record<string, string>;
    };
    const env = read("deploy/.env.app.example");

    expect(pkg.dependencies["@sentry/nextjs"]).toBeDefined();
    expect(pkg.dependencies.resend).toBeDefined();
    for (const key of [
      "NEXT_PUBLIC_SENTRY_DSN",
      "SENTRY_AUTH_TOKEN",
      "SENTRY_ORG",
      "SENTRY_PROJECT",
      "RESEND_API_KEY",
      "SUPPORT_EMAIL_FROM",
      "SUPPORT_N8N_WEBHOOK_URL",
      "SUPPORT_N8N_WEBHOOK_SECRET",
      "BILLING_CRON_SECRET",
      "SUPPORT_CRON_SECRET",
    ]) {
      expect(env).toContain(key);
    }
  });
});
