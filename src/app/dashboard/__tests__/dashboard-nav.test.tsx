// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/dashboard",
  replace: vi.fn(),
  signOut: vi.fn(async () => undefined),
  isAdmin: vi.fn(async (_userId: string) => false),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    user: { id: "10000000-0000-4000-8000-000000000001", email: "user@example.com" },
    loading: false,
    signOut: mocks.signOut,
  }),
}));

vi.mock("@/lib/support/admin-role.client", () => ({
  hasSupportAdminRole: mocks.isAdmin,
}));

import {
  DASHBOARD_NAV_ITEMS,
  DashboardNav,
  isActiveDashboardPath,
  normalizeDashboardPath,
} from "@/components/dashboard/dashboard-nav";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function item(label: string) {
  const found = DASHBOARD_NAV_ITEMS.find((entry) => entry.label === label);
  if (!found) throw new Error(`missing nav item ${label}`);
  return found;
}

describe("dashboard path matching", () => {
  it("folds dashboard-host paths onto the /dashboard route tree", () => {
    expect(normalizeDashboardPath("/")).toBe("/dashboard");
    expect(normalizeDashboardPath("/instances")).toBe("/dashboard/instances");
    expect(normalizeDashboardPath("/dashboard/instances/")).toBe("/dashboard/instances");
    expect(normalizeDashboardPath("/dashboard")).toBe("/dashboard");
    expect(normalizeDashboardPath(null)).toBe("/dashboard");
  });

  it("matches the overview exactly and other sections by prefix on either host", () => {
    expect(isActiveDashboardPath("/dashboard", item("Overview"))).toBe(true);
    expect(isActiveDashboardPath("/", item("Overview"))).toBe(true);
    expect(isActiveDashboardPath("/dashboard/usage", item("Overview"))).toBe(false);
    expect(isActiveDashboardPath("/usage", item("Usage"))).toBe(true);
    expect(isActiveDashboardPath("/dashboard/admin/support", item("Support"))).toBe(false);
    expect(isActiveDashboardPath("/dashboard/support", item("Support"))).toBe(true);
  });
});

describe("dashboard navigation", () => {
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pathname = "/dashboard";
    mocks.isAdmin.mockResolvedValue(false);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  async function renderNav() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<DashboardNav />));
    return host.querySelector('nav[aria-label="Dashboard"]') as HTMLElement;
  }

  function links(nav: HTMLElement) {
    return Array.from(nav.querySelectorAll("a")).map((a) => ({
      text: a.textContent?.trim() ?? "",
      href: a.getAttribute("href") ?? "",
      current: a.getAttribute("aria-current"),
    }));
  }

  it("links every dashboard section and hides the admin link from non-admins", async () => {
    const nav = await renderNav();

    expect(links(nav).map(({ text, href }) => [text, href])).toEqual([
      ["Overview", "/dashboard"],
      ["Instances", "/dashboard/instances"],
      ["API keys", "/dashboard/api-keys"],
      ["Connected apps", "/dashboard/connected-apps"],
      ["Usage", "/dashboard/usage"],
      ["Agent Console", "/dashboard/agent-console"],
      ["Billing", "/dashboard/billing"],
      ["Account", "/dashboard/account"],
      ["Support", "/dashboard/support"],
    ]);
  });

  it("shows the admin support link to admins", async () => {
    mocks.isAdmin.mockResolvedValue(true);

    const nav = await renderNav();

    expect(links(nav)).toContainEqual(
      expect.objectContaining({ text: "Admin support", href: "/dashboard/admin/support" }),
    );
    expect(mocks.isAdmin).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000001");
  });

  it("hides the admin link when the role check fails", async () => {
    mocks.isAdmin.mockRejectedValue(new Error("network"));

    const nav = await renderNav();

    expect(links(nav).map((link) => link.text)).not.toContain("Admin support");
  });

  it("marks the active route, including rewritten dashboard-host paths", async () => {
    mocks.pathname = "/api-keys";

    const nav = await renderNav();

    const current = links(nav).filter((link) => link.current === "page");
    expect(current).toEqual([{ text: "API keys", href: "/dashboard/api-keys", current: "page" }]);
  });

  it("signs out and returns to the sign-in page", async () => {
    const nav = await renderNav();
    const button = Array.from(nav.querySelectorAll("button")).find((element) =>
      element.textContent?.includes("Sign out"),
    );
    expect(button).toBeDefined();

    await act(async () => button?.click());

    expect(mocks.signOut).toHaveBeenCalledTimes(1);
    expect(mocks.replace).toHaveBeenCalledWith("/login");
  });
});
