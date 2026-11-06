import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const caddyfile = readFileSync(
  fileURLToPath(new URL("../../../deploy/Caddyfile", import.meta.url)),
  "utf8",
);

/** Caddy substitutes {$VAR:default} at load time; use the defaults. */
function withEnvDefaults(value: string): string {
  return value.replace(
    /\{\$[A-Z_]+(?::([^}]*))?\}/g,
    (_, fallback: string | undefined) => fallback ?? "",
  );
}

function policy(header: string): Map<string, string[]> {
  const match = caddyfile.match(new RegExp(`^\\s*${header} "([^"]+)"`, "m"));
  expect(match, `${header} header`).not.toBeNull();
  const directives = new Map<string, string[]>();
  for (const part of withEnvDefaults(match![1]).split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name, sources);
  }
  return directives;
}

describe("Caddy Content-Security-Policy", () => {
  it("enforces the baseline directives that cannot break the app", () => {
    const enforced = policy("Content-Security-Policy");
    expect(enforced.get("object-src")).toEqual(["'none'"]);
    expect(enforced.get("base-uri")).toEqual(["'self'"]);
    expect(enforced.get("form-action")).toEqual(["'self'"]);
    expect(enforced.get("frame-ancestors")).toEqual(["'none'"]);
  });

  it("reports the full policy for the app's real origins", () => {
    const full = policy("Content-Security-Policy-Report-Only");
    expect(full.get("default-src")).toEqual(["'self'"]);
    expect(full.get("frame-ancestors")).toEqual(["'none'"]);
    expect(full.get("object-src")).toEqual(["'none'"]);
    expect(full.get("script-src")).toEqual(
      expect.arrayContaining(["'self'", "'unsafe-inline'", "https://cdn.paddle.com"]),
    );
    expect(full.get("script-src")).not.toContain("'unsafe-eval'");
    // A hash or nonce would make browsers ignore 'unsafe-inline' and break
    // the Next.js inline runtime scripts.
    expect(full.get("script-src")?.some((s) => /^'(sha256|sha384|sha512|nonce)-/.test(s))).toBe(
      false,
    );
    expect(full.get("connect-src")).toEqual(
      expect.arrayContaining([
        "'self'",
        "https://*.supabase.co",
        "wss://*.supabase.co",
        "https://*.sentry.io",
        "https://*.paddle.com",
      ]),
    );
    expect(full.get("frame-src")).toContain("https://*.paddle.com");
    expect(full.get("img-src")).toEqual(
      expect.arrayContaining(["'self'", "data:", "https://*.supabase.co"]),
    );
  });
});
