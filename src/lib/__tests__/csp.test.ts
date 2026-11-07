import { describe, expect, it } from "vitest";
import {
  buildContentSecurityPolicy,
  contentSecurityPolicyFromEnv,
  cspHeaderName,
  cspMode,
  generateNonce,
  sentrySource,
  supabaseSources,
} from "@/lib/csp";

const NONCE = "bm9uY2Utbm9uY2Utbm9uY2U=";

function directives(policy: string): Map<string, string[]> {
  const parsed = new Map<string, string[]>();
  for (const part of policy.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) {
      expect(parsed.has(name), `duplicate ${name}`).toBe(false);
      parsed.set(name, sources);
    }
  }
  return parsed;
}

/** Next.js's own nonce extraction (next/dist/server/app-render/get-script-nonce-from-header). */
const NEXT_NONCE_SOURCE = /^'nonce-([A-Za-z0-9+/_-]+={0,2})'$/;

describe("generateNonce", () => {
  it("returns a fresh base64 value of 16 random bytes that Next.js can parse", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const nonce = generateNonce();
      expect(nonce).toMatch(/^[A-Za-z0-9+/]{22}==$/);
      expect(`'nonce-${nonce}'`).toMatch(NEXT_NONCE_SOURCE);
      seen.add(nonce);
    }
    expect(seen.size).toBe(50);
  });
});

describe("buildContentSecurityPolicy (production)", () => {
  const policy = directives(
    buildContentSecurityPolicy({
      nonce: NONCE,
      isDev: false,
      supabaseUrl: "https://abcdefgh.supabase.co",
    }),
  );

  it("allows scripts only through the nonce and strict-dynamic", () => {
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("script-src")).toEqual([
      "'self'",
      `'nonce-${NONCE}'`,
      "'strict-dynamic'",
      "https://cdn.paddle.com",
    ]);
    expect(policy.get("script-src")).not.toContain("'unsafe-inline'");
    expect(policy.get("script-src")).not.toContain("'unsafe-eval'");
  });

  it("lists the app's real origins for styles, images, fonts, connections and frames", () => {
    expect(policy.get("style-src")).toEqual([
      "'self'",
      "'unsafe-inline'",
      "https://cdn.paddle.com",
    ]);
    expect(policy.get("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https://abcdefgh.supabase.co",
      "https://*.paddle.com",
    ]);
    expect(policy.get("font-src")).toEqual(["'self'", "data:"]);
    expect(policy.get("connect-src")).toEqual([
      "'self'",
      "https://abcdefgh.supabase.co",
      "wss://abcdefgh.supabase.co",
      "https://*.sentry.io",
      "https://*.ingest.sentry.io",
      "https://*.paddle.com",
    ]);
    expect(policy.get("frame-src")).toEqual(["https://*.paddle.com"]);
    expect(policy.get("worker-src")).toEqual(["'self'", "blob:"]);
  });

  it("keeps the baseline directives and upgrades insecure requests", () => {
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'self'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(policy.get("upgrade-insecure-requests")).toEqual([]);
    expect(policy.has("report-uri")).toBe(false);
  });
});

describe("buildContentSecurityPolicy (development)", () => {
  const policy = directives(buildContentSecurityPolicy({ nonce: NONCE, isDev: true }));

  it("adds only the relaxations React refresh and HMR need", () => {
    expect(policy.get("script-src")).toContain("'unsafe-eval'");
    expect(policy.get("script-src")).not.toContain("'unsafe-inline'");
    expect(policy.get("connect-src")).toContain("ws:");
    expect(policy.has("upgrade-insecure-requests")).toBe(false);
  });

  it("falls back to any Supabase project host without a configured URL", () => {
    expect(policy.get("img-src")).toContain("https://*.supabase.co");
    expect(policy.get("connect-src")).toEqual(
      expect.arrayContaining(["https://*.supabase.co", "wss://*.supabase.co"]),
    );
  });
});

