import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  resetPasswordForEmail: vi.fn(),
  refreshSession: vi.fn(),
  getUser: vi.fn(),
  adminSignOut: vi.fn(),
  updatePasswordWithToken: vi.fn(),
  requireSupportUser: vi.fn(),
}));

vi.mock("@/lib/auth/supabase-auth.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/supabase-auth.server")>();
  return {
    ...actual,
    anonAuthClient: () => ({
      signInWithPassword: mocks.signInWithPassword,
      signUp: mocks.signUp,
      resetPasswordForEmail: mocks.resetPasswordForEmail,
      refreshSession: mocks.refreshSession,
      getUser: mocks.getUser,
      admin: { signOut: mocks.adminSignOut },
    }),
    updatePasswordWithToken: mocks.updatePasswordWithToken,
  };
});

vi.mock("@/lib/support/auth.server", () => ({ requireSupportUser: mocks.requireSupportUser }));

import { POST as exchange } from "../exchange/route";
import { POST as login } from "../login/route";
import { POST as logout } from "../logout/route";
import { POST as password } from "../password/route";
import { POST as recover } from "../recover/route";
import { POST as refresh } from "../refresh/route";
import { POST as signup } from "../signup/route";
import { resetAuthRateLimits } from "@/lib/auth/request-guard.server";

const HOST = "dashboard.n8nworkflow.com";
const ORIGIN = `https://${HOST}`;

type Init = {
  body?: unknown;
  cookie?: string;
  headers?: Record<string, string | null>;
  path?: string;
};

function req(path: string, init: Init = {}): Request {
  const headers: Record<string, string> = {
    host: HOST,
    origin: ORIGIN,
    "sec-fetch-site": "same-origin",
    "content-type": "application/json",
    "x-forwarded-for": "203.0.113.5",
  };
  if (init.cookie) headers.cookie = init.cookie;
  for (const [name, value] of Object.entries(init.headers ?? {})) {
    if (value === null) delete headers[name];
    else headers[name] = value;
  }
  return new Request(`${ORIGIN}/api/auth/${path}`, {
    method: "POST",
    headers,
    body: typeof init.body === "string" ? init.body : JSON.stringify(init.body ?? {}),
  });
}

function session(refreshToken = "rt-new", accessToken = "at-new", userId = "u1") {
  return {
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_in: 3600,
    expires_at: 2_000_000_000,
    token_type: "bearer",
    user: { id: userId, email: "a@example.com" },
  };
}

function authError(status: number, message: string, code = "") {
  return { name: "AuthApiError", status, message, code };
}

function cookies(response: Response): string[] {
  return response.headers.getSetCookie();
}

