// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  supportFetch: vi.fn(),
  revokeGrant: vi.fn(),
}));

vi.mock("@/lib/support/http.client", () => ({ supportFetch: mocks.supportFetch }));
vi.mock("@/lib/auth/oauth-server.client", () => ({
  revokeOAuthGrant: (clientId: string) => mocks.revokeGrant({ clientId }),
}));

import ConnectedAppsPage from "../connected-apps/page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const GRANTS_URL = "/api/oauth/grants";
const REVOKE_URL = "/api/oauth/grants?client_id=client-1";

const grant = {
  client_id: "client-1",
  client_name: "Claude Desktop",
  scopes: ["mcp:tools:read"],
  granted_at: "2026-01-01T00:00:00.000Z",
  last_used_at: null,
};

describe("connected apps revoke", () => {
  let root: Root | null = null;
  const confirmSpy = vi.fn(() => true);

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("confirm", confirmSpy);
    mocks.revokeGrant.mockResolvedValue({ error: null });
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function render() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<ConnectedAppsPage />));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
    return host;
  }

  function buttons(text: string) {
    return Array.from(document.querySelectorAll("button")).filter(
      (element) => element.textContent?.trim() === text,
    );
  }

  async function settle() {
    await act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
  }

  it("revokes a grant only after the dialog is confirmed", async () => {
    mocks.supportFetch.mockImplementation(async (_url: string, init?: RequestInit) =>
      init?.method === "DELETE" ? { ok: true } : { grants: [grant] },
    );

    const host = await render();
    await act(async () => buttons("Revoke")[0].click());

    expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      "Disconnect Claude Desktop?",
    );

    await act(async () => buttons("Cancel")[0].click());
    expect(mocks.supportFetch).not.toHaveBeenCalledWith(REVOKE_URL, expect.anything());
    expect(mocks.revokeGrant).not.toHaveBeenCalled();

    await act(async () => buttons("Revoke")[0].click());
    await act(async () => buttons("Revoke access")[0].click());
    await settle();

    expect(mocks.supportFetch).toHaveBeenCalledWith(REVOKE_URL, { method: "DELETE" });
    expect(mocks.revokeGrant).toHaveBeenCalledWith({ clientId: "client-1" });
    expect(host.querySelector('[role="status"]')?.textContent).toContain(
      "Claude Desktop has been disconnected.",
    );
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("shows a readable error when the revoke request fails", async () => {
    mocks.supportFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") {
        throw new Error(JSON.stringify({ error: { code: "forbidden", message: "Not yours." } }));
      }
      return url === GRANTS_URL ? { grants: [grant] } : {};
    });

    const host = await render();
    await act(async () => buttons("Revoke")[0].click());
    await act(async () => buttons("Revoke access")[0].click());
    await settle();

    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Not yours.");
    expect(mocks.revokeGrant).not.toHaveBeenCalled();
  });
});
