import { supabase } from "@/integrations/supabase/client";

type TicketSubscriptionHandlers = {
  onReply: () => void;
  onTicket: () => void;
  getLastSeenAt: () => string;
  onReconnect: (lastSeenAt: string) => void;
};

type TicketStatusPayload = {
  old?: { status?: unknown };
  new?: { status?: unknown };
};

export function subscribeToTicket(
  ticketId: string,
  handlers: TicketSubscriptionHandlers,
): () => void {
  let hasSubscribed = false;

  const channel = supabase
    .channel(`support-ticket:${ticketId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "support_ticket_replies",
        filter: `ticket_id=eq.${ticketId}`,
      },
      handlers.onReply,
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "support_tickets",
        filter: `id=eq.${ticketId}`,
      },
      (payload: TicketStatusPayload) => {
        if (payload.old?.status !== payload.new?.status) handlers.onTicket();
      },
    )
    .subscribe((status) => {
      if (status !== "SUBSCRIBED") return;

      if (hasSubscribed) {
        handlers.onReconnect(handlers.getLastSeenAt());
      }
      hasSubscribed = true;
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}

export function subscribeToAdminQueue(onInvalidate: () => void): () => void {
  const channel = supabase
    .channel("support-admin-queue")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "support_tickets",
      },
      onInvalidate,
    )
    .on(
      "postgres_changes",
      {
        event: "UPDATE",
        schema: "public",
        table: "support_tickets",
      },
      onInvalidate,
    )
    .subscribe();

  return () => {
    void supabase.removeChannel(channel);
  };
}
