import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  listApiKeys: vi.fn(),
  createApiKey: vi.fn(),
  revokeApiKey: vi.fn(),
  listInstances: vi.fn(),
  createInstance: vi.fn(),
  setNativeMcpToken: vi.fn(),
  setDefaultInstance: vi.fn(),
  deleteInstance: vi.fn(),
  deleteOwnAccount: vi.fn(),
  listGrants: vi.fn(),
  loadConsole: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(() => "sentry-1") }));

vi.mock("@/lib/support/auth.server", () => ({ requireSupportUser: mocks.requireUser }));

vi.mock("@/lib/logger.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger.server")>();
  return {
    ...actual,
    getRequestId: () => "request-1",
    log: { ...actual.log, info: vi.fn(), error: vi.fn() },
  };
});

vi.mock("@/lib/platform-api-keys.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/platform-api-keys.server")>();
  return {
    ...actual,
    listApiKeys: mocks.listApiKeys,
    createApiKey: mocks.createApiKey,
    revokeApiKey: mocks.revokeApiKey,
  };
});

vi.mock("@/lib/n8n-instances.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/n8n-instances.server")>();
  return {
    ...actual,
    listInstances: mocks.listInstances,
    createInstance: mocks.createInstance,
    setNativeMcpToken: mocks.setNativeMcpToken,
    setDefaultInstance: mocks.setDefaultInstance,
    deleteInstance: mocks.deleteInstance,
  };
});

vi.mock("@/lib/account-deletion.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/account-deletion.server")>();
  return { ...actual, deleteOwnAccount: mocks.deleteOwnAccount };
});

vi.mock("@/lib/oauth/grants.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/oauth/grants.server")>();
  return { ...actual, listGrants: mocks.listGrants };
});

vi.mock("@/lib/dashboard-agent-console", () => ({
  loadWorkflowAgentConsoleData: mocks.loadConsole,
}));

const KEY_ID = "67f354e9-309d-4e1f-b81b-6d3d419aeb52";

function req(path: string, init: RequestInit = {}): Request {
  return new Request(`https://dashboard.example.test${path}`, {
    ...init,
    headers: { authorization: "Bearer session", "content-type": "application/json" },
  });
}

const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function expectError(response: Response, status: number, code: string, message: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("x-request-id")).toBe("request-1");
  await expect(response.json()).resolves.toEqual({
    error: { code, message, requestId: "request-1" },
  });
}

