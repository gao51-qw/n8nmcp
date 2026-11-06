"use client";

// Today's MCP quota, the last two weeks of call volume and the most recent
// MCP calls, read from GET /api/dashboard/usage.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { BarChart3, Loader2, RefreshCw } from "lucide-react";
import { errorText } from "@/components/dashboard/error-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supportFetch } from "@/lib/support/http.client";
import type { DashboardUsage, UsageRecentCall } from "@/lib/usage.server";
import { cn } from "@/lib/utils";

const numberFormat = new Intl.NumberFormat();

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatDay(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }).format(date);
}

const STATUS_LABELS: Record<string, string> = {
  ok: "Succeeded",
  error: "Failed",
  rate_limited: "Rate limited",
  needs_instance: "No instance",
  input_required: "Input required",
  insufficient_scope: "Not permitted",
};

function StatusBadge({ status }: { status: string }) {
  const variant = status === "ok" ? "secondary" : status === "error" ? "destructive" : "outline";
  return <Badge variant={variant}>{STATUS_LABELS[status] ?? status}</Badge>;
}

function QuotaCard({ usage }: { usage: DashboardUsage }) {
  const percent = usage.unlimited
    ? 0
    : Math.min(100, Math.round((usage.used / Math.max(usage.limit, 1)) * 100));
  const exhausted = !usage.unlimited && usage.used >= usage.limit;
  return (
    <section
      aria-labelledby="quota-heading"
      className="mt-8 rounded-lg border border-border bg-card p-6"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="quota-heading" className="text-xl font-semibold">
          Today
        </h2>
        <Badge variant="outline">{usage.tierLabel} plan</Badge>
      </div>
      <p className="mt-4 text-3xl font-bold tabular-nums">
        {numberFormat.format(usage.used)}
        <span className="text-base font-normal text-muted-foreground">
          {usage.unlimited ? " MCP calls" : ` of ${numberFormat.format(usage.limit)} MCP calls`}
        </span>
      </p>
      {usage.unlimited ? (
        <p className="mt-3 text-sm text-muted-foreground">Your plan has no daily call limit.</p>
      ) : (
        <>
          <Progress
            value={percent}
            className={cn("mt-4 h-3", exhausted && "bg-destructive/20")}
            aria-label="Daily MCP calls used"
            aria-valuetext={`${percent}% of today's limit used`}
          />
          <p
            className={cn("mt-3 text-sm", exhausted ? "text-destructive" : "text-muted-foreground")}
          >
            {exhausted
              ? "You have reached today's limit. MCP calls are refused until it resets."
              : `${numberFormat.format(usage.remaining)} calls left today.`}{" "}
            The limit resets at {formatDateTime(usage.resetsAt)}.
          </p>
        </>
      )}
      {usage.tier === "free" ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Need more calls?{" "}
          <Link
            href="/dashboard/billing"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            Upgrade your plan
          </Link>
          .
        </p>
      ) : null}
    </section>
  );
}

function DailyChart({ days }: { days: DashboardUsage["daily"] }) {
  const max = Math.max(1, ...days.map((day) => day.calls));
  const first = days[0];
  const last = days[days.length - 1];
  return (
    <section
      aria-labelledby="daily-heading"
      className="mt-6 rounded-lg border border-border bg-card p-6"
    >
      <h2 id="daily-heading" className="text-xl font-semibold">
        Last {days.length} days
      </h2>
      <ol className="mt-6 flex h-32 items-end gap-1" aria-label="MCP calls per day">
        {days.map((day) => (
          <li
            key={day.day}
            className="flex h-full flex-1 flex-col justify-end"
            title={`${formatDay(day.day)}: ${numberFormat.format(day.calls)} calls`}
          >
            <span className="sr-only">
              {formatDay(day.day)}: {numberFormat.format(day.calls)} calls
            </span>
            <span
              aria-hidden="true"
              className="block w-full rounded-t bg-primary/70"
              style={{ height: `${day.calls === 0 ? 2 : Math.max(4, (day.calls / max) * 100)}%` }}
            />
          </li>
        ))}
      </ol>
      <div className="mt-2 flex justify-between text-xs text-muted-foreground" aria-hidden="true">
        <span>{first ? formatDay(first.day) : ""}</span>
        <span>{last ? formatDay(last.day) : ""}</span>
      </div>
    </section>
  );
}

function RecentCalls({ calls }: { calls: UsageRecentCall[] }) {
  return (
    <section
      aria-labelledby="recent-heading"
      className="mt-6 rounded-lg border border-border bg-card p-6"
    >
      <h2 id="recent-heading" className="text-xl font-semibold">
        Recent calls
      </h2>
      {calls.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No MCP calls yet. Connect an MCP client with an API key or through OAuth and its calls
          appear here.
        </p>
      ) : (
        <Table className="mt-4">
          <TableHeader>
            <TableRow>
              <TableHead>Tool</TableHead>
              <TableHead>Result</TableHead>
              <TableHead className="text-right">Time taken</TableHead>
              <TableHead>When</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {calls.map((call) => (
              <TableRow key={call.id}>
                <TableCell className="max-w-[16rem]">
                  <span className="block truncate font-mono text-xs">{call.tool_name ?? "—"}</span>
                  {call.error_message ? (
                    <span className="mt-1 block break-words text-xs text-destructive">
                      {call.error_message}
                    </span>
                  ) : null}
                </TableCell>
                <TableCell>
                  <StatusBadge status={call.status} />
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {call.latency_ms === null ? "—" : `${numberFormat.format(call.latency_ms)} ms`}
                </TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  {formatDateTime(call.created_at)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

export function UsageClient() {
  const [usage, setUsage] = useState<DashboardUsage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setRefreshing(true);
    try {
      const data = await supportFetch<{ usage: DashboardUsage }>("/api/dashboard/usage");
      setUsage(data.usage);
      setError(null);
    } catch (err) {
      setError(errorText(err, "Could not load your usage. Try again."));
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <main id="main" className="mx-auto max-w-4xl px-6 py-12 lg:py-16">
      <div className="flex items-center gap-3 text-primary">
        <BarChart3 className="h-6 w-6" aria-hidden="true" />
        <p className="text-sm font-medium">MCP</p>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold">Usage</h1>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void load()}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          ) : (
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          )}
          Refresh
        </Button>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Every tool call from your MCP clients counts towards your plan&apos;s daily limit.
      </p>

      {error ? (
        <p role="alert" className="mt-6 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {usage === null && !error ? (
        <div className="mt-10 flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          Loading...
        </div>
      ) : null}

      {usage ? (
        <>
          <QuotaCard usage={usage} />
          <DailyChart days={usage.daily} />
          <RecentCalls calls={usage.recentCalls} />
        </>
      ) : null}
    </main>
  );
}
