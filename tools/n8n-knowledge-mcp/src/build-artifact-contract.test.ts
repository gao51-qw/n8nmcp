import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("verified knowledge image contract", () => {
  const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));

  it("copies a prebuilt database and never rebuilds it in Docker", () => {
    expect(dockerfile).toContain("COPY data/nodes.db ./data/nodes.db");
    expect(dockerfile).toContain(
      "COPY data/knowledge-quality-report.json ./data/knowledge-quality-report.json",
    );
    expect(dockerfile).not.toContain("RUN npm run build:db");
    expect(dockerfile).toContain('CMD ["node", "dist/src/server.js"]');
    expect(pkg.scripts.start).toBe("node dist/src/server.js");
    expect(pkg.scripts["build:knowledge"]).toContain("fetch:templates");
    expect(pkg.scripts["build:knowledge"]).toContain("verify:knowledge");
  });
});
