// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  searchParams: new URLSearchParams(),
  auth: {
    user: null as null | { id: string; email?: string },
    session: null as null | { access_token: string; user: { id: string; email?: string } },
    loading: false,
  },
  setSession: vi.fn(),
  ensurePersisted: vi.fn(async () => true),
  getAccessToken: vi.fn(async () => "access-1" as string | null),
  emailLinkStatus: "none" as "none" | "exchanged" | "failed",
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, refresh: mocks.refresh }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ ...mocks.auth, signOut: vi.fn() }),
}));

vi.mock("@/lib/auth/browser-session.client", () => ({
  authStore: () => ({ setSession: mocks.setSession, ensurePersisted: mocks.ensurePersisted }),
  getAccessToken: mocks.getAccessToken,
  getEmailLinkStatus: () => mocks.emailLinkStatus,
}));

import { AuthCallback } from "@/app/auth/callback/auth-callback";
import { ForgotPasswordForm } from "@/app/forgot-password/forgot-password-form";
import { ResetPasswordForm } from "@/app/reset-password/reset-password-form";
import { SignupForm } from "@/app/signup/signup-form";
import { LoginForm } from "../login-form";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const fetchMock = vi.fn<typeof fetch>();
let root: Root | null = null;
let container: HTMLDivElement | null = null;

async function render(element: React.ReactElement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root!.render(element));
}

async function fill(id: string, value: string) {
  const input = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  await act(async () => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function submit() {
  const form = document.querySelector("form")!;
  await act(async () => {
    form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
}

function alertText(): string | null | undefined {
  return document.querySelector('[role="alert"]')?.textContent;
}

function lastRequest(): { url: string; init: RequestInit; body: Record<string, unknown> } {
  const [url, init] = fetchMock.mock.calls.at(-1)! as [string, RequestInit];
  return { url, init, body: JSON.parse(String(init.body)) };
}

const SESSION_BODY = {
  access_token: "access-1",
  expires_at: Math.floor(Date.now() / 1000) + 3600,
  user: { id: "u1", email: "a@example.com" },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  mocks.searchParams = new URLSearchParams();
  mocks.auth = { user: null, session: null, loading: false };
  mocks.ensurePersisted.mockResolvedValue(true);
  mocks.getAccessToken.mockResolvedValue("access-1");
  mocks.emailLinkStatus = "none";
  window.history.replaceState(null, "", "/");
});

afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  vi.unstubAllGlobals();
});

describe("LoginForm", () => {
  it("posts to /api/auth/login and continues once the cookie round-trips", async () => {
    mocks.searchParams = new URLSearchParams("next=%2Fdashboard%2Fbilling");
    fetchMock.mockResolvedValue(Response.json(SESSION_BODY));
    await render(<LoginForm />);

    await fill("email", "a@example.com");
    await fill("password", "secret");
    await submit();

    const { url, init, body } = lastRequest();
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("same-origin");
    expect(new Headers(init.headers).get("content-type")).toBe("application/json");
    expect(body).toEqual({ email: "a@example.com", password: "secret" });
    expect(mocks.setSession).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: "access-1" }),
    );
    expect(mocks.ensurePersisted).toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard/billing");
  });

  it("shows the server's error message", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "invalid_credentials", message: "Invalid login credentials" } },
        { status: 400 },
      ),
    );
    await render(<LoginForm />);
    await fill("email", "a@example.com");
    await fill("password", "wrong");
    await submit();

    expect(alertText()).toBe("Invalid login credentials");
    expect(mocks.setSession).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("validates input before calling the server", async () => {
    await render(<LoginForm />);
    await fill("email", "not-an-email");
    await fill("password", "x");
    await submit();

    expect(alertText()).toBe("Enter a valid email address.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not navigate when the browser refuses the session cookie", async () => {
    fetchMock.mockResolvedValue(Response.json(SESSION_BODY));
    mocks.ensurePersisted.mockResolvedValue(false);
    await render(<LoginForm />);
    await fill("email", "a@example.com");
    await fill("password", "secret");
    await submit();

    expect(alertText()).toContain("did not keep the session cookie");
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});

describe("SignupForm", () => {
  it("posts to /api/auth/signup with the destination and shows the confirmation step", async () => {
    mocks.searchParams = new URLSearchParams("next=%2Fdashboard%2Fbilling");
    fetchMock.mockResolvedValue(Response.json({ confirmation_required: true }));
    await render(<SignupForm />);
    await fill("email", "new@example.com");
    await fill("password", "long-enough");
    await fill("confirm-password", "long-enough");
    await submit();

    const { url, body } = lastRequest();
    expect(url).toBe("/api/auth/signup");
    expect(body).toEqual({
      email: "new@example.com",
      password: "long-enough",
      next: "/dashboard/billing",
    });
    expect(document.body.textContent).toContain("Check your email");
    expect(mocks.setSession).not.toHaveBeenCalled();
  });

  it("signs in directly when confirmation is off", async () => {
    fetchMock.mockResolvedValue(Response.json({ ...SESSION_BODY, confirmation_required: false }));
    await render(<SignupForm />);
    await fill("email", "new@example.com");
    await fill("password", "long-enough");
    await fill("confirm-password", "long-enough");
    await submit();

    expect(mocks.setSession).toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
  });
});

describe("ForgotPasswordForm", () => {
  it("posts to /api/auth/recover and confirms without revealing the account", async () => {
    fetchMock.mockResolvedValue(Response.json({ ok: true }));
    await render(<ForgotPasswordForm />);
    await fill("email", "a@example.com");
    await submit();

    const { url, body } = lastRequest();
    expect(url).toBe("/api/auth/recover");
    expect(body).toEqual({ email: "a@example.com", next: "/dashboard" });
    expect(document.querySelector('[role="status"]')?.textContent).toContain(
      "If an account exists",
    );
  });

  it("shows a rate-limit error", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "rate_limited", message: "Too many attempts." } },
        { status: 429 },
      ),
    );
    await render(<ForgotPasswordForm />);
    await fill("email", "a@example.com");
    await submit();
    expect(alertText()).toBe("Too many attempts.");
  });
});

