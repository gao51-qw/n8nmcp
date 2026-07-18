import { beforeEach, describe, expect, it, vi } from "vitest";

type PostgresChangeConfig = {
  event: "INSERT" | "UPDATE" | "*";
  schema: string;
  table: string;
  filter?: string;
};

const realtimeMocks = vi.hoisted(() => {
  const subscriptions: Array<{
    config: PostgresChangeConfig;
    callback: () => void;
  }> = [];
  const subscribeCallbacks: Array<(status: string) => void> = [];
  const channel = {
    on: vi.fn((_type: "postgres_changes", config: PostgresChangeConfig, callback: () => void) => {
      subscriptions.push({ config, callback });
      return channel;
    }),
    subscribe: vi.fn((callback?: (status: string) => void) => {
      if (callback) subscribeCallbacks.push(callback);
      return channel;
    }),
  };

  return {
    channel,
    channelFactory: vi.fn(() => channel),
    removeChannel: vi.fn(),
    subscribeCallbacks,
    subscriptions,
  };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    channel: realtimeMocks.channelFactory,
    removeChannel: realtimeMocks.removeChannel,
  },
}));

describe("support realtime subscriptions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    realtimeMocks.subscriptions.length = 0;
    realtimeMocks.subscribeCallbacks.length = 0;
  });

  it("subscribes to replies only for the opened ticket", async () => {
    const { subscribeToTicket } = await import("@/lib/support/realtime.client");

    subscribeToTicket("ticket-123", {
      onReply: vi.fn(),
      onTicket: vi.fn(),
      getLastSeenAt: vi.fn(() => "2026-06-11T08:00:00.000Z"),
      onReconnect: vi.fn(),
    });

    expect(realtimeMocks.subscriptions[0]?.config).toEqual({
      event: "INSERT",
      schema: "public",
      table: "support_ticket_replies",
      filter: "ticket_id=eq.ticket-123",
    });
  });

  it("subscribes to status updates only for the opened ticket", async () => {
    const { subscribeToTicket } = await import("@/lib/support/realtime.client");

    subscribeToTicket("ticket-456", {
      onReply: vi.fn(),
      onTicket: vi.fn(),
      getLastSeenAt: vi.fn(() => "2026-06-11T08:00:00.000Z"),
      onReconnect: vi.fn(),
    });

    expect(realtimeMocks.subscriptions[1]?.config).toEqual({
      event: "UPDATE",
      schema: "public",
      table: "support_tickets",
      filter: "id=eq.ticket-456",
    });
  });

  it("refreshes ticket detail only when the ticket status changes", async () => {
    const { subscribeToTicket } = await import("@/lib/support/realtime.client");
    const onTicket = vi.fn();

    subscribeToTicket("ticket-456", {
      onReply: vi.fn(),
      onTicket,
      getLastSeenAt: vi.fn(() => "2026-06-11T08:00:00.000Z"),
      onReconnect: vi.fn(),
    });

    const callback = realtimeMocks.subscriptions[1]?.callback as unknown as (payload: {
      old: { status: string };
      new: { status: string };
    }) => void;
    callback({ old: { status: "open" }, new: { status: "open" } });
    expect(onTicket).not.toHaveBeenCalled();

    callback({ old: { status: "open" }, new: { status: "waiting_user" } });
    expect(onTicket).toHaveBeenCalledOnce();
  });

  it("requests messages after the latest lastSeenAt when a channel reconnects", async () => {
    const { subscribeToTicket } = await import("@/lib/support/realtime.client");
    const onReconnect = vi.fn();
    let lastSeenAt = "2026-06-11T08:00:00.000Z";

    subscribeToTicket("ticket-123", {
      onReply: vi.fn(),
      onTicket: vi.fn(),
      getLastSeenAt: () => lastSeenAt,
      onReconnect,
    });

    const onStatus = realtimeMocks.subscribeCallbacks[0];
    onStatus?.("SUBSCRIBED");
    expect(onReconnect).not.toHaveBeenCalled();

    onStatus?.("CHANNEL_ERROR");
    lastSeenAt = "2026-06-11T08:05:00.000Z";
    onStatus?.("SUBSCRIBED");
    expect(onReconnect).toHaveBeenCalledWith("2026-06-11T08:05:00.000Z");
  });

  it("removes the ticket channel when unsubscribing", async () => {
    const { subscribeToTicket } = await import("@/lib/support/realtime.client");
    const unsubscribe = subscribeToTicket("ticket-123", {
      onReply: vi.fn(),
      onTicket: vi.fn(),
      getLastSeenAt: vi.fn(() => "2026-06-11T08:00:00.000Z"),
      onReconnect: vi.fn(),
    });

    unsubscribe();

    expect(realtimeMocks.removeChannel).toHaveBeenCalledWith(realtimeMocks.channel);
  });

  it("invalidates the admin queue for ticket inserts and updates", async () => {
    const { subscribeToAdminQueue } = await import("@/lib/support/realtime.client");
    const invalidate = vi.fn();

    const unsubscribe = subscribeToAdminQueue(invalidate);

    expect(realtimeMocks.subscriptions.map(({ config }) => config)).toEqual([
      {
        event: "INSERT",
        schema: "public",
        table: "support_tickets",
      },
      {
        event: "UPDATE",
        schema: "public",
        table: "support_tickets",
      },
    ]);

    realtimeMocks.subscriptions[0]?.callback();
    realtimeMocks.subscriptions[1]?.callback();
    expect(invalidate).toHaveBeenCalledTimes(2);

    unsubscribe();
    expect(realtimeMocks.removeChannel).toHaveBeenCalledWith(realtimeMocks.channel);
  });
});
