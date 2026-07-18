import { beforeEach, describe, expect, it, vi } from "vitest";

const upstreamMocks = vi.hoisted(() => ({
  callUpstreamTool: vi.fn(async () => ({ valid: true })),
  categorize: vi.fn(() => "knowledge"),
  isManagementTool: vi.fn(() => false),
  isUpstreamConfigured: vi.fn(() => true),
  listUpstreamTools: vi.fn(async () => []),
}));

vi.mock("../mcp-upstream.server", () => upstreamMocks);

describe("dispatchTool contract", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    upstreamMocks.isUpstreamConfigured.mockReturnValue(true);
  });

  it("routes validate_workflow without requiring a configured n8n instance", async () => {
    const { dispatchTool } = await import("../mcp.server");
    const workflow = { name: "Draft", nodes: [], connections: {} };

    const result = await dispatchTool("validate_workflow", { workflow }, null, {
      user_id: "user-1",
      key_id: "key-1",
    });

    expect(upstreamMocks.callUpstreamTool).toHaveBeenCalledWith(
      "validate_workflow",
      { workflow },
      null,
      { source: "validate_workflow" },
    );
    expect(result).toEqual({
      output: { valid: true },
      upstream: false,
      category: "local",
      needsInstance: false,
    });
  });
});