describe("dashboard API error contract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ userId: "user-1", email: "user@example.com" });
  });

  it("returns JSON 401 for every route when authentication fails", async () => {
    mocks.requireUser.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
    const apiKeys = await import("../api-keys/route");
    const apiKey = await import("../api-keys/[id]/route");
    const instances = await import("../instances/route");
    const instance = await import("../instances/[id]/route");
    const account = await import("../account/route");
    const consoleRoute = await import("../agent-console/route");
    const grants = await import("../../oauth/grants/route");

    const responses = await Promise.all([
      apiKeys.GET(req("/api/dashboard/api-keys")),
      apiKeys.POST(req("/api/dashboard/api-keys", { method: "POST", body: "{}" })),
      apiKey.DELETE(req(`/api/dashboard/api-keys/${KEY_ID}`), params(KEY_ID)),
      instances.GET(req("/api/dashboard/instances")),
      instance.DELETE(req(`/api/dashboard/instances/${KEY_ID}`), params(KEY_ID)),
      account.DELETE(req("/api/dashboard/account", { method: "DELETE", body: "{}" })),
      consoleRoute.GET(req("/api/dashboard/agent-console")),
      grants.GET(req("/api/oauth/grants")),
    ]);
    for (const response of responses) {
      await expectError(response, 401, "authentication_required", "Authentication required");
    }
  });

  it("passes domain error messages through with a status-derived code", async () => {
    const { ApiKeyError } = await import("@/lib/platform-api-keys.server");
    mocks.createApiKey.mockRejectedValue(new ApiKeyError("Too many active keys", 409));
    const { POST } = await import("../api-keys/route");

    await expectError(
      await POST(req("/api/dashboard/api-keys", { method: "POST", body: '{"name":"x"}' })),
      409,
      "conflict",
      "Too many active keys",
    );
    expect(mocks.createApiKey).toHaveBeenCalledWith("user-1", "x");
  });

  it("rejects non-UUID ids as not found without calling the service", async () => {
    const apiKey = await import("../api-keys/[id]/route");
    const instance = await import("../instances/[id]/route");

    await expectError(
      await apiKey.DELETE(req("/api/dashboard/api-keys/abc"), params("abc")),
      404,
      "not_found",
      "API key not found",
    );
    await expectError(
      await instance.PATCH(
        req("/api/dashboard/instances/abc", { method: "PATCH", body: '{"mcp_token":null}' }),
        params("abc"),
      ),
      404,
      "not_found",
      "Instance not found",
    );
    expect(mocks.revokeApiKey).not.toHaveBeenCalled();
    expect(mocks.setNativeMcpToken).not.toHaveBeenCalled();
  });

  it("validates instance bodies", async () => {
    const instances = await import("../instances/route");
    const instance = await import("../instances/[id]/route");

    await expectError(
      await instances.POST(req("/api/dashboard/instances", { method: "POST", body: "nope" })),
      400,
      "invalid_json",
      "Invalid JSON body",
    );
    await expectError(
      await instance.PATCH(
        req(`/api/dashboard/instances/${KEY_ID}`, { method: "PATCH", body: "{}" }),
        params(KEY_ID),
      ),
      400,
      "invalid_request",
      "mcp_token or is_default is required",
    );
    await expectError(
      await instance.PATCH(
        req(`/api/dashboard/instances/${KEY_ID}`, {
          method: "PATCH",
          body: '{"is_default":false}',
        }),
        params(KEY_ID),
      ),
      400,
      "invalid_request",
      "is_default can only be set to true; choose another instance to move MCP away from this one",
    );
    await expectError(
      await instance.PATCH(
        req(`/api/dashboard/instances/${KEY_ID}`, {
          method: "PATCH",
          body: '{"is_default":"true"}',
        }),
        params(KEY_ID),
      ),
      400,
      "invalid_request",
      "is_default can only be set to true; choose another instance to move MCP away from this one",
    );
    await expectError(
      await instance.PATCH(
        req(`/api/dashboard/instances/${KEY_ID}`, {
          method: "PATCH",
          body: '{"is_default":true,"mcp_token":null}',
        }),
        params(KEY_ID),
      ),
      400,
      "invalid_request",
      "Send either mcp_token or is_default, not both",
    );
    expect(mocks.setDefaultInstance).not.toHaveBeenCalled();
    expect(mocks.setNativeMcpToken).not.toHaveBeenCalled();
  });

  it("chooses the MCP instance with is_default: true", async () => {
    const { InstanceError } = await import("@/lib/n8n-instances.server");
    const instance = await import("../instances/[id]/route");
    mocks.setDefaultInstance.mockResolvedValueOnce({ id: KEY_ID, is_default: true });

    const response = await instance.PATCH(
      req(`/api/dashboard/instances/${KEY_ID}`, { method: "PATCH", body: '{"is_default":true}' }),
      params(KEY_ID),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      instance: { id: KEY_ID, is_default: true },
    });
    expect(mocks.setDefaultInstance).toHaveBeenCalledWith("user-1", KEY_ID);
    expect(mocks.setNativeMcpToken).not.toHaveBeenCalled();

    mocks.setDefaultInstance.mockRejectedValueOnce(new InstanceError("Instance not found", 404));
    await expectError(
      await instance.PATCH(
        req(`/api/dashboard/instances/${KEY_ID}`, { method: "PATCH", body: '{"is_default":true}' }),
        params(KEY_ID),
      ),
      404,
      "not_found",
      "Instance not found",
    );
  });

  it("hides unexpected errors and keeps the account-deletion guidance", async () => {
    mocks.listInstances.mockRejectedValue(new Error("db password=hunter2"));
    mocks.deleteOwnAccount.mockRejectedValue(new Error("auth admin down"));
    const instances = await import("../instances/route");
    const account = await import("../account/route");

    await expectError(
      await instances.GET(req("/api/dashboard/instances")),
      500,
      "internal_error",
      "Request failed",
    );
    await expectError(
      await account.DELETE(req("/api/dashboard/account", { method: "DELETE", body: "{}" })),
      500,
      "internal_error",
      "Account deletion did not finish and your sign-in still exists. Contact support.",
    );
  });

  it("keeps success payloads and marks them no-store", async () => {
    mocks.listGrants.mockResolvedValue([{ client_id: "c1" }]);
    mocks.loadConsole.mockResolvedValue({ workflows: [] });
    const grants = await import("../../oauth/grants/route");
    const consoleRoute = await import("../agent-console/route");

    const grantsResponse = await grants.GET(req("/api/oauth/grants"));
    expect(grantsResponse.status).toBe(200);
    expect(grantsResponse.headers.get("cache-control")).toBe("no-store");
    await expect(grantsResponse.json()).resolves.toEqual({ grants: [{ client_id: "c1" }] });

    const consoleResponse = await consoleRoute.GET(
      req("/api/dashboard/agent-console?workflowId=wf-1"),
    );
    expect(consoleResponse.headers.get("x-request-id")).toBe("request-1");
    await expect(consoleResponse.json()).resolves.toEqual({ data: { workflows: [] } });
    expect(mocks.loadConsole).toHaveBeenCalledWith("user-1", { workflowId: "wf-1" });
  });
});
