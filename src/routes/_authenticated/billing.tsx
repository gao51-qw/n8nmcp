import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  TIER_LIMITS,
  TIER_LABELS,
  TIER_PRICES,
  FEATURE_LABELS,
  type Tier,
  type Feature,
  tierOf,
} from "@/lib/tiers";
import { createBillingPortalSession, createCheckoutSession } from "@/lib/billing.functions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Check, X, CreditCard, Sparkles, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({ meta: [{ title: "Billing — n8n-mcp" }] }),
  component: BillingPage,
});

const ORDER: Tier[] = ["free", "pro", "enterprise"];
const FEATURES: Feature[] = ["mcp", "instances", "chat-agent", "audit-export", "priority-support"];

function fmt(n: number) {
  if (n === -1) return "Unlimited";
  return n.toLocaleString();
}

function BillingPage() {
  const sub = useQuery({
    queryKey: ["my-subscription"],
    queryFn: async () => {
      const { data } = await supabase.from("subscriptions").select("tier,status,current_period_end").maybeSingle();
      return data;
    },
  });

  const current = tierOf(sub.data?.tier);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
            <CreditCard className="h-7 w-7 text-primary" /> Billing
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Compare plans, see what's included, and pick the right tier for your workload.
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card px-4 py-3 text-sm">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Current plan</div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-base font-semibold">{TIER_LABELS[current]}</span>
            <Badge variant={current === "free" ? "secondary" : "default"}>
              {sub.data?.status ?? "active"}
            </Badge>
          </div>
          {sub.data?.current_period_end && (
            <div className="mt-0.5 text-xs text-muted-foreground">
              Renews {new Date(sub.data.current_period_end).toLocaleDateString()}
            </div>
          )}
        </div>
      </div>

      {/* Plan cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {ORDER.map((t) => {
          const isCurrent = t === current;
          const lim = TIER_LIMITS[t];
          const recommended = t === "pro";
          return (
            <div
              key={t}
              className={`relative rounded-xl border p-6 ${
                recommended ? "border-primary bg-card shadow-lg" : "border-border bg-card"
              }`}
            >
              {recommended && (
                <Badge className="absolute -top-2 right-4 bg-primary text-primary-foreground">
                  <Sparkles className="mr-1 h-3 w-3" /> Most popular
                </Badge>
              )}
              <div className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                {TIER_LABELS[t]}
              </div>
              <div className="mt-2 flex items-baseline gap-1">
                <span className="text-3xl font-bold">{TIER_PRICES[t]}</span>
                {t !== "enterprise" && <span className="text-sm text-muted-foreground">/mo</span>}
              </div>
              <ul className="mt-5 space-y-2 text-sm">
                <Row label="Daily prompts (Chat Agent)" value={fmt(lim.prompts_day)} />
                <Row label="Daily MCP calls" value={fmt(lim.calls_day)} />
                <Row label="Requests / minute" value={fmt(lim.rpm)} />
              </ul>
              <ul className="mt-4 space-y-1.5 text-sm">
                {FEATURES.map((f) => {
                  const has = lim.features.includes(f);
                  return (
                    <li key={f} className="flex items-center gap-2">
                      {has ? (
                        <Check className="h-4 w-4 shrink-0 text-primary" />
                      ) : (
                        <X className="h-4 w-4 shrink-0 text-muted-foreground/50" />
                      )}
                      <span className={has ? "" : "text-muted-foreground line-through"}>
                        {FEATURE_LABELS[f]}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-6">
                {isCurrent ? (
                  <Button variant="secondary" disabled className="w-full">
                    Current plan
                  </Button>
                ) : t === "enterprise" ? (
                  <Button variant="outline" className="w-full" asChild>
                    <a href="mailto:sales@n8n-mcp.dev?subject=Enterprise%20plan">Contact sales</a>
                  </Button>
                ) : (
                  <Button className="w-full" disabled>
                    Upgrade — coming soon
                  </Button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Comparison matrix */}
      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border p-4">
          <h2 className="text-lg font-semibold">Detailed comparison</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            All limits reset daily at 00:00 UTC. RPM = sliding 60-second window per API key.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30 text-left">
                <th className="px-4 py-3 font-medium">Capability</th>
                {ORDER.map((t) => (
                  <th key={t} className="px-4 py-3 font-medium">
                    {TIER_LABELS[t]}
                    {t === current && <Badge className="ml-2" variant="secondary">You</Badge>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <MatrixRow label="Daily Chat Agent prompts" render={(t) => fmt(TIER_LIMITS[t].prompts_day)} />
              <MatrixRow label="Daily MCP gateway calls" render={(t) => fmt(TIER_LIMITS[t].calls_day)} />
              <MatrixRow label="Requests per minute" render={(t) => fmt(TIER_LIMITS[t].rpm)} />
              <MatrixRow label="Concurrent n8n instances" render={() => "Unlimited"} />
              <MatrixRow label="API keys per account" render={() => "Unlimited"} />
              <MatrixRow label="MCP transports" render={() => "HTTP / SSE / WebSocket"} />
              {FEATURES.map((f) => (
                <MatrixRow
                  key={f}
                  label={FEATURE_LABELS[f]}
                  render={(t) =>
                    TIER_LIMITS[t].features.includes(f) ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : (
                      <X className="h-4 w-4 text-muted-foreground/40" />
                    )
                  }
                />
              ))}
              <MatrixRow label="Audit-log retention" render={(t) => (t === "free" ? "7 days" : t === "pro" ? "90 days" : "1 year")} />
              <MatrixRow label="SSO (SAML)" render={(t) => (t === "enterprise" ? <Check className="h-4 w-4 text-primary" /> : <X className="h-4 w-4 text-muted-foreground/40" />)} />
              <MatrixRow label="SLA" render={(t) => (t === "enterprise" ? "99.9% uptime" : "Best effort")} />
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-xl border border-dashed border-border bg-muted/20 p-5 text-sm text-muted-foreground">
        Need a custom plan, on-prem deployment or a higher RPM?{" "}
        <a className="text-primary underline" href="mailto:sales@n8n-mcp.dev">Talk to sales</a> — or check{" "}
        <Link to="/usage" className="text-primary underline">your current usage</Link> first.
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex items-center justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium text-foreground">{value}</span>
    </li>
  );
}

function MatrixRow({ label, render }: { label: string; render: (t: Tier) => React.ReactNode }) {
  return (
    <tr className="border-b border-border last:border-0">
      <td className="px-4 py-2.5 text-muted-foreground">{label}</td>
      {ORDER.map((t) => (
        <td key={t} className="px-4 py-2.5">
          {render(t)}
        </td>
      ))}
    </tr>
  );
}
