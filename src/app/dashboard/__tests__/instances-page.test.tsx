// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ supportFetch: vi.fn() }));

vi.mock("@/lib/support/http.client", () => ({ supportFetch: mocks.supportFetch }));

import InstancesPage from "../instances/page";
import ApiKeysPage from "../api-keys/page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function instance(id: string, name: string, createdAt: string) {
  return {
    id,
    name,
    base_url: `https://${id}.example.com`,
    status: "ok",
    created_at: createdAt,
    native_mcp: { configured: false, tools: [], checked_at: null },
  };
}

describe("dashboard destructive actions", () => {
  let root: Root | null = null;
  const confirmSpy = vi.fn(() => true);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("confirm", confirmSpy);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function render(element: React.ReactElement) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(element));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    return host;
  }

  function buttons(text: string, scope: ParentNode = document) {
    return Array.from(scope.querySelectorAll("button")).filter(
      (element) => element.textContent?.trim() === text,
    );
  }

  it("marks the first instance as active for MCP and confirms removal in a dialog", async () => {
    const instances = [
      instance("first", "Production", "2026-01-01T00:00:00.000Z"),
      instance("second", "Staging", "2026-02-01T00:00:00.000Z"),
    ];
    mocks.supportFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return { ok: true };
      return { instances: url === "/api/dashboard/instances" ? instances : [] };
    });

    const host = await render(<InstancesPage />);

    const items = host.querySelectorAll("li");
    expect(items[0].textContent).toContain("Active for MCP");
    expect(items[1].textContent).not.toContain("Active for MCP");

    await act(async () => buttons("Remove", items[0])[0].click());

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Remove Production?");
    expect(dialog?.textContent).toContain("MCP tools will move to Staging");
    expect(mocks.supportFetch).not.toHaveBeenCalledWith(
      "/api/dashboard/instances/first",
      expect.anything(),
    );

    await act(async () => buttons("Remove instance")[0].click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.supportFetch).toHaveBeenCalledWith("/api/dashboard/instances/first", {
      method: "DELETE",
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("revokes an API key only after the dialog is confirmed", async () => {
    mocks.supportFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return { ok: true };
      return {
        keys: [
          {
            id: "key-1",
            name: "Laptop",
            key_prefix: "nmcp_abc",
            created_at: "2026-01-01T00:00:00.000Z",
            last_used_at: null,
            revoked_at: null,
          },
        ],
      };
    });

    await render(<ApiKeysPage />);
    await act(async () => buttons("Revoke")[0].click());

    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      'Revoke "Laptop"?',
    );

    await act(async () => buttons("Cancel")[0].click());
    expect(mocks.supportFetch).not.toHaveBeenCalledWith(
      "/api/dashboard/api-keys/key-1",
      expect.anything(),
    );

    await act(async () => buttons("Revoke")[0].click());
    await act(async () => buttons("Revoke key")[0].click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.supportFetch).toHaveBeenCalledWith("/api/dashboard/api-keys/key-1", {
      method: "DELETE",
    });
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});
