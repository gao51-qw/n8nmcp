import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercises the default (production) dependencies of the dashboard agent
// actions: checkQuota must reserve atomically and releaseQuota must refund.
const mcpMocks = vi.hoisted(() => ({
  assessRollback: vi.fn(),
  checkShortWindowQuota: vi.fn(),
  dispatchTool: vi.fn(),
  effectiveTier: vi.fn(() => "pro"),
  getDefaultInstance: vi.fn(),
  recordCall: vi.fn(),
  releaseDailyQuota: vi.fn(),
  reserveDailyQuota: vi.fn(),
}));

vi.mock("@/lib/mcp.server", () => mcpMocks);

vi.mock("@/integrations/supabase/client.server", () => {
  const maybeSingle = vi.fn(async () => ({
    data: { tier: "pro", status: "active" },
    error: null,
  }));
  const chain = { select: () => chain, eq: () => chain, maybeSingle };
  return { supabaseAdmin: { from: vi.fn(() => chain) } };
});

vi.mock("@/lib/workflow-agent/confirmation.server", () => ({
  ConfirmationRequiredError: class ConfirmationRequiredError extends Error {},
  createConfirmationService: () => ({ requireOrConsume: vi.fn(async () => undefined) }),
}));

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { executeDashboardAgentAction } from "../dashboard-actions.server";

const rollback = {
  action: "rollback" as const,
  auditLogId: "audit-1",
  confirmationToken: "mcp_confirm_valid",
};

describe("dashboard agent actions: default quota dependencies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mcpMocks.checkShortWindowQuota.mockResolvedValue(true);
    mcpMocks.reserveDailyQuota.mockResolvedValue({ ok: true, used: 1, limit: 5 });
    mcpMocks.releaseDailyQuota.mockResolvedValue(undefined);
    mcpMocks.getDefaultInstance.mockResolvedValue({ id: "instance-1" });
    mcpMocks.assessRollback.mockResolvedValue({
      ok: true,
      workflowId: "wf-1",
      concurrency: "unchanged",
    });
    mcpMocks.dispatchTool.mockResolvedValue({
      output: { success: true },
      upstream: false,
      category: "local",
      needsInstance: false,
    });
  });

  it("denies at the limit with 429 and the quota message, reserving nothing", async () => {
    mcpMocks.reserveDailyQuota.mockResolvedValue({ ok: false, used: 5, limit: 5 });

    await expect(
      executeDashboardAgentAction("user-1", rollback, { requestId: "request-1" }),
    ).rejects.toMatchObject({
      status: 429,
      code: "quota_exceeded",
      message: "Daily quota exceeded (5/5)",
    });
    expect(mcpMocks.reserveDailyQuota).toHaveBeenCalledExactlyOnceWith({
      user_id: "user-1",
      tier: "pro",
    });
    expect(mcpMocks.dispatchTool).not.toHaveBeenCalled();
    expect(mcpMocks.releaseDailyQuota).not.toHaveBeenCalled();
  });

  it("looks the subscription up once and passes the tier to both limiters", async () => {
    await executeDashboardAgentAction("user-1", rollback, { requestId: "request-1" });

    expect(supabaseAdmin.from).toHaveBeenCalledExactlyOnceWith("subscriptions");
    expect(mcpMocks.effectiveTier).toHaveBeenCalledExactlyOnceWith("pro", "active");
    expect(mcpMocks.checkShortWindowQuota).toHaveBeenCalledExactlyOnceWith("user-1", "pro");
    expect(mcpMocks.reserveDailyQuota).toHaveBeenCalledExactlyOnceWith({
      user_id: "user-1",
      tier: "pro",
    });
  });

  it("does not reserve when the short-window throttle denies the call", async () => {
    mcpMocks.checkShortWindowQuota.mockResolvedValue(false);

    await expect(
      executeDashboardAgentAction("user-1", rollback, { requestId: "request-1" }),
    ).rejects.toMatchObject({ status: 429, code: "rate_limited" });
    expect(mcpMocks.reserveDailyQuota).not.toHaveBeenCalled();
  });

  it("charges a dispatched action through its reservation only", async () => {
    await executeDashboardAgentAction("user-1", rollback, { requestId: "request-1" });

    expect(mcpMocks.reserveDailyQuota).toHaveBeenCalledTimes(1);
    expect(mcpMocks.releaseDailyQuota).not.toHaveBeenCalled();
    expect(mcpMocks.recordCall).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ status: "ok", usage: "reserved" }),
    );
  });

  it("refunds through releaseDailyQuota when no instance is configured", async () => {
    mcpMocks.getDefaultInstance.mockResolvedValue(null);

    await expect(
      executeDashboardAgentAction("user-1", rollback, { requestId: "request-1" }),
    ).rejects.toMatchObject({ status: 404, code: "instance_not_found" });
    expect(mcpMocks.releaseDailyQuota).toHaveBeenCalledExactlyOnceWith("user-1");
    expect(mcpMocks.dispatchTool).not.toHaveBeenCalled();
  });
});