function cookie(response: Response, name: string, domain = true): string | undefined {
  return cookies(response).find(
    (value) => value.startsWith(`${name}=`) && value.includes("Domain=.n8nworkflow.com") === domain,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAuthRateLimits();
  vi.stubEnv("SUPABASE_URL", "https://abcdefgh.supabase.co");
  vi.stubEnv("SUPABASE_PUBLISHABLE_KEY", "pk");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("CSRF and request guards (all endpoints)", () => {
  const endpoints = [
    ["login", login, { email: "a@example.com", password: "secret" }],
    ["signup", signup, { email: "a@example.com", password: "long-enough" }],
    ["recover", recover, { email: "a@example.com" }],
    ["refresh", refresh, {}],
    ["exchange", exchange, { refresh_token: "rt" }],
    ["logout", logout, {}],
    ["password", password, { password: "long-enough" }],
  ] as const;

  it.each(endpoints)(
    "%s rejects cross-site and sibling-subdomain calls",
    async (path, handler, body) => {
      const variants: Record<string, string | null>[] = [
        { "sec-fetch-site": "cross-site" },
        { "sec-fetch-site": "same-site", origin: "https://docs.n8nworkflow.com" },
        { origin: null, "sec-fetch-site": null },
        { origin: "null" },
        { origin: "https://evil.example", "sec-fetch-site": null },
        { origin: "https://docs.n8nworkflow.com", "sec-fetch-site": null },
      ];
      for (const headers of variants) {
        const response = await handler(req(path, { body, headers, cookie: "n8nmcp-rt=rt-old" }));
        expect(response.status, JSON.stringify(headers)).toBe(403);
        expect(response.headers.get("cache-control")).toBe("no-store");
        expect(cookies(response)).toEqual([]);
      }
      expect(mocks.signInWithPassword).not.toHaveBeenCalled();
      expect(mocks.refreshSession).not.toHaveBeenCalled();
      expect(mocks.adminSignOut).not.toHaveBeenCalled();
    },
  );

  it.each(endpoints)(
    "%s rejects an unconfigured host even when same-origin",
    async (path, handler, body) => {
      const response = await handler(
        req(path, { body, headers: { host: "evil.example", origin: "https://evil.example" } }),
      );
      expect(response.status).toBe(403);
    },
  );

  it.each(endpoints)("%s requires a JSON content type", async (path, handler, body) => {
    const response = await handler(req(path, { body, headers: { "content-type": "text/plain" } }));
    expect(response.status).toBe(415);
  });

  it("accepts browsers that omit Sec-Fetch-Site when Origin matches", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { session: session() }, error: null });
    const response = await login(
      req("login", {
        body: { email: "a@example.com", password: "pw" },
        headers: { "sec-fetch-site": null },
      }),
    );
    expect(response.status).toBe(200);
  });
});

describe("POST /api/auth/login", () => {
  it("signs in, sets the HttpOnly cookies and returns only the access token", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { session: session("rt-1") }, error: null });

    const response = await login(
      req("login", { body: { email: " A@example.com ", password: "secret" } }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.signInWithPassword).toHaveBeenCalledWith({
      email: "A@example.com",
      password: "secret",
    });
    expect(body).toEqual({
      access_token: "at-new",
      expires_at: 2_000_000_000,
      user: { id: "u1", email: "a@example.com" },
    });
    expect(JSON.stringify(body)).not.toContain("rt-1");
    expect(response.headers.get("cache-control")).toBe("no-store");

    const rt = cookie(response, "n8nmcp-rt");
    expect(rt).toBe(
      "n8nmcp-rt=rt-1; Path=/api/auth; Max-Age=2592000; HttpOnly; SameSite=Lax; Domain=.n8nworkflow.com; Secure",
    );
    expect(cookie(response, "n8nmcp-session")).toBe(
      "n8nmcp-session=1; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax; Domain=.n8nworkflow.com; Secure",
    );
    // Host-only copies that would shadow the shared cookie are deleted.
    expect(cookie(response, "n8nmcp-rt", false)).toContain("Max-Age=0");
    expect(cookie(response, "n8nmcp-session", false)).toContain("Max-Age=0");
  });

  it("uses host-only, non-Secure cookies on http://localhost", async () => {
    mocks.signInWithPassword.mockResolvedValue({ data: { session: session("rt-1") }, error: null });
    const response = await login(
      req("login", {
        body: { email: "a@example.com", password: "secret" },
        headers: { host: "localhost:3000", origin: "http://localhost:3000" },
      }),
    );
    expect(cookies(response)).toEqual([
      "n8nmcp-rt=rt-1; Path=/api/auth; Max-Age=2592000; HttpOnly; SameSite=Lax",
      "n8nmcp-session=1; Path=/; Max-Age=2592000; HttpOnly; SameSite=Lax",
    ]);
  });

  it("rejects bad input without calling Supabase", async () => {
    for (const body of [{ email: "nope", password: "x" }, { email: "a@example.com" }, "not json"]) {
      const response = await login(req("login", { body }));
      expect(response.status).toBe(400);
    }
    expect(mocks.signInWithPassword).not.toHaveBeenCalled();
  });

  it("passes Supabase's credential error through and sets no cookie", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: authError(400, "Invalid login credentials", "invalid_credentials"),
    });
    const response = await login(req("login", { body: { email: "a@example.com", password: "x" } }));
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toBe("Invalid login credentials");
    expect(cookies(response)).toEqual([]);
  });

  it("hides upstream failures behind a generic 502", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: authError(500, "pq: connection refused"),
    });
    const response = await login(req("login", { body: { email: "a@example.com", password: "x" } }));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("pq:");
  });

  it("rate-limits repeated attempts for one account", async () => {
    mocks.signInWithPassword.mockResolvedValue({
      data: { session: null },
      error: authError(400, "Invalid login credentials"),
    });
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const response = await login(
        req("login", {
          body: { email: "victim@example.com", password: `guess-${i}` },
          headers: { "x-forwarded-for": `198.51.100.${i}` },
        }),
      );
      statuses.push(response.status);
    }
    expect(statuses.slice(0, 10).every((status) => status === 400)).toBe(true);
    expect(statuses[10]).toBe(429);
    expect(mocks.signInWithPassword).toHaveBeenCalledTimes(10);
  });
});

