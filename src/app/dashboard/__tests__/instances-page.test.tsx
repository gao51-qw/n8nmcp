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

function instance(id: string, name: string, createdAt: string, isDefault = false) {
  return {
    id,
    name,
    base_url: `https://${id}.example.com`,
    status: "ok",
    created_at: createdAt,
    is_default: isDefault,
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

  it("marks the default instance as active for MCP and confirms removal in a dialog", async () => {
    const instances = [
      instance("first", "Production", "2026-01-01T00:00:00.000Z", true),
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
    expect(buttons("Use for MCP", items[0])).toHaveLength(0);
    expect(buttons("Use for MCP", items[1])).toHaveLength(1);

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

  it("shows the badge from is_default, not from the list position", async () => {
    const instances = [
      instance("first", "Production", "2026-01-01T00:00:00.000Z"),
      instance("second", "Staging", "2026-02-01T00:00:00.000Z"),
      instance("third", "Sandbox", "2026-03-01T00:00:00.000Z", true),
    ];
    mocks.supportFetch.mockResolvedValue({ instances });

    const host = await render(<InstancesPage />);

    const items = host.querySelectorAll("li");
    expect(items[0].textContent).not.toContain("Active for MCP");
    expect(items[1].textContent).not.toContain("Active for MCP");
    expect(items[2].textContent).toContain("Active for MCP");

    // Removing the active instance hands MCP to the oldest remaining one.
    await act(async () => buttons("Remove", items[2])[0].click());
    let dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("MCP tools will move to Production");
    await act(async () => buttons("Cancel")[0].click());

    // Removing another instance leaves MCP where it is.
    await act(async () => buttons("Remove", items[1])[0].click());
    dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("MCP tools keep working with Sandbox");
    expect(dialog?.textContent).not.toContain("will move to");
  });

  it("switches the MCP instance only after the dialog is confirmed", async () => {
    let instances = [
      instance("first", "Production", "2026-01-01T00:00:00.000Z", true),
      instance("second", "Staging", "2026-02-01T00:00:00.000Z"),
    ];
    mocks.supportFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        instances = instances.map((item) => ({ ...item, is_default: item.id === "second" }));
        return { instance: instances[1] };
      }
      return { instances };
    });

    const host = await render(<InstancesPage />);
    await act(async () => buttons("Use for MCP", host.querySelectorAll("li")[1])[0].click());

    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog?.textContent).toContain("Use Staging for MCP?");
    expect(dialog?.textContent).toContain("instead of Production");
    expect(dialog?.textContent).toContain(
      "Pending workflow previews and rollbacks recorded on Production will be refused afterwards",
    );

    await act(async () => buttons("Cancel")[0].click());
    expect(mocks.supportFetch).not.toHaveBeenCalledWith(
      "/api/dashboard/instances/second",
      expect.anything(),
    );

    await act(async () => buttons("Use for MCP", host.querySelectorAll("li")[1])[0].click());
    const confirm = buttons("Use for MCP", document.querySelector('[role="alertdialog"]')!)[0];
    await act(async () => confirm.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(mocks.supportFetch).toHaveBeenCalledWith("/api/dashboard/instances/second", {
      method: "PATCH",
      body: JSON.stringify({ is_default: true }),
    });
    const items = host.querySelectorAll("li");
    expect(items[0].textContent).not.toContain("Active for MCP");
    expect(items[1].textContent).toContain("Active for MCP");
    expect(buttons("Use for MCP", items[0])).toHaveLength(1);
  });

  it("reports a failed switch on the page", async () => {
    const instances = [
      instance("first", "Production", "2026-01-01T00:00:00.000Z", true),
      instance("second", "Staging", "2026-02-01T00:00:00.000Z"),
    ];
    mocks.supportFetch.mockImplementation(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PATCH") throw new Error("Instance not found");
      return { instances };
    });

    const host = await render(<InstancesPage />);
    await act(async () => buttons("Use for MCP", host.querySelectorAll("li")[1])[0].click());
    const confirm = buttons("Use for MCP", document.querySelector('[role="alertdialog"]')!)[0];
    await act(async () => confirm.click());
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));

    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Instance not found");
    expect(host.querySelectorAll("li")[0].textContent).toContain("Active for MCP");
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
