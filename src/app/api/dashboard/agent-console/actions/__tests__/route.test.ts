import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConfirmationRequiredError } from "@/lib/workflow-agent/confirmation.server";
import { DashboardAgentActionError } from "@/lib/workflow-agent/dashboard-actions.server";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  requireUser: vi.fn(),
}));

vi.mock("@/lib/workflow-agent/dashboard-actions.server", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/workflow-agent/dashboard-actions.server")>();
  return { ...actual, executeDashboardAgentAction: mocks.execute };
});

vi.mock("@/lib/support/auth.server", () => ({
  requireSupportUser: mocks.requireUser,
}));

vi.mock("@/lib/logger.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger.server")>();
  return { ...actual, getRequestId: () => "request-action-1" };
});

describe("workflow agent Console action route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ userId: "user-1", email: "user@example.com" });
  });

  it("authenticates and executes a trusted apply request", async () => {
    mocks.execute.mockResolvedValue({ action: "apply", output: { success: true } });
    const { POST } = await import("../route");

    const response = await POST(
      new Request("https://example.test/api/dashboard/agent-console/actions", {
        method: "POST",
        headers: {
          authorization: "Bearer session-token",
          "content-type": "application/json",
          "user-agent": "route-test",
        },
        body: JSON.stringify({
          action: "apply",
          previewCallId: "67f354e9-309d-4e1f-b81b-6d3d419aeb52",
          selectedOperationIndexes: [0],
          confirmationToken: "mcp_confirm_valid",
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("request-action-1");
    expect(mocks.execute).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ action: "apply", selectedOperationIndexes: [0] }),
      expect.objectContaining({ requestId: "request-action-1", userAgent: "route-test" }),
    );
  });

  it("returns a structured confirmation challenge", async () => {
    mocks.execute.mockRejectedValue(
      new ConfirmationRequiredError(
        "mcp_confirm_new",
        "2026-07-10T00:15:00.000Z",
        "Apply workflow preview",
      ),
    );
    const { POST } = await import("../route");

    const response = await POST(
      new Request("https://example.test/api/dashboard/agent-console/actions", {
        method: "POST",
        headers: { authorization: "Bearer session-token", "content-type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          previewCallId: "67f354e9-309d-4e1f-b81b-6d3d419aeb52",
          selectedOperationIndexes: [0],
        }),
      }),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "confirmation_required", requestId: "request-action-1" },
      confirmation: {
        token: "mcp_confirm_new",
        expiresAt: "2026-07-10T00:15:00.000Z",
      },
    });
  });

  it("preserves safe action error codes and statuses", async () => {
    mocks.execute.mockRejectedValue(
      new DashboardAgentActionError(422, "invalid_operation_selection", "Invalid selection"),
    );
    const { POST } = await import("../route");

    const response = await POST(
      new Request("https://example.test/api/dashboard/agent-console/actions", {
        method: "POST",
        headers: { authorization: "Bearer session-token", "content-type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          previewCallId: "67f354e9-309d-4e1f-b81b-6d3d419aeb52",
          selectedOperationIndexes: [9],
        }),
      }),
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_operation_selection", message: "Invalid selection" },
    });
  });

  it("rejects malformed action bodies before execution", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      new Request("https://example.test/api/dashboard/agent-console/actions", {
        method: "POST",
        headers: { authorization: "Bearer session-token", "content-type": "application/json" },
        body: JSON.stringify({
          action: "apply",
          previewCallId: "not-a-uuid",
          selectedOperationIndexes: [],
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
