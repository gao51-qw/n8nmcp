import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Server, KeyRound, BarChart3, Sparkles } from "lucide-react";
import { QuotaCard } from "@/components/quota-card";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — n8n-mcp" }] }),
  component: Dashboard,
});

function StatCard({ icon: Icon, label, value }: { icon: any; label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Icon className="h-4 w-4" /> {label}
      </div>
      <div className="mt-2 text-3xl font-semibold">{value}</div>
    </div>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const [stats, setStats] = useState({ instances: 0, keys: 0, callsToday: 0 });

  useEffect(() => {
    if (!user) return;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [{ count: inst }, { count: keys }, { data: usage }] = await Promise.all([
        supabase.from("n8n_instances").select("id", { count: "exact", head: true }),
        supabase.from("platform_api_keys").select("id", { count: "exact", head: true }).is("revoked_at", null),
        supabase.from("usage_daily").select("mcp_calls").eq("day", today).maybeSingle(),
      ]);
      setStats({ instances: inst ?? 0, keys: keys ?? 0, callsToday: usage?.mcp_calls ?? 0 });
    })();
  }, [user]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={Server} label="n8n instances" value={stats.instances} />
        <StatCard icon={KeyRound} label="Active API keys" value={stats.keys} />
        <StatCard icon={BarChart3} label="MCP calls today" value={stats.callsToday} />
      </div>

      <div className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Sparkles className="h-4 w-4 text-primary" /> Quick start
        </div>
        <ol className="mt-3 space-y-2 text-sm text-muted-foreground">
          <li>1. Connect an n8n instance from the <strong>n8n Instances</strong> page.</li>
          <li>2. Create a platform API key from <strong>API Keys</strong>.</li>
          <li>3. Point your MCP client at <code className="rounded bg-muted px-1.5 py-0.5">/api/public/mcp</code>.</li>
        </ol>
      </div>
    </div>
  );
}
