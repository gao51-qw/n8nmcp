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
          "x-forwarded-for": "1.1.1.1, 203.0.113.7",
          "cf-connecting-ip": "9.9.9.9",
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
      expect.objectContaining({
        requestId: "request-action-1",
        userAgent: "route-test",
        // Right-most X-Forwarded-For (added by nginx); spoofable headers ignored.
        ip: "203.0.113.7",
      }),
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("returns the shared JSON error shape when authentication fails", async () => {
    mocks.requireUser.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
    const { POST } = await import("../route");

    const response = await POST(
      new Request("https://example.test/api/dashboard/agent-console/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      }),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-request-id")).toBe("request-action-1");
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "authentication_required",
        message: "Authentication required",
        requestId: "request-action-1",
      },
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("hides unexpected failures behind a generic message", async () => {
    mocks.execute.mockRejectedValue(new Error("upstream secret detail"));
    const { POST } = await import("../route");

    const response = await POST(
      new Request("https://example.test/api/dashboard/agent-console/actions", {
        method: "POST",
        headers: { authorization: "Bearer session-token", "content-type": "application/json" },
        body: JSON.stringify({
          action: "rollback",
          auditLogId: "67f354e9-309d-4e1f-b81b-6d3d419aeb52",
        }),
      }),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "internal_error",
        message: "Workflow action failed",
        requestId: "request-action-1",
      },
    });
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
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "confirmation_required",
        message: "Apply workflow preview requires confirmation.",
        requestId: "request-action-1",
      },
      confirmation: {
        token: "mcp_confirm_new",
        expiresAt: "2026-07-10T00:15:00.000Z",
        summary: "Apply workflow preview",
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

  it("passes force through on a rollback and returns precheck conflicts as 409", async () => {
    mocks.execute.mockRejectedValue(
      new DashboardAgentActionError(
        409,
        "rollback_conflict",
        "The workflow changed since the audited change; rollback was not applied.",
      ),
    );
    const { POST } = await import("../route");

    const response = await POST(
      new Request("https://example.test/api/dashboard/agent-console/actions", {
        method: "POST",
        headers: { authorization: "Bearer session-token", "content-type": "application/json" },
        body: JSON.stringify({
          action: "rollback",
          auditLogId: "67f354e9-309d-4e1f-b81b-6d3d419aeb52",
          force: true,
        }),
      }),
    );

    expect(mocks.execute).toHaveBeenCalledWith(
      "user-1",
      expect.objectContaining({ action: "rollback", force: true }),
      expect.anything(),
    );
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "rollback_conflict" },
    });
  });

  it("returns a missing audit row as 404 not_found instead of a generic 500", async () => {
    mocks.execute.mockRejectedValue(
      new DashboardAgentActionError(404, "not_found", "Audit log not found"),
    );
    const { POST } = await import("../route");

    const response = await POST(
      new Request("https://example.test/api/dashboard/agent-console/actions", {
        method: "POST",
        headers: { authorization: "Bearer session-token", "content-type": "application/json" },
        body: JSON.stringify({
          action: "rollback",
          auditLogId: "67f354e9-309d-4e1f-b81b-6d3d419aeb52",
        }),
      }),
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "not_found",
        message: "Audit log not found",
        requestId: "request-action-1",
      },
    });
  });

  it("rejects a non-boolean force flag", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      new Request("https://example.test/api/dashboard/agent-console/actions", {
        method: "POST",
        headers: { authorization: "Bearer session-token", "content-type": "application/json" },
        body: JSON.stringify({
          action: "rollback",
          auditLogId: "67f354e9-309d-4e1f-b81b-6d3d419aeb52",
          force: "yes",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.execute).not.toHaveBeenCalled();
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
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "invalid_request", message: "Invalid action request" },
    });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("rejects a body that is not JSON", async () => {
    const { POST } = await import("../route");
    const response = await POST(
      new Request("https://example.test/api/dashboard/agent-console/actions", {
        method: "POST",
        headers: { authorization: "Bearer session-token", "content-type": "application/json" },
        body: "{not json",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "invalid_json" } });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
