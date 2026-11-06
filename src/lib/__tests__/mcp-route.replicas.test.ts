// Session capabilities sent with `initialize` must survive a tools/call that
// another app replica serves, and the throttle must apply the caller's tier.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { McpSharedState } from "../mcp-shared-state.server";

const mcpServerMocks = vi.hoisted(() => ({
  authenticateBearer: vi.fn(),
  reserveDailyQuota: vi.fn(),
  releaseDailyQuota: vi.fn(),
  checkShortWindowQuota: vi.fn(),
  dispatchTool: vi.fn(),
  getDefaultInstance: vi.fn(),
  getMergedTools: vi.fn(),
  recordCall: vi.fn(),
}));

vi.mock("@/lib/mcp.server", () => ({
  ...mcpServerMocks,
  ElicitationRequiredError: class ElicitationRequiredError extends Error {},
}));
vi.mock("@/lib/mcp-upstream.server", () => ({ isUpstreamConfigured: vi.fn(() => false) }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn(() => "sentry-event") }));
vi.mock("@/lib/logger.server", () => ({
  getRequestId: vi.fn(() => "request-id-1"),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

/**
 * Loads a fresh copy of the route (a "replica": its own module-level state)
 * wired to the given shared state backend.
 */
async function replica(shared: McpSharedState) {
  vi.resetModules();
  const sharedModule = await import("../mcp-shared-state.server");
  sharedModule.setMcpSharedStateForTests(shared);
  const { mcpPost } = await import("../mcp-route.server");
  return mcpPost;
}

function post(
  mcpPost: (request: Request) => Promise<Response>,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return mcpPost(
    new Request("https://example.test/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
    }),
  );
}

const initialize = (capabilities: Record<string, unknown>) => ({
  jsonrpc: "2.0",
  id: "init",
  method: "initialize",
  params: { clientCapabilities: capabilities },
});

const deleteCall = (params: Record<string, unknown> = {}) => ({
  jsonrpc: "2.0",
  id: "call",
  method: "tools/call",
  params: { name: "delete_workflow", arguments: { id: "wf-1" }, ...params },
});

beforeEach(() => {
  vi.clearAllMocks();
  mcpServerMocks.authenticateBearer.mockResolvedValue({
    user_id: "user-1",
    key_id: "key-1",
    tier: "pro",
  });
  mcpServerMocks.checkShortWindowQuota.mockResolvedValue(true);
  mcpServerMocks.reserveDailyQuota.mockResolvedValue({ ok: true, used: 0, limit: 1000 });
  mcpServerMocks.dispatchTool.mockImplementation(async (_name, _args, _inst, ctx) => ({
    output: {
      elicitation: ctx.clientCapabilities?.elicitation ?? null,
      canElicit: typeof ctx.requestElicitation === "function",
    },
    upstream: false,
    category: "local",
    needsInstance: false,
  }));
});

async function seenCapabilities(response: Response) {
  const payload = await response.json();
  return JSON.parse(payload.result.content[0].text) as {
    elicitation: boolean | null;
    canElicit: boolean;
  };
}

describe("session capabilities across replicas", () => {
  it("sees capabilities stored by initialize on another replica", async () => {
    const { createMemorySharedState } = await import("../mcp-shared-state.server");
    const shared = createMemorySharedState();
    const session = { "mcp-session-id": "session-1" };

    const replicaA = await replica(shared);
    expect((await post(replicaA, initialize({ elicitation: true }), session)).status).toBe(200);

    const replicaB = await replica(shared);
    await expect(seenCapabilities(await post(replicaB, deleteCall(), session))).resolves.toEqual({
      elicitation: true,
      canElicit: true,
    });
  });

  it("does not leak capabilities to another session or user", async () => {
    const { createMemorySharedState } = await import("../mcp-shared-state.server");
    const shared = createMemorySharedState();
    const mcpPost = await replica(shared);
    await post(mcpPost, initialize({ elicitation: true }), { "mcp-session-id": "session-a" });

    await expect(
      seenCapabilities(await post(mcpPost, deleteCall(), { "mcp-session-id": "session-b" })),
    ).resolves.toEqual({ elicitation: null, canElicit: false });

    mcpServerMocks.authenticateBearer.mockResolvedValueOnce({
      user_id: "user-2",
      key_id: "key-2",
      tier: "pro",
    });
    await expect(
      seenCapabilities(await post(mcpPost, deleteCall(), { "mcp-session-id": "session-a" })),
    ).resolves.toEqual({ elicitation: null, canElicit: false });
  });

  it("lets a call's explicit capability override the stored one without a lookup", async () => {
    const { createMemorySharedState } = await import("../mcp-shared-state.server");
    const shared = createMemorySharedState();
    const getSpy = vi.spyOn(shared, "getSessionCapabilities");
    const session = { "mcp-session-id": "session-1" };
    const mcpPost = await replica(shared);
    await post(mcpPost, initialize({ elicitation: true }), session);

    await expect(
      seenCapabilities(
        await post(mcpPost, deleteCall({ clientCapabilities: { elicitation: false } }), session),
      ),
    ).resolves.toEqual({ elicitation: false, canElicit: false });
    expect(getSpy).not.toHaveBeenCalled();
  });

  it("keeps initialize working when the shared state cannot store capabilities", async () => {
    const { createMemorySharedState } = await import("../mcp-shared-state.server");
    const shared = createMemorySharedState();
    vi.spyOn(shared, "setSessionCapabilities").mockRejectedValue(new Error("db down"));
    const mcpPost = await replica(shared);

    const response = await post(mcpPost, initialize({ elicitation: true }), {
      "mcp-session-id": "session-1",
    });
    expect(response.status).toBe(200);
    expect((await response.json()).result.protocolVersion).toBeDefined();
  });
});

describe("tier-aware throttle", () => {
  it("passes the caller's tier to the limiter", async () => {
    const { createMemorySharedState } = await import("../mcp-shared-state.server");
    const mcpPost = await replica(createMemorySharedState());
    await post(mcpPost, { jsonrpc: "2.0", id: 1, method: "ping" });
    expect(mcpServerMocks.checkShortWindowQuota).toHaveBeenCalledWith("user-1", "pro");
  });

  it.each([
    ["free", "Rate limit exceeded (free tier: 50 req / 60s, burst 50 req / 10s)"],
    ["pro", "Rate limit exceeded (pro tier: 100 req / 60s, burst 60 req / 10s)"],
    ["enterprise", "Rate limit exceeded (enterprise tier: 1000 req / 60s, burst 334 req / 10s)"],
  ])("answers a throttled %s caller with 429 / -32003 and its limits", async (tier, message) => {
    mcpServerMocks.authenticateBearer.mockResolvedValue({
      user_id: "user-1",
      key_id: "key-1",
      tier,
    });
    mcpServerMocks.checkShortWindowQuota.mockResolvedValue(false);
    const { createMemorySharedState } = await import("../mcp-shared-state.server");
    const mcpPost = await replica(createMemorySharedState());

    const response = await post(mcpPost, deleteCall());
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ error: { code: -32003, message } });
    expect(mcpServerMocks.reserveDailyQuota).not.toHaveBeenCalled();
    expect(mcpServerMocks.recordCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: "rate_limited", error_message: expect.any(String) }),
    );
  });
});

describe("request source", () => {
  it("logs the proxy-observed client address, not spoofable headers", async () => {
    const { createMemorySharedState } = await import("../mcp-shared-state.server");
    const mcpPost = await replica(createMemorySharedState());
    mcpServerMocks.getMergedTools.mockResolvedValue([]);

    await post(
      mcpPost,
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      {
        "cf-connecting-ip": "9.9.9.9",
        "x-real-ip": "8.8.8.8",
        "x-forwarded-for": "1.1.1.1, 203.0.113.7",
      },
    );

    const { log } = await import("@/lib/logger.server");
    expect(log.info).toHaveBeenCalledWith(
      "mcp.gateway.request",
      expect.objectContaining({ method: "tools/list", ip: "203.0.113.7" }),
    );
  });
});
