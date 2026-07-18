import { supabase } from "@/integrations/supabase/client";

export function subscribeToWorkflowAgentConsole(
  userId: string,
  handlers: { onInvalidate: () => void; onStatus: (status: string) => void },
): () => void {
  let subscribed = false;
  const filter = `user_id=eq.${userId}`;
  const channel = supabase
    .channel(`workflow-agent-console:${userId}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "mcp_call_logs", filter },
      handlers.onInvalidate,
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "workflow_audit_log", filter },
      handlers.onInvalidate,
    )
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "workflow_audit_log", filter },
      handlers.onInvalidate,
    )
    .subscribe((status) => {
      handlers.onStatus(status);
      if (status !== "SUBSCRIBED") return;
      if (subscribed) handlers.onInvalidate();
      subscribed = true;
    });

  return () => {
    void supabase.removeChannel(channel);
  };
}