describe("POST /api/auth/refresh", () => {
  it("answers 204 without touching Supabase when there is no cookie", async () => {
    const response = await refresh(req("refresh"));
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(cookies(response)).toEqual([]);
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });

  it("clears a stale presence marker that has no refresh cookie", async () => {
    const response = await refresh(req("refresh", { cookie: "n8nmcp-session=1" }));
    expect(response.status).toBe(204);
    expect(cookie(response, "n8nmcp-session")).toContain("Max-Age=0");
  });

  it("rotates the refresh cookie and returns a new access token", async () => {
    mocks.refreshSession.mockResolvedValue({
      data: { session: session("rt-rotated", "at-2") },
      error: null,
    });
    const response = await refresh(
      req("refresh", { cookie: "other=1; n8nmcp-rt=rt-old; n8nmcp-session=1" }),
    );

    expect(response.status).toBe(200);
    expect(mocks.refreshSession).toHaveBeenCalledWith({ refresh_token: "rt-old" });
    expect((await response.json()).access_token).toBe("at-2");
    expect(cookie(response, "n8nmcp-rt")).toMatch(/^n8nmcp-rt=rt-rotated; Path=\/api\/auth;/);
  });

  it("clears both cookies and answers 401 when Supabase rejects the token", async () => {
    mocks.refreshSession.mockResolvedValue({
      data: { session: null },
      error: authError(400, "Invalid Refresh Token: Already Used", "refresh_token_already_used"),
    });
    const response = await refresh(req("refresh", { cookie: "n8nmcp-rt=rt-old" }));

    expect(response.status).toBe(401);
    expect((await response.json()).error.code).toBe("session_expired");
    expect(cookie(response, "n8nmcp-rt")).toContain("Max-Age=0");
    expect(cookie(response, "n8nmcp-rt")).toContain("Path=/api/auth");
    expect(cookie(response, "n8nmcp-session")).toContain("Max-Age=0");
  });

  it("keeps the cookie when Supabase is unavailable", async () => {
    mocks.refreshSession.mockResolvedValue({
      data: { session: null },
      error: authError(503, "upstream down"),
    });
    const response = await refresh(req("refresh", { cookie: "n8nmcp-rt=rt-old" }));
    expect(response.status).toBe(502);
    expect(cookies(response)).toEqual([]);
  });

  it("gives up on a hanging Supabase after the deadline and keeps the cookie", async () => {
    vi.useFakeTimers();
    try {
      mocks.refreshSession.mockReturnValue(new Promise(() => undefined));
      const pending = refresh(req("refresh", { cookie: "n8nmcp-rt=rt-old" }));
      await vi.advanceTimersByTimeAsync(10_000);
      const response = await pending;
      expect(response.status).toBe(502);
      expect(cookies(response)).toEqual([]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a malformed refresh cookie", async () => {
    const response = await refresh(req("refresh", { cookie: "n8nmcp-rt=%E0%A4%A" }));
    expect(response.status).toBe(204);
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/exchange", () => {
  it("verifies an email-link access token, rotates the refresh token and sets the cookie", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    mocks.refreshSession.mockResolvedValue({
      data: { session: session("rt-rotated") },
      error: null,
    });

    const response = await exchange(
      req("exchange", { body: { access_token: "link-at", refresh_token: "link-rt" } }),
    );

    expect(response.status).toBe(200);
    expect(mocks.getUser).toHaveBeenCalledWith("link-at");
    expect(mocks.refreshSession).toHaveBeenCalledWith({ refresh_token: "link-rt" });
    expect(cookie(response, "n8nmcp-rt")).toMatch(/^n8nmcp-rt=rt-rotated;/);
    expect(JSON.stringify(await response.json())).not.toContain("rt-rotated");
  });

  it("migrates a legacy refresh token without an access token", async () => {
    mocks.refreshSession.mockResolvedValue({ data: { session: session() }, error: null });
    const response = await exchange(req("exchange", { body: { refresh_token: "legacy-rt" } }));
    expect(response.status).toBe(200);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("answers 401 and leaves existing cookies alone when the token is rejected", async () => {
    mocks.refreshSession.mockResolvedValue({
      data: { session: null },
      error: authError(400, "Invalid Refresh Token: Refresh Token Not Found"),
    });
    const response = await exchange(
      req("exchange", { body: { refresh_token: "bogus" }, cookie: "n8nmcp-rt=good" }),
    );
    expect(response.status).toBe(401);
    expect(cookies(response)).toEqual([]);
  });

  it("rejects an invalid access token before using the refresh token", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: authError(403, "bad jwt") });
    const response = await exchange(
      req("exchange", { body: { access_token: "forged", refresh_token: "rt" } }),
    );
    expect(response.status).toBe(401);
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });

  it("rejects tokens that belong to different users", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: { id: "attacker" } }, error: null });
    mocks.refreshSession.mockResolvedValue({
      data: { session: session("rt", "at", "victim") },
      error: null,
    });
    const response = await exchange(
      req("exchange", { body: { access_token: "a", refresh_token: "b" } }),
    );
    expect(response.status).toBe(401);
    expect(cookies(response)).toEqual([]);
  });

  it("rejects malformed bodies", async () => {
    for (const body of [{}, { refresh_token: "" }, { refresh_token: "has space" }]) {
      expect((await exchange(req("exchange", { body }))).status).toBe(400);
    }
  });
});

