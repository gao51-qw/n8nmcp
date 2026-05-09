import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Zap } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { useQuota } from "@/hooks/use-quota";
import { TIER_LABELS } from "@/lib/tiers";

function fmt(n: number) {
  return n.toLocaleString();
}

export function QuotaCard({ compact = false }: { compact?: boolean }) {
  const { data, isLoading } = useQuota();

  if (isLoading || !data) {
    return (
      <div className="rounded-xl border border-border bg-card p-5">
        <div className="text-sm text-muted-foreground">Loading quota…</div>
      </div>
    );
  }

  const warn = data.pct >= 80 && !data.exceeded;
  const over = data.exceeded;

  return (
    <div
      className={`rounded-xl border p-5 ${
        over
          ? "border-destructive/50 bg-destructive/5"
          : warn
            ? "border-amber-500/40 bg-amber-500/5"
            : "border-border bg-card"
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Zap className="h-4 w-4 text-primary" />
          Daily MCP quota
        </div>
        <Badge variant={data.tier === "free" ? "secondary" : "default"}>
          {TIER_LABELS[data.tier]}
        </Badge>
      </div>

      <div className="mt-3 flex items-baseline justify-between">
        <div className="text-2xl font-semibold">
          {fmt(data.used)} <span className="text-base font-normal text-muted-foreground">/ {fmt(data.limit)}</span>
        </div>
        <div className="text-xs text-muted-foreground">{data.pct}%</div>
      </div>

      <Progress value={data.pct} className="mt-3 h-2" />

      {!compact && (
        <div className="mt-3 text-xs text-muted-foreground">
          {fmt(data.remaining)} calls remaining today. Resets at midnight UTC.
        </div>
      )}

      {(warn || over) && (
        <div
          className={`mt-3 flex items-start gap-2 rounded-md p-3 text-xs ${
            over
              ? "bg-destructive/10 text-destructive"
              : "bg-amber-500/10 text-amber-700 dark:text-amber-300"
          }`}
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {over ? (
              <>
                You've hit today's limit. New MCP calls will return <code>429</code> until midnight UTC.{" "}
                <Link to="/billing" className="underline font-medium">
                  Upgrade to keep going →
                </Link>
              </>
            ) : (
              <>
                You've used {data.pct}% of today's quota.{" "}
                <Link to="/billing" className="underline font-medium">
                  Upgrade plan →
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
