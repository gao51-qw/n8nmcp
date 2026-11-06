// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  refreshSession: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  onInvalidate: null as null | (() => void),
}));

vi.mock("@/components/auth-provider", () => ({
  useAuth: () => ({
    user: { id: "10000000-0000-4000-8000-000000000001" },
    loading: false,
    signOut: vi.fn(),
  }),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: mocks.getSession, refreshSession: mocks.refreshSession },
  },
}));

vi.mock("@/lib/workflow-agent/realtime.client", () => ({
  subscribeToWorkflowAgentConsole: (
    userId: string,
    handlers: { onInvalidate: () => void; onStatus: (status: string) => void },
  ) => {
    mocks.subscribe(userId);
    mocks.onInvalidate = handlers.onInvalidate;
    return mocks.unsubscribe;
  },
}));

vi.mock("@/components/workflow-agent/agent-console", () => ({
  WorkflowAgentConsole: (props: {
    actionState?: { status: string; message?: string };
    onApply?: (input: {
      previewCallId: string;
      selectedOperationIndexes: number[];
    }) => Promise<void>;
  }) => (
    <div>
      <p data-testid="console">console ready</p>
      <p data-testid="action-state">
        {props.actionState?.status}:{props.actionState?.message ?? ""}
      </p>
      <button
        type="button"
        onClick={() =>
          void props
            .onApply?.({ previewCallId: "preview-1", selectedOperationIndexes: [0] })
            .catch(() => undefined)
        }
      >
        apply
      </button>
    </div>
  ),
}));

import { AgentConsoleClient } from "../agent-console/agent-console-client";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function session(token: string) {
  return { data: { session: { access_token: token, user: { id: USER_ID } } }, error: null };
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const consoleData = { data: { workflows: [] } };

describe("agent console client", () => {
  let root: Root | null = null;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.onInvalidate = null;
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    if (root) await act(async () => root?.unmount());
    root = null;
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  async function settle(ms = 0) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  }

  async function render() {
    const host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<AgentConsoleClient />));
    await settle();
  }

  function authHeaders(): Array<string | null> {
    return fetchMock.mock.calls.map(([, init]) =>
      new Headers((init as RequestInit | undefined)?.headers).get("authorization"),
    );
  }

  function button(text: string): HTMLButtonElement {
    const found = Array.from(document.querySelectorAll("button")).find(
      (element) => element.textContent?.trim() === text,
    );
    if (!found) throw new Error(`button ${text} not found`);
    return found as HTMLButtonElement;
  }

  it("reads a fresh access token for every request and keeps one realtime channel", async () => {
    mocks.getSession
      .mockResolvedValueOnce(session("token-1"))
      .mockResolvedValueOnce(session("token-2"));
    fetchMock.mockImplementation(async () => jsonResponse(consoleData));

    await render();
    expect(document.body.textContent).toContain("console ready");

    await act(async () => mocks.onInvalidate?.());
    await settle(200);

    expect(authHeaders()).toEqual(["Bearer token-1", "Bearer token-2"]);
    expect(mocks.subscribe).toHaveBeenCalledTimes(1);
    expect(mocks.subscribe).toHaveBeenCalledWith(USER_ID);
    expect(mocks.unsubscribe).not.toHaveBeenCalled();
  });

  it("refreshes the session once and retries after a 401", async () => {
    mocks.getSession.mockResolvedValue(session("stale-token"));
    mocks.refreshSession.mockResolvedValue(session("fresh-token"));
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ error: "Authentication required" }, 401))
      .mockResolvedValueOnce(jsonResponse(consoleData));

    await render();

    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(authHeaders()).toEqual(["Bearer stale-token", "Bearer fresh-token"]);
    expect(document.body.textContent).toContain("console ready");
  });

  it("asks the user to sign in again when the session cannot be refreshed", async () => {
    mocks.getSession.mockResolvedValue(session("stale-token"));
    mocks.refreshSession.mockResolvedValue({ data: { session: null }, error: { message: "gone" } });
    fetchMock.mockResolvedValue(jsonResponse({ error: "Authentication required" }, 401));

    await render();

    expect(document.querySelector('[role="alert"]')?.textContent).toContain(
      "Your session has expired",
    );
    expect(button("Sign in again")).toBeDefined();
  });

  it("shows a readable message for other load failures", async () => {
    mocks.getSession.mockResolvedValue(session("token-1"));
    fetchMock.mockResolvedValue(
      jsonResponse({ error: "Support request failed", requestId: "r-1" }, 500),
    );

    await render();

    expect(document.querySelector('[role="alert"]')?.textContent).toBe("Support request failed");
    expect(button("Retry")).toBeDefined();
  });

  it("shows the message of a structured API error instead of raw JSON", async () => {
    mocks.getSession.mockResolvedValue(session("token-1"));
    fetchMock.mockResolvedValue(
      jsonResponse(
        { error: { code: "internal_error", message: "Request failed", requestId: "r-2" } },
        500,
      ),
    );

    await render();

    const alert = document.querySelector('[role="alert"]')?.textContent ?? "";
    expect(alert).toBe("Request failed");
    expect(alert).not.toContain("{");
  });

  it("keeps the 409 confirmation flow and sends the confirmation token", async () => {
    mocks.getSession
      .mockResolvedValueOnce(session("token-load"))
      .mockResolvedValueOnce(session("token-apply"))
      .mockResolvedValue(session("token-confirm"));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(consoleData))
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: { code: "confirmation_required", message: "Confirmation required" },
            confirmation: { token: "mcp_confirm_1", summary: "Apply 1 change to Orders" },
          },
          409,
        ),
      )
      .mockResolvedValueOnce(jsonResponse({ action: "apply", output: { success: true } }))
      .mockResolvedValue(jsonResponse(consoleData));

    await render();
    await act(async () => button("apply").click());
    await settle();

    expect(document.body.textContent).toContain("Apply 1 change to Orders");
    await act(async () => button("Confirm").click());
    await settle();

    const [, applyInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    const [confirmUrl, confirmInit] = fetchMock.mock.calls[2] as [string, RequestInit];
    expect(JSON.parse(String(applyInit.body))).not.toHaveProperty("confirmationToken");
    expect(confirmUrl).toBe("/api/dashboard/agent-console/actions");
    expect(JSON.parse(String(confirmInit.body))).toMatchObject({
      action: "apply",
      previewCallId: "preview-1",
      confirmationToken: "mcp_confirm_1",
    });
    expect(authHeaders().slice(0, 3)).toEqual([
      "Bearer token-load",
      "Bearer token-apply",
      "Bearer token-confirm",
    ]);
    expect(document.querySelector('[data-testid="action-state"]')?.textContent).toContain(
      "success",
    );
  });

  it("reports a failed action with the API's error message", async () => {
    mocks.getSession.mockResolvedValue(session("token-1"));
    fetchMock
      .mockResolvedValueOnce(jsonResponse(consoleData))
      .mockResolvedValueOnce(
        jsonResponse(
          { error: { code: "invalid_operation_selection", message: "Invalid selection" } },
          422,
        ),
      );

    await render();
    await act(async () => button("apply").click());
    await settle();

    expect(document.querySelector('[data-testid="action-state"]')?.textContent).toBe(
      "error:Invalid selection",
    );
  });
});
