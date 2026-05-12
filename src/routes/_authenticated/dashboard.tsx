import { createFileRoute } from "@tanstack/react-router";
import { Link } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Server, KeyRound, BarChart3, Sparkles, Check, Mail, Plug, MessagesSquare, ArrowRight, X } from "lucide-react";
import { QuotaCard } from "@/components/quota-card";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

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
  const [hasUsage, setHasUsage] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [checklistDismissed, setChecklistDismissed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setBannerDismissed(localStorage.getItem("dismissed-welcome-banner") === "1");
    setChecklistDismissed(localStorage.getItem("dismissed-onboarding") === "1");
  }, []);

  useEffect(() => {
    if (!user) return;
    (async () => {
      const today = new Date().toISOString().slice(0, 10);
      const [{ count: inst }, { count: keys }, { data: usage }, { count: anyUsage }] = await Promise.all([
        supabase.from("n8n_instances").select("id", { count: "exact", head: true }),
        supabase.from("platform_api_keys").select("id", { count: "exact", head: true }).is("revoked_at", null),
        supabase.from("usage_daily").select("mcp_calls").eq("day", today).maybeSingle(),
        supabase.from("usage_daily").select("day", { count: "exact", head: true }),
      ]);
      setStats({ instances: inst ?? 0, keys: keys ?? 0, callsToday: usage?.mcp_calls ?? 0 });
      setHasUsage((anyUsage ?? 0) > 0);
    })();
  }, [user]);

  const steps = [
    { id: "verify", label: "Verify your email", done: !!user?.email_confirmed_at, to: "/settings" as const },
    { id: "instance", label: "Add your first n8n instance", done: stats.instances > 0, to: "/instances" as const },
    { id: "key", label: "Create a platform API key", done: stats.keys > 0, to: "/api-keys" as const },
    { id: "call", label: "Make your first MCP call", done: hasUsage || stats.callsToday > 0, to: "/connect" as const },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const allDone = doneCount === steps.length;

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Welcome back</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user?.email}</p>
      </div>

      {!bannerDismissed && (
        <div className="flex items-start justify-between gap-3 rounded-lg border border-primary/30 bg-primary/5 p-4 text-sm">
          <div className="flex items-start gap-3">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <div>
              <div className="font-medium">Welcome to n8n-mcp 👋</div>
              <div className="mt-0.5 text-muted-foreground">
                Connect any n8n instance and call your workflows from Claude, Cursor, ChatGPT and more.
              </div>
            </div>
          </div>
          <button
            type="button"
            aria-label="Dismiss"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => {
              localStorage.setItem("dismissed-welcome-banner", "1");
              setBannerDismissed(true);
            }}
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {!allDone && !checklistDismissed && (
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold">Resume setup</div>
              <div className="text-xs text-muted-foreground">
                {doneCount} of {steps.length} steps complete
              </div>
            </div>
            <button
              type="button"
              aria-label="Hide checklist"
              className="text-xs text-muted-foreground hover:text-foreground"
              onClick={() => {
                localStorage.setItem("dismissed-onboarding", "1");
                setChecklistDismissed(true);
              }}
            >
              Hide
            </button>
          </div>
          <Progress value={(doneCount / steps.length) * 100} className="mt-3" />
          <ul className="mt-4 space-y-2">
            {steps.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
                <div className="flex items-center gap-3">
                  <span
                    className={`grid h-5 w-5 place-items-center rounded-full border ${
                      s.done ? "border-primary bg-primary text-primary-foreground" : "border-border"
                    }`}
                  >
                    {s.done && <Check className="h-3 w-3" />}
                  </span>
                  <span className={`text-sm ${s.done ? "text-muted-foreground line-through" : ""}`}>{s.label}</span>
                </div>
                {!s.done && (
                  <Button asChild size="sm" variant="ghost">
                    <Link to={s.to}>
                      Go <ArrowRight className="ml-1 h-3 w-3" />
                    </Link>
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <StatCard icon={Server} label="n8n instances" value={stats.instances} />
        <StatCard icon={KeyRound} label="Active API keys" value={stats.keys} />
        <StatCard icon={BarChart3} label="MCP calls today" value={stats.callsToday} />
      </div>

      <QuotaCard />

      <div className="grid gap-4 md:grid-cols-2">
        <Link
          to="/connect"
          className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Plug className="h-4 w-4 text-primary" /> MCP Server
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Plug your n8n workflows into Claude, Cursor, ChatGPT and 20+ other clients.
          </p>
          <div className="mt-3 inline-flex items-center text-xs font-medium text-primary group-hover:underline">
            Connect a client <ArrowRight className="ml-1 h-3 w-3" />
          </div>
        </Link>
        <Link
          to="/chat"
          className="group rounded-xl border border-border bg-card p-5 transition-colors hover:border-primary/50"
        >
          <div className="flex items-center gap-2 text-sm font-semibold">
            <MessagesSquare className="h-4 w-4 text-primary" /> Chat Agent
            <Badge variant="secondary" className="ml-1 text-[10px]">Beta</Badge>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Generate and edit n8n workflows with an AI assistant that knows every node.
          </p>
          <div className="mt-3 inline-flex items-center text-xs font-medium text-primary group-hover:underline">
            Open Chat Agent <ArrowRight className="ml-1 h-3 w-3" />
          </div>
        </Link>
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
