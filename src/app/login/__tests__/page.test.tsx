// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  routerReplace: vi.fn(),
  routerRefresh: vi.fn(),
  searchParams: new URLSearchParams("next=/dashboard/support"),
  signInWithOtp: vi.fn(),
  verifyOtp: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.routerReplace, refresh: mocks.routerRefresh }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      signInWithOtp: mocks.signInWithOtp,
      verifyOtp: mocks.verifyOtp,
    },
  },
}));

import LoginPage from "../page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

async function setInputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("email OTP login", () => {
  let root: Root | null = null;
  let host: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams("next=/dashboard/support");
    mocks.signInWithOtp.mockResolvedValue({ data: {}, error: null });
    mocks.verifyOtp.mockResolvedValue({ data: {}, error: null });
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    host?.remove();
    host = null;
    vi.useRealTimers();
  });

  async function renderPage() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<LoginPage />));
    return host;
  }

  async function moveToCodeStep(view: HTMLDivElement) {
    await setInputValue(view.querySelector('input[type="email"]') as HTMLInputElement, " New.User@Example.com ");
    await act(async () => {
      view.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  }

  it("sends a normalized email OTP and shows code entry", async () => {
    const view = await renderPage();
    await moveToCodeStep(view);

    expect(mocks.signInWithOtp).toHaveBeenCalledWith({
      email: "new.user@example.com",
      options: { shouldCreateUser: true },
    });
    expect(view.textContent).toContain("Enter verification code");
    expect(view.querySelector('input[type="password"]')).toBeNull();
  });

  it("verifies a six-digit code and navigates to the safe destination", async () => {
    const view = await renderPage();
    await moveToCodeStep(view);
    const codeInput = view.querySelector('input[autocomplete="one-time-code"]');

    expect(codeInput).toBeInstanceOf(HTMLInputElement);
    await setInputValue(codeInput as HTMLInputElement, "123456");
    await act(async () => {
      view.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(mocks.verifyOtp).toHaveBeenCalledWith({
      email: "new.user@example.com",
      token: "123456",
      type: "email",
    });
    expect(mocks.routerReplace).toHaveBeenCalledWith("/dashboard/support");
    expect(mocks.routerRefresh).toHaveBeenCalledTimes(1);
  });

  it("rejects non-digits and disables verification until all six digits are entered", async () => {
    const view = await renderPage();
    await moveToCodeStep(view);
    const codeInput = view.querySelector('input[autocomplete="one-time-code"]');
    const verifyButton = view.querySelector('button[type="submit"]') as HTMLButtonElement;

    expect(codeInput).toBeInstanceOf(HTMLInputElement);
    expect(verifyButton.disabled).toBe(true);
    await setInputValue(codeInput as HTMLInputElement, "12ab");
    expect((codeInput as HTMLInputElement).value).toBe("");
    await setInputValue(codeInput as HTMLInputElement, "12345");
    expect(verifyButton.disabled).toBe(true);
  });

  it("keeps code entry visible and reports an invalid OTP", async () => {
    mocks.verifyOtp.mockResolvedValueOnce({ data: {}, error: { message: "Invalid verification code" } });
    const view = await renderPage();
    await moveToCodeStep(view);
    const codeInput = view.querySelector('input[autocomplete="one-time-code"]');

    expect(codeInput).toBeInstanceOf(HTMLInputElement);
    await setInputValue(codeInput as HTMLInputElement, "123456");
    await act(async () => {
      view.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(view.textContent).toContain("Enter verification code");
    expect(view.querySelector('[role="alert"]')?.textContent).toContain("Invalid verification code");
  });

  it("enables resend after 60 seconds and restarts the cooldown", async () => {
    vi.useFakeTimers();
    const view = await renderPage();
    await moveToCodeStep(view);
    const codeInput = view.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement;
    const resendButton = Array.from(view.querySelectorAll('button[type="button"]')).find((button) =>
      button.textContent?.includes("Resend code"),
    );

    await setInputValue(codeInput, "123456");
    expect(resendButton).toBeInstanceOf(HTMLButtonElement);
    expect((resendButton as HTMLButtonElement).disabled).toBe(true);
    expect(view.textContent).toContain("Resend code in 60s");

    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    expect((resendButton as HTMLButtonElement).disabled).toBe(false);
    await act(async () => {
      resendButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(mocks.signInWithOtp).toHaveBeenLastCalledWith({
      email: "new.user@example.com",
      options: { shouldCreateUser: true },
    });
    expect(codeInput.value).toBe("");
    expect(view.textContent).toContain("Resend code in 60s");
  });

  it("changes email and clears the OTP error", async () => {
    mocks.verifyOtp.mockResolvedValueOnce({ data: {}, error: { message: "Invalid verification code" } });
    const view = await renderPage();
    await moveToCodeStep(view);
    const codeInput = view.querySelector('input[autocomplete="one-time-code"]') as HTMLInputElement;

    await setInputValue(codeInput, "123456");
    await act(async () => {
      view.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await act(async () => {
      Array.from(view.querySelectorAll('button[type="button"]'))
        .find((button) => button.textContent?.includes("Change email"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(view.querySelector('input[type="email"]')).toBeInstanceOf(HTMLInputElement);
    expect(view.querySelector('input[autocomplete="one-time-code"]')).toBeNull();
    expect(view.querySelector('[role="alert"]')).toBeNull();
  });
});
