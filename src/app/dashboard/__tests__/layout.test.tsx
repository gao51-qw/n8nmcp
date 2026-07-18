// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  launcherProps: vi.fn(),
  searchParams: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => mocks.searchParams,
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    user: { id: "10000000-0000-4000-8000-000000000001" },
    loading: false,
  }),
}));

vi.mock("@/components/support/support-launcher", () => ({
  SupportLauncher: (props: unknown) => {
    mocks.launcherProps(props);
    return null;
  },
}));

import DashboardLayout from "../layout";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("dashboard support mount", () => {
  let root: Root | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.searchParams = new URLSearchParams();
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = "";
  });

  async function renderLayout() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () =>
      root?.render(
        <DashboardLayout>
          <div>Dashboard</div>
        </DashboardLayout>,
      ),
    );
  }

  it("passes bounded URL correlation IDs to the support launcher", async () => {
    mocks.searchParams = new URLSearchParams({
      sentryEventId: "sentry-123",
      mcpRequestId: "mcp-456",
    });

    await renderLayout();

    expect(mocks.launcherProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sentryEventId: "sentry-123",
        mcpRequestId: "mcp-456",
      }),
    );
  });

  it("drops overlong correlation IDs instead of persisting or forwarding them", async () => {
    mocks.searchParams = new URLSearchParams({
      sentryEventId: "s".repeat(129),
      mcpRequestId: "m".repeat(129),
    });
    const storageSpy = vi.spyOn(Storage.prototype, "setItem");

    await renderLayout();

    expect(mocks.launcherProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sentryEventId: undefined,
        mcpRequestId: undefined,
      }),
    );
    expect(storageSpy).not.toHaveBeenCalled();
  });
});