describe("POST /api/auth/logout", () => {
  it("revokes with the bearer token and clears both cookies", async () => {
    mocks.adminSignOut.mockResolvedValue({ data: null, error: null });
    const response = await logout(
      req("logout", { headers: { authorization: "Bearer at-1" }, cookie: "n8nmcp-rt=rt-1" }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, revoked: true });
    expect(mocks.adminSignOut).toHaveBeenCalledWith("at-1", "global");
    expect(mocks.refreshSession).not.toHaveBeenCalled();
    expect(cookie(response, "n8nmcp-rt")).toContain("Max-Age=0");
    expect(cookie(response, "n8nmcp-session")).toContain("Max-Age=0");
  });

  it("uses the refresh cookie when no access token is sent", async () => {
    mocks.refreshSession.mockResolvedValue({
      data: { session: session("x", "at-from-rt") },
      error: null,
    });
    mocks.adminSignOut.mockResolvedValue({ data: null, error: null });
    await logout(req("logout", { cookie: "n8nmcp-rt=rt-1" }));
    expect(mocks.adminSignOut).toHaveBeenCalledWith("at-from-rt", "global");
  });

  it("still clears the cookies when revocation fails", async () => {
    mocks.adminSignOut.mockRejectedValue(new Error("network"));
    const response = await logout(req("logout", { headers: { authorization: "Bearer at-1" } }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, revoked: false });
    expect(cookie(response, "n8nmcp-rt")).toContain("Max-Age=0");
  });
});

