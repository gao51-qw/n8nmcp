import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

function read(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

describe("architecture guardrails", () => {
  it("keeps local environment files out of git and Docker build contexts", () => {
    const gitignore = read(".gitignore");
    const dockerignore = read(".dockerignore");

    expect(gitignore).toMatch(/^\.env$/m);
    expect(gitignore).toMatch(/^\.env\.\*$/m);
    expect(gitignore).toMatch(/^!\.env\.example$/m);

    expect(dockerignore).toMatch(/^\.env$/m);
    expect(dockerignore).toMatch(/^\.env\.\*$/m);
    expect(dockerignore).toMatch(/^!\.env\.example$/m);
  });

  it("removes the retired TanStack route tree and its config exclusions", () => {
    const tsconfig = read("tsconfig.json");
    const vitest = read("vitest.config.ts");
    const eslint = read("eslint.config.js");

    expect(existsSync(resolve(root, "src/legacy-routes"))).toBe(false);
    expect(tsconfig).not.toContain('"src/legacy-routes"');
    expect(vitest).not.toContain("src/legacy-routes/**");
    expect(eslint).not.toContain("src/legacy-routes/**");
  });

  it("does not probe Node's built-in localStorage getter during test setup", () => {
    const setup = read("vitest.setup.ts");

    expect(setup).toContain("Object.getOwnPropertyDescriptor");
    expect(setup).not.toContain("globalThis.localStorage?.");
  });

  it("uses a database-backed MCP short-window limiter that fails closed by default", () => {
    const source = read("src/lib/mcp.server.ts");
    const route = read("src/lib/mcp-route.server.ts");

    expect(source).toContain("checkShortWindowQuota");
    expect(source).toContain("check_mcp_short_window");
    expect(source).toContain('MCP_SHORT_WINDOW_LIMITER === "memory"');
    expect(source).toContain("database limiter failed; failing closed");
    expect(route).toContain("checkShortWindowQuota");
    expect(route).not.toContain("shortWindowAllow");
  });

  it("separates public outbound protection from the fixed internal MCP transport", () => {
    expect(read("src/lib/ssrf-guard.server.ts")).toContain("safeFetchPublicUrl");
    expect(read("src/lib/ssrf-guard.server.ts")).toContain('redirect: "manual"');
    expect(read("src/lib/mcp.server.ts")).toContain("safeFetchPublicUrl");
    expect(read("src/lib/mcp-upstream.server.ts")).toContain("createKnowledgeMcpTransport");
    expect(read("src/lib/workflow-agent/knowledge-client.server.ts")).toContain(
      'redirect: "manual"',
    );
  });

  it("declares VPS Docker/Caddy as the production deployment target", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts?: Record<string, string> };
    const deployReadme = read("deploy/README.md");
    const deployRunbook = read("deploy/DEPLOY.md");
    const dockerfile = read("Dockerfile");

    expect(pkg.scripts?.build).toBe("next build");
    expect(pkg.scripts?.["build:vps"]).toBeUndefined();
    expect(deployReadme).toContain("VPS Docker is the production deployment target");
    expect(deployRunbook).toContain("Production authority: VPS Docker Compose with Caddy");
    expect(dockerfile).toContain("RUN npm run build");
    // Tolerate the `--chown=node:node` flag that drops the runtime to a non-root user.
    expect(dockerfile).toMatch(/COPY --from=build\b.*\/app\/\.next\/standalone \.\//);
    expect(dockerfile).toContain('CMD ["node", "server.js"]');
  });

  it("keeps the aaPanel deployment isolated behind loopback Nginx upstreams", () => {
    const compose = read("deploy/docker-compose.aapanel.yml");

    expect(compose).toContain("name: n8nmcp-app");
    expect(compose).toContain("127.0.0.1:3001:3001");
    expect(compose).not.toContain("caddy");
    expect(compose).not.toContain("n8nworkflow-");
    expect(compose).toContain("n8nmcp-app");
    expect(compose).toContain("n8nmcp-knowledge-mcp");
    expect(compose).not.toContain("security_opt:");
    expect(compose).not.toContain("cap_drop:");
    expect(compose).toMatch(/test:\s*\[\s*"CMD",\s*"node",\s*"-e"/);
  });

  it("terminates HTTPS for every public frontend aaPanel vhost", () => {
    for (const domain of ["mcp", "docs", "blog", "dashboard"]) {
      const vhost = read(`deploy/nginx/aapanel/${domain}.n8nworkflow.com.conf`);
      expect(vhost).toContain("listen 443 ssl http2;");
      expect(vhost).toContain("/etc/letsencrypt/live/n8nmcp-frontends/fullchain.pem");
      expect(vhost).toContain("return 301 https://$host$request_uri;");
    }
  });

  it("terminates API HTTPS while keeping Supabase management paths private", () => {
    const vhost = read("deploy/nginx/aapanel/api.n8nworkflow.com.conf");
    expect(vhost).toContain("listen 443 ssl http2;");
    expect(vhost).toContain("/etc/letsencrypt/live/n8nmcp-api/fullchain.pem");
    expect(vhost).toContain("(auth|rest|storage|realtime|functions)/v1");
    expect(vhost).toContain("location / { return 404; }");
    expect(vhost).toContain("return 301 https://$host$request_uri;");
  });

  it("installs isolated support maintenance jobs for aaPanel", () => {
    const installerPath = resolve(root, "deploy/install-support-cron-aapanel.sh");
    expect(existsSync(installerPath)).toBe(true);
    const installer = read("deploy/install-support-cron-aapanel.sh");
    expect(installer).toContain("BEGIN n8nmcp support jobs");
    expect(installer).toContain("/api/internal/support/process-outbox");
    expect(installer).toContain("/api/internal/support/run-maintenance");
  });

  it("reloads the self-hosted PostgREST schema after raw psql migrations", () => {
    const migrator = read("deploy/supabase/apply-migrations-aapanel.sh");
    expect(migrator).toContain("notify pgrst, 'reload schema'");
  });
});
