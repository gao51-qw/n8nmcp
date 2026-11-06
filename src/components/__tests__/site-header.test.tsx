// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: {
    user: null as { id: string } | null,
    loading: false,
  },
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/components/theme-toggle", () => ({
  ThemeToggle: () => <button type="button">theme</button>,
}));

import { SiteHeader } from "../site-header";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("site header", () => {
  let root: Root | null = null;
  let host: HTMLDivElement;

  beforeEach(() => {
    mocks.auth = { user: null, loading: false };
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  async function renderHeader() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<SiteHeader />));
  }

  function links(): Array<{ text: string; href: string }> {
    return Array.from(host.querySelectorAll("a")).map((a) => ({
      text: a.textContent?.trim() ?? "",
      href: a.getAttribute("href") ?? "",
    }));
  }

  it("renders the primary navigation with a sign-in action for visitors", async () => {
    await renderHeader();

    const texts = links().map((l) => l.text);
    for (const label of ["Pricing", "Docs", "FAQ", "Blog", "GitHub", "Sign in", "Get started"]) {
      expect(texts, `missing ${label}`).toContain(label);
    }
    expect(texts).not.toContain("Dashboard");
    expect(links().find((l) => l.text === "Sign in")?.href).toMatch(/\/login$/);
    expect(links().find((l) => l.text === "Get started")?.href).toMatch(/\/signup$/);
  });

  it("swaps the sign-in action for a dashboard link once signed in", async () => {
    mocks.auth = { user: { id: "user-1" }, loading: false };

    await renderHeader();

    const texts = links().map((l) => l.text);
    expect(texts).toContain("Dashboard");
    expect(texts).not.toContain("Sign in");
    expect(texts).not.toContain("Get started");
  });

  it("renders no account action while the session is still loading", async () => {
    mocks.auth = { user: null, loading: true };

    await renderHeader();

    const texts = links().map((l) => l.text);
    expect(texts).not.toContain("Sign in");
    expect(texts).not.toContain("Get started");
    expect(texts).not.toContain("Dashboard");
    expect(texts).toContain("Pricing");
  });
});