describe("POST /api/auth/signup", () => {
  it("asks for confirmation through /auth/callback without setting cookies", async () => {
    mocks.signUp.mockResolvedValue({ data: { session: null, user: { id: "u" } }, error: null });
    const response = await signup(
      req("signup", {
        body: { email: "new@example.com", password: "long-enough", next: "/dashboard/billing" },
      }),
    );

    expect(await response.json()).toEqual({ confirmation_required: true });
    expect(mocks.signUp).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "long-enough",
      options: {
        emailRedirectTo:
          "https://dashboard.n8nworkflow.com/auth/callback?next=%2Fdashboard%2Fbilling",
      },
    });
    expect(cookies(response)).toEqual([]);
  });

  it("collapses an unsafe next and sets cookies when confirmation is off", async () => {
    mocks.signUp.mockResolvedValue({ data: { session: session("rt-s") }, error: null });
    const response = await signup(
      req("signup", { body: { email: "n@example.com", password: "long-enough", next: "//evil" } }),
    );
    expect(mocks.signUp.mock.calls[0][0].options.emailRedirectTo).toBe(
      "https://dashboard.n8nworkflow.com/auth/callback?next=%2Fdashboard",
    );
    expect((await response.json()).confirmation_required).toBe(false);
    expect(cookie(response, "n8nmcp-rt")).toMatch(/^n8nmcp-rt=rt-s;/);
  });

  it("rejects a short password", async () => {
    const response = await signup(
      req("signup", { body: { email: "n@example.com", password: "short" } }),
    );
    expect(response.status).toBe(400);
    expect(mocks.signUp).not.toHaveBeenCalled();
  });
});

describe("POST /api/auth/recover", () => {
  it("sends the reset email to /reset-password on the dashboard host", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
    const response = await recover(
      req("recover", { body: { email: "a@example.com", next: "/dashboard/billing" } }),
    );
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.resetPasswordForEmail).toHaveBeenCalledWith("a@example.com", {
      redirectTo: "https://dashboard.n8nworkflow.com/reset-password?next=%2Fdashboard%2Fbilling",
    });
  });

  it("maps Supabase's email rate limit to 429", async () => {
    mocks.resetPasswordForEmail.mockResolvedValue({
      data: null,
      error: authError(429, "email rate limit exceeded", "over_email_send_rate_limit"),
    });
    const response = await recover(req("recover", { body: { email: "a@example.com" } }));
    expect(response.status).toBe(429);
  });
});

describe("POST /api/auth/password", () => {
  it("requires a bearer token", async () => {
    const response = await password(req("password", { body: { password: "long-enough" } }));
    expect(response.status).toBe(401);
    expect(mocks.updatePasswordWithToken).not.toHaveBeenCalled();
  });

  it("refuses tokens that requireSupportUser rejects (e.g. OAuth-client tokens)", async () => {
    mocks.requireSupportUser.mockRejectedValue(
      Response.json({ error: { code: "authentication_required" } }, { status: 401 }),
    );
    const response = await password(
      req("password", {
        body: { password: "long-enough" },
        headers: { authorization: "Bearer t" },
      }),
    );
    expect(response.status).toBe(401);
    expect(mocks.updatePasswordWithToken).not.toHaveBeenCalled();
  });

  it("updates the password with the user's own token", async () => {
    mocks.requireSupportUser.mockResolvedValue({ userId: "u1", email: null });
    mocks.updatePasswordWithToken.mockResolvedValue(undefined);
    const response = await password(
      req("password", {
        body: { password: "long-enough" },
        headers: { authorization: "Bearer t" },
      }),
    );
    expect(response.status).toBe(200);
    expect(mocks.updatePasswordWithToken).toHaveBeenCalledWith("t", "long-enough");
  });

  it("rejects a weak password", async () => {
    mocks.requireSupportUser.mockResolvedValue({ userId: "u1", email: null });
    const response = await password(
      req("password", { body: { password: "short" }, headers: { authorization: "Bearer t" } }),
    );
    expect(response.status).toBe(400);
  });
});
