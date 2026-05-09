import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { QuotaCard } from "@/components/quota-card";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/usage")({
  head: () => ({ meta: [{ title: "Usage — n8n-mcp" }] }),
  component: Usage,
});

function Usage() {
  const { user } = useAuth();

  const { data: history } = useQuery({
    queryKey: ["usage-history", user?.id],
    enabled: !!user,
    queryFn: async () => {
      const since = new Date(Date.now() - 7 * 86400_000).toISOString().slice(0, 10);
      const { data } = await supabase
        .from("usage_daily")
        .select("day,mcp_calls")
        .gte("day", since)
        .order("day", { ascending: false });
      return data ?? [];
    },
  });

  const { data: recent } = useQuery({
    queryKey: ["recent-calls", user?.id],
    enabled: !!user,
    refetchInterval: 15_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("mcp_call_logs")
        .select("id,tool_name,status,latency_ms,error_message,created_at")
        .order("created_at", { ascending: false })
        .limit(20);
      return data ?? [];
    },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Usage</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Daily MCP call counts, quotas, and recent invocations.
        </p>
      </div>

      <QuotaCard />

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Last 7 days</h2>
        <div className="mt-3 space-y-2">
          {(history ?? []).length === 0 && (
            <div className="text-sm text-muted-foreground">No usage recorded yet.</div>
          )}
          {(history ?? []).map((d) => (
            <div key={d.day} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{d.day}</span>
              <span className="font-mono">{d.mcp_calls.toLocaleString()} calls</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="text-sm font-semibold">Recent calls</h2>
        <div className="mt-3 divide-y divide-border">
          {(recent ?? []).length === 0 && (
            <div className="py-2 text-sm text-muted-foreground">No calls yet.</div>
          )}
          {(recent ?? []).map((c) => (
            <div key={c.id} className="flex items-center justify-between py-2 text-sm">
              <div className="flex items-center gap-2">
                <Badge
                  variant={
                    c.status === "ok"
                      ? "default"
                      : c.status === "rate_limited"
                        ? "secondary"
                        : "destructive"
                  }
                >
                  {c.status}
                </Badge>
                <code className="text-xs">{c.tool_name ?? "—"}</code>
              </div>
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{c.latency_ms ?? 0}ms</span>
                <span>{new Date(c.created_at).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