describe("ResetPasswordForm", () => {
  it("sends the new password with the in-memory access token", async () => {
    mocks.auth = {
      user: { id: "u1", email: "a@example.com" },
      session: { access_token: "access-1", user: { id: "u1", email: "a@example.com" } },
      loading: false,
    };
    fetchMock.mockResolvedValue(Response.json({ ok: true }));
    await render(<ResetPasswordForm />);
    await fill("password", "new-password");
    await fill("confirm-password", "new-password");
    await submit();

    const { url, init, body } = lastRequest();
    expect(url).toBe("/api/auth/password");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer access-1");
    expect(body).toEqual({ password: "new-password" });
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("explains an invalid link when the exchange failed", async () => {
    mocks.emailLinkStatus = "failed";
    await render(<ResetPasswordForm />);
    expect(document.body.textContent).toContain("Reset link not valid");
    expect(document.querySelector("form")).toBeNull();
  });
});

describe("AuthCallback", () => {
  it("continues to next once the exchanged session is persisted", async () => {
    mocks.searchParams = new URLSearchParams("next=%2Fdashboard%2Fapi-keys");
    mocks.auth = { user: { id: "u1" }, session: null, loading: false };
    mocks.emailLinkStatus = "exchanged";
    await render(<AuthCallback />);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.ensurePersisted).toHaveBeenCalled();
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard/api-keys");
  });

  it("shows Supabase's link error and does not navigate", async () => {
    window.history.replaceState(null, "", "/auth/callback#error_description=Email+link+is+invalid");
    await render(<AuthCallback />);
    expect(alertText()).toBe("Email link is invalid");
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("refuses an unsafe next", async () => {
    mocks.searchParams = new URLSearchParams("next=%2F%2Fevil.example");
    mocks.auth = { user: { id: "u1" }, session: null, loading: false };
    await render(<AuthCallback />);
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
  });
});
