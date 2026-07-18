import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();

function read(path: string) {
  return readFileSync(join(root, path), "utf8");
}

describe("single production Agent architecture", () => {
  it("removes Lovable and obsolete source trees", () => {
    const pkg = JSON.parse(read("package.json")) as {
      dependencies?: Record<string, string>;
    };

    expect(pkg.dependencies?.["@lovable.dev/cloud-auth-js"]).toBeUndefined();

    for (const path of [
      ".lovable",
      "supabase/functions/chat-agent",
      "src/integrations/lovable",
      "src/legacy-routes",
      "apps/api/src/services/mcp.service.ts",
      "apps/api/src/services/mcp-extended.service.ts",
      "apps/api/src/services/orchestrated-tools.service.ts",
      "apps/api/src/services/template.service.ts",
      "apps/api/src/services/node-knowledge.service.ts",
    ]) {
      expect(existsSync(join(root, path)), path).toBe(false);
    }
  });

  it("keeps only the Next.js MCP routes", () => {
    expect(existsSync(join(root, "src/app/mcp/route.ts"))).toBe(true);
    expect(existsSync(join(root, "src/app/api/public/mcp/route.ts"))).toBe(true);
    expect(existsSync(join(root, "apps/api/src/routes/mcp.ts"))).toBe(false);
  });
});
