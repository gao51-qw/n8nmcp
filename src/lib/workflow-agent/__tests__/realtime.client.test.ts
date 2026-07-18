import { beforeEach, describe, expect, it, vi } from "vitest";

type Config = { event: "INSERT" | "UPDATE"; schema: string; table: string; filter: string };

const mocks = vi.hoisted(() => {
  const subscriptions: Array<{ config: Config; callback: () => void }> = [];
  const statusCallbacks: Array<(status: string) => void> = [];
  const channel = {
    on: vi.fn((_type: "postgres_changes", config: Config, callback: () => void) => {
      subscriptions.push({ config, callback });
      return channel;
    }),
    subscribe: vi.fn((callback: (status: string) => void) => {
      statusCallbacks.push(callback);
      return channel;
    }),
  };
  return {
    channel,
    channelFactory: vi.fn(() => channel),
    removeChannel: vi.fn(),
    subscriptions,
    statusCallbacks,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { channel: mocks.channelFactory, removeChannel: mocks.removeChannel },
}));

describe("workflow agent realtime subscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscriptions.length = 0;
    mocks.statusCallbacks.length = 0;
  });

  it("subscribes only to owner-scoped call and audit invalidations", async () => {
    const { subscribeToWorkflowAgentConsole } = await import("../realtime.client");
    subscribeToWorkflowAgentConsole("user-1", { onInvalidate: vi.fn(), onStatus: vi.fn() });

    expect(mocks.subscriptions.map(({ config }) => config)).toEqual([
      { event: "INSERT", schema: "public", table: "mcp_call_logs", filter: "user_id=eq.user-1" },
      {
        event: "INSERT",
        schema: "public",
        table: "workflow_audit_log",
        filter: "user_id=eq.user-1",
      },
      {
        event: "UPDATE",
        schema: "public",
        table: "workflow_audit_log",
        filter: "user_id=eq.user-1",
      },
    ]);
  });

  it("invalidates on records and reconnect, reports status, and cleans up", async () => {
    const { subscribeToWorkflowAgentConsole } = await import("../realtime.client");
    const onInvalidate = vi.fn();
    const onStatus = vi.fn();
    const unsubscribe = subscribeToWorkflowAgentConsole("user-1", { onInvalidate, onStatus });

    mocks.subscriptions.forEach(({ callback }) => callback());
    expect(onInvalidate).toHaveBeenCalledTimes(3);

    const status = mocks.statusCallbacks[0];
    status?.("SUBSCRIBED");
    status?.("CHANNEL_ERROR");
    status?.("SUBSCRIBED");
    expect(onStatus).toHaveBeenCalledWith("CHANNEL_ERROR");
    expect(onInvalidate).toHaveBeenCalledTimes(4);

    unsubscribe();
    expect(mocks.removeChannel).toHaveBeenCalledWith(mocks.channel);
  });
});
