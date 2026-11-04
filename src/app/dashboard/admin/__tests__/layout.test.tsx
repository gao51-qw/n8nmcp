// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  hasSupportAdminRole: vi.fn<(userId: string) => Promise<boolean>>(),
  auth: {
    user: { id: "10000000-0000-4000-8000-000000000001" } as { id: string } | null,
    loading: false,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/lib/support/admin-role.client", () => ({
  hasSupportAdminRole: mocks.hasSupportAdminRole,
}));

import AdminLayout from "../layout";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("dashboard admin role gate", () => {
  let root: Root | null = null;
  let host: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth = { user: { id: "10000000-0000-4000-8000-000000000001" }, loading: false };
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  async function renderLayout() {
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(
        <AdminLayout>
          <div data-testid="admin-shell">Admin shell</div>
        </AdminLayout>,
      ),
    );
  }

  it("renders the admin shell only for users with the admin role", async () => {
    mocks.hasSupportAdminRole.mockResolvedValue(true);

    await renderLayout();

    expect(mocks.hasSupportAdminRole).toHaveBeenCalledWith("10000000-0000-4000-8000-000000000001");
    expect(host.querySelector('[data-testid="admin-shell"]')).not.toBeNull();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("redirects non-admin users to the dashboard without mounting the shell", async () => {
    mocks.hasSupportAdminRole.mockResolvedValue(false);

    await renderLayout();

    expect(host.querySelector('[data-testid="admin-shell"]')).toBeNull();
    expect(host.textContent).toContain("Redirecting to the dashboard");
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("fails closed when the role lookup throws", async () => {
    mocks.hasSupportAdminRole.mockRejectedValue(new Error("network down"));

    await renderLayout();

    expect(host.querySelector('[data-testid="admin-shell"]')).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith("/dashboard");
  });

  it("shows a pending state and skips the lookup while the session is still loading", async () => {
    mocks.auth = { user: null, loading: true };

    await renderLayout();

    expect(mocks.hasSupportAdminRole).not.toHaveBeenCalled();
    expect(host.querySelector('[data-testid="admin-shell"]')).toBeNull();
    expect(host.textContent).toContain("Checking permissions");
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
