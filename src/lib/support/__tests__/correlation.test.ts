import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mcpMocks = vi.hoisted(() => ({
  authenticateBearer: vi.fn(),
  checkDailyQuota: vi.fn(),
  checkShortWindowQuota: vi.fn(),
  dispatchTool: vi.fn(),
  getDefaultInstance: vi.fn(),
  getMergedTools: vi.fn(),
  recordCall: vi.fn(),
}));

const sentryMocks = vi.hoisted(() => ({
  captureRouterTransitionStart: vi.fn(),
  captureException: vi.fn(() => "sentry-event-123"),
  init: vi.fn(),
}));

vi.mock("@/lib/mcp.server", () => ({
  ...mcpMocks,
  ElicitationRequiredError: class ElicitationRequiredError extends Error {
    constructor(
      public readonly elicitationId: string,
      public readonly request: unknown,
    ) {
      super(`Elicitation required (${elicitationId})`);
    }
  },
}));
vi.mock("@/lib/mcp-upstream.server", () => ({
  isUpstreamConfigured: () => false,
}));
vi.mock("@sentry/nextjs", () => sentryMocks);

describe("request correlation", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubEnv("LOG_FORMAT", "json");
    vi.stubEnv("LOG_LEVEL", "debug");
    mcpMocks.authenticateBearer.mockResolvedValue({
      user_id: "user-1",
      key_id: "key-1",
      daily_limit: 100,
    });
    mcpMocks.checkShortWindowQuota.mockResolvedValue(true);
    mcpMocks.checkDailyQuota.mockResolvedValue({ ok: true, used: 0, limit: 100 });
    mcpMocks.getDefaultInstance.mockResolvedValue({ id: "instance-1" });
    mcpMocks.getMergedTools.mockResolvedValue([]);
    mcpMocks.recordCall.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("recursively redacts sensitive logger fields", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { log } = await import("@/lib/logger.server");

    log.info("support.test", {
      authorization: "Bearer secret",
      nested: {
        cookie: "session=secret",
        cookies: ["session=secret"],
        apiKey: "n8n-secret",
        password: "password-secret",
        TOKEN: "token-secret",
        access_token: "access-secret",
        refreshToken: "refresh-secret",
        Secret: "generic-secret",
        SESSION: "session-secret",
        body: "private chat text",
        attachments: [{ name: "secret.png" }],
        safe: "visible",
      },
    });

    const payload = JSON.parse(String(output.mock.calls[0]?.[0])) as Record<string, unknown>;
    expect(payload).toMatchObject({
      authorization: "[REDACTED]",
      nested: {
        cookie: "[REDACTED]",
        cookies: "[REDACTED]",
        apiKey: "[REDACTED]",
        password: "[REDACTED]",
        TOKEN: "[REDACTED]",
        access_token: "[REDACTED]",
        refreshToken: "[REDACTED]",
        Secret: "[REDACTED]",
        SESSION: "[REDACTED]",
        body: "[REDACTED]",
        attachments: "[REDACTED]",
        safe: "visible",
      },
    });
    expect(JSON.stringify(payload)).not.toContain("secret");
    expect(JSON.stringify(payload)).not.toContain("private chat text");
  });

  it("uses redacted fields for pretty logger output", async () => {
    vi.stubEnv("LOG_FORMAT", "pretty");
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { log } = await import("@/lib/logger.server");

    log.info("support.test", {
      cookies: ["session=secret"],
      nested: { authorization: "Bearer secret", safe: "visible" },
    });

    expect(output).toHaveBeenCalledWith(
      expect.any(String),
      "[INFO]",
      "support.test",
      expect.objectContaining({
        cookies: "[REDACTED]",
        nested: { authorization: "[REDACTED]", safe: "visible" },
      }),
    );
    expect(JSON.stringify(output.mock.calls)).not.toContain("session=secret");
    expect(JSON.stringify(output.mock.calls)).not.toContain("Bearer secret");
  });

  it("creates a support-safe error DTO without a stack", async () => {
    const { createSafeErrorDto } = await import("@/lib/logger.server");

    const dto = createSafeErrorDto("Unable to send reply", "request-123", "sentry-event-123");

    expect(dto).toEqual({
      error: "Unable to send reply",
      requestId: "request-123",
      sentryEventId: "sentry-event-123",
    });
    expect(dto).not.toHaveProperty("stack");
  });

  it("sanitizes Sentry request data, chat text, and attachments in beforeSend", async () => {
    await import("@/sentry.server.config");

    const options = sentryMocks.init.mock.calls[0]?.[0] as {
      beforeSend?: (event: Record<string, unknown>) => Record<string, unknown>;
    };
    expect(options.beforeSend).toBeTypeOf("function");

    const sanitized = options.beforeSend?.({
      request: {
        url: "https://example.test/api/support",
        data: {
          message: "private request chat",
          attachments: [{ name: "private.png", path: "user/ticket/private.png" }],
        },
      },
      contexts: {
        support: {
          cookies: ["session=secret"],
          chatText: "private nested chat",
          attachments: [{ name: "nested.png" }],
          password: "password-secret",
          Token: "token-secret",
          accessToken: "access-secret",
          REFRESH_TOKEN: "refresh-secret",
          SECRET: "generic-secret",
          session: "session-secret",
          ticketId: "ticket-123",
        },
      },
    });

    expect(sanitized).toMatchObject({
      request: {
        url: "https://example.test/api/support",
      },
      contexts: {
        support: {
          cookies: "[REDACTED]",
          chatText: "[REDACTED]",
          attachments: "[REDACTED]",
          password: "[REDACTED]",
          Token: "[REDACTED]",
          accessToken: "[REDACTED]",
          REFRESH_TOKEN: "[REDACTED]",
          SECRET: "[REDACTED]",
          session: "[REDACTED]",
          ticketId: "ticket-123",
        },
      },
    });
    expect((sanitized?.request as Record<string, unknown>).data).toBeUndefined();
    const serialized = JSON.stringify(sanitized);
    expect(serialized).not.toContain("private request chat");
    expect(serialized).not.toContain("private nested chat");
    expect(serialized).not.toContain("private.png");
    expect(serialized).not.toContain("nested.png");
  });

  it.each(["@/instrumentation-client", "@/sentry.edge.config"])(
    "keeps client and edge Sentry sensitive keys aligned in %s",
    async (modulePath) => {
      const { sanitizeSentryEvent } = await import(modulePath);

      const sanitized = sanitizeSentryEvent({
        contexts: {
          support: {
            authorization: "Bearer secret",
            cookie: "session=secret",
            cookies: ["session=secret"],
            apiKey: "n8n-secret",
            Password: "password-secret",
            token: "token-secret",
            ACCESS_TOKEN: "access-secret",
            refresh_token: "refresh-secret",
            secret: "generic-secret",
            Session: "session-secret",
            body: "private body",
          },
        },
      });

      expect(sanitized).toMatchObject({
        contexts: {
          support: {
            authorization: "[REDACTED]",
            cookie: "[REDACTED]",
            cookies: "[REDACTED]",
            apiKey: "[REDACTED]",
            Password: "[REDACTED]",
            token: "[REDACTED]",
            ACCESS_TOKEN: "[REDACTED]",
            refresh_token: "[REDACTED]",
            secret: "[REDACTED]",
            Session: "[REDACTED]",
            body: "[REDACTED]",
          },
        },
      });
    },
  );

  it("uses an accepted request id in MCP logs and responses", async () => {
    const output = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { mcpPost } = await import("@/lib/mcp-route.server");
    const requestId = "request-from-client";

    const response = await mcpPost(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
          "x-request-id": requestId,
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
    );

    expect(response.headers.get("x-request-id")).toBe(requestId);
    const logs = output.mock.calls.map(([line]) => JSON.parse(String(line)));
    expect(logs).toContainEqual(expect.objectContaining({ request_id: requestId }));
  });

  it.each([
    ["GET", "mcpGet", 405],
    ["OPTIONS", "mcpOptions", 204],
  ] as const)("accepts a request id for MCP %s responses", async (method, exportName, status) => {
    const route = await import("@/lib/mcp-route.server");
    const requestId = `request-from-${method.toLowerCase()}`;

    const response = await route[exportName](
      new Request("https://example.test/mcp", {
        method,
        headers: { "x-request-id": requestId },
      }),
    );

    expect(response.status).toBe(status);
    expect(response.headers.get("x-request-id")).toBe(requestId);
  });

  it.each([
    ["GET", "mcpGet"],
    ["OPTIONS", "mcpOptions"],
  ] as const)("generates a request id for MCP %s responses", async (method, exportName) => {
    const route = await import("@/lib/mcp-route.server");

    const response = await route[exportName](new Request("https://example.test/mcp", { method }));

    expect(response.headers.get("x-request-id")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("generates a request id and returns safe tool error correlation", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    mcpMocks.dispatchTool.mockRejectedValue(new Error("secret failure"));
    const { mcpPost } = await import("@/lib/mcp-route.server");

    const response = await mcpPost(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method: "tools/call",
          params: { name: "failing_tool", arguments: {} },
        }),
      }),
    );

    const requestId = response.headers.get("x-request-id");
    expect(requestId).toMatch(/^[0-9a-f-]{36}$/);
    const payload = await response.json();
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain(requestId);
    expect(serialized).toContain("sentry-event-123");
    expect(serialized).not.toContain("secret failure");
    expect(serialized).not.toContain("stack");
  });

  it("returns sanitized validation errors so agents can self-correct tool calls", async () => {
    mcpMocks.dispatchTool.mockRejectedValue(new Error("workflowId is required"));
    const { mcpPost } = await import("@/lib/mcp-route.server");

    const response = await mcpPost(
      new Request("https://example.test/mcp", {
        method: "POST",
        headers: {
          authorization: "Bearer test",
          "content-type": "application/json",
          "x-request-id": "validation-request",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 3,
          method: "tools/call",
          params: { name: "deploy_and_test_workflow", arguments: {} },
        }),
      }),
    );

    const payload = await response.json();
    const serialized = JSON.stringify(payload);
    expect(serialized).toContain("workflowId is required");
    expect(serialized).toContain("validation-request");
    expect(serialized).not.toContain("stack");
  });
});