describe("environment-derived sources", () => {
  it("derives https and wss origins from the Supabase URL", () => {
    expect(supabaseSources("https://auth.example.com:8443/some/path")).toEqual({
      http: "https://auth.example.com:8443",
      ws: "wss://auth.example.com:8443",
    });
    expect(supabaseSources("http://127.0.0.1:54321")).toEqual({
      http: "http://127.0.0.1:54321",
      ws: "ws://127.0.0.1:54321",
    });
  });

  it("falls back to *.supabase.co for missing, malformed or plain-http remote URLs", () => {
    const fallback = { http: "https://*.supabase.co", ws: "wss://*.supabase.co" };
    expect(supabaseSources(undefined)).toEqual(fallback);
    expect(supabaseSources("not a url")).toEqual(fallback);
    expect(supabaseSources("http://project.supabase.co")).toEqual(fallback);
    expect(supabaseSources("javascript:alert(1)")).toEqual(fallback);
  });

  it("reads the Sentry ingest host from the DSN", () => {
    expect(sentrySource("https://publickey@o42.ingest.us.sentry.io/1234")).toBe(
      "https://o42.ingest.us.sentry.io",
    );
    expect(sentrySource("https://key@sentry.example.com/7")).toBe("https://sentry.example.com");
    expect(sentrySource("")).toBeNull();
    expect(sentrySource("http://key@sentry.example.com/7")).toBeNull();

    const policy = directives(
      buildContentSecurityPolicy({
        nonce: NONCE,
        isDev: false,
        sentryDsn: "https://key@sentry.example.com/7",
      }),
    );
    expect(policy.get("connect-src")).toContain("https://sentry.example.com");
  });

  it("adds report-uri only for a well-formed http(s) URL", () => {
    const withReport = (reportUri: string) =>
      directives(buildContentSecurityPolicy({ nonce: NONCE, isDev: false, reportUri }));

    expect(
      withReport("https://o1.ingest.sentry.io/api/2/security/?sentry_key=abc").get("report-uri"),
    ).toEqual(["https://o1.ingest.sentry.io/api/2/security/?sentry_key=abc"]);
    expect(withReport("https://evil.example/x; script-src *").has("report-uri")).toBe(false);
    expect(withReport("javascript:alert(1)").has("report-uri")).toBe(false);
    expect(withReport("").has("report-uri")).toBe(false);
  });

  it("rejects a nonce that could inject sources", () => {
    expect(() => buildContentSecurityPolicy({ nonce: "abc' *", isDev: false })).toThrow();
    expect(() => buildContentSecurityPolicy({ nonce: "", isDev: false })).toThrow();
  });
});

describe("CSP mode", () => {
  it("enforces unless report mode is asked for explicitly", () => {
    expect(cspMode(undefined)).toBe("enforce");
    expect(cspMode("")).toBe("enforce");
    expect(cspMode("enforce")).toBe("enforce");
    expect(cspMode("off")).toBe("enforce");
    expect(cspMode(" Report ")).toBe("report");
    expect(cspHeaderName("enforce")).toBe("Content-Security-Policy");
    expect(cspHeaderName("report")).toBe("Content-Security-Policy-Report-Only");
  });

  it("sends the same policy under the report-only header in report mode", () => {
    const enforced = contentSecurityPolicyFromEnv({ NODE_ENV: "production" }, NONCE);
    const reported = contentSecurityPolicyFromEnv(
      { NODE_ENV: "production", CSP_MODE: "report" },
      NONCE,
    );
    expect(enforced.name).toBe("Content-Security-Policy");
    expect(reported.name).toBe("Content-Security-Policy-Report-Only");
    expect(reported.value).toBe(enforced.value);
    expect(reported.nonce).toBe(NONCE);
  });

  it("builds the policy from environment variables", () => {
    const { value } = contentSecurityPolicyFromEnv(
      {
        NODE_ENV: "development",
        SUPABASE_URL: "https://server-only.supabase.co",
        NEXT_PUBLIC_SENTRY_DSN: "https://k@o9.ingest.sentry.io/1",
        CSP_REPORT_URI: "https://csp.example.com/report",
      },
      NONCE,
    );
    const policy = directives(value);
    expect(policy.get("script-src")).toContain("'unsafe-eval'");
    expect(policy.get("connect-src")).toEqual(
      expect.arrayContaining([
        "https://server-only.supabase.co",
        "wss://server-only.supabase.co",
        "https://o9.ingest.sentry.io",
      ]),
    );
    expect(policy.get("report-uri")).toEqual(["https://csp.example.com/report"]);

    const preferPublic = contentSecurityPolicyFromEnv(
      {
        NODE_ENV: "production",
        NEXT_PUBLIC_SUPABASE_URL: "https://public.supabase.co",
        SUPABASE_URL: "https://server-only.supabase.co",
      },
      NONCE,
    );
    expect(directives(preferPublic.value).get("img-src")).toContain("https://public.supabase.co");
  });
});
