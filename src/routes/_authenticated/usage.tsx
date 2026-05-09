import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { format, startOfMonth, subDays, subMonths } from "date-fns";
import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { QuotaCard } from "@/components/quota-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Download, FileSpreadsheet } from "lucide-react";

export const Route = createFileRoute("/_authenticated/usage")({
  head: () => ({ meta: [{ title: "Usage — n8n-mcp" }] }),
  component: Usage,
});

type Granularity = "day" | "month";

type Row = { period: string; mcp_calls: number; prompts: number };

function Usage() {
  const { user } = useAuth();

  const [granularity, setGranularity] = useState<Granularity>("day");
  const [from, setFrom] = useState<string>(
    format(subDays(new Date(), 29), "yyyy-MM-dd"),
  );
  const [to, setTo] = useState<string>(format(new Date(), "yyyy-MM-dd"));

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["usage-history", user?.id, from, to, granularity],
    enabled: !!user,
    queryFn: async () => {
      // For month view, expand the from to start of that month
      const fromQuery =
        granularity === "month"
          ? format(startOfMonth(new Date(from)), "yyyy-MM-dd")
          : from;

      const [mcp, prompts] = await Promise.all([
        supabase
          .from("usage_daily")
          .select("day,mcp_calls")
          .gte("day", fromQuery)
          .lte("day", to)
          .order("day", { ascending: false }),
        supabase
          .from("prompt_usage_daily")
          .select("day,prompts")
          .gte("day", fromQuery)
          .lte("day", to)
          .order("day", { ascending: false }),
      ]);

      const map = new Map<string, Row>();
      const keyOf = (d: string) =>
        granularity === "month" ? d.slice(0, 7) : d;

      (mcp.data ?? []).forEach((r) => {
        const k = keyOf(r.day);
        const cur = map.get(k) ?? { period: k, mcp_calls: 0, prompts: 0 };
        cur.mcp_calls += r.mcp_calls ?? 0;
        map.set(k, cur);
      });
      (prompts.data ?? []).forEach((r) => {
        const k = keyOf(r.day);
        const cur = map.get(k) ?? { period: k, mcp_calls: 0, prompts: 0 };
        cur.prompts += r.prompts ?? 0;
        map.set(k, cur);
      });

      return Array.from(map.values()).sort((a, b) =>
        a.period < b.period ? 1 : -1,
      );
    },
  });

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          mcp_calls: acc.mcp_calls + r.mcp_calls,
          prompts: acc.prompts + r.prompts,
        }),
        { mcp_calls: 0, prompts: 0 },
      ),
    [rows],
  );

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

  const exportRows = () =>
    rows.map((r) => ({
      [granularity === "month" ? "Month" : "Day"]: r.period,
      "MCP Calls": r.mcp_calls,
      Prompts: r.prompts,
    }));

  const downloadCSV = () => {
    const data = exportRows();
    if (data.length === 0) return;
    const headers = Object.keys(data[0]);
    const csv = [
      headers.join(","),
      ...data.map((r) =>
        headers
          .map((h) => JSON.stringify((r as Record<string, unknown>)[h] ?? ""))
          .join(","),
      ),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    triggerDownload(blob, `usage_${granularity}_${from}_${to}.csv`);
  };

  const downloadXLSX = () => {
    const data = exportRows();
    if (data.length === 0) return;
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Usage");
    XLSX.writeFile(wb, `usage_${granularity}_${from}_${to}.xlsx`);
  };

  const setPreset = (p: "7d" | "30d" | "90d" | "12m") => {
    const today = new Date();
    if (p === "12m") {
      setGranularity("month");
      setFrom(format(startOfMonth(subMonths(today, 11)), "yyyy-MM-dd"));
      setTo(format(today, "yyyy-MM-dd"));
      return;
    }
    setGranularity("day");
    const days = p === "7d" ? 6 : p === "30d" ? 29 : 89;
    setFrom(format(subDays(today, days), "yyyy-MM-dd"));
    setTo(format(today, "yyyy-MM-dd"));
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold">Usage</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Query and export your MCP calls and prompt usage by day or month.
        </p>
      </div>

      <QuotaCard />

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Granularity</Label>
            <Select
              value={granularity}
              onValueChange={(v) => setGranularity(v as Granularity)}
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="day">Day</SelectItem>
                <SelectItem value="month">Month</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="w-44"
            />
          </div>
          <div className="flex flex-wrap gap-1">
            <Button size="sm" variant="outline" onClick={() => setPreset("7d")}>
              7d
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreset("30d")}>
              30d
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreset("90d")}>
              90d
            </Button>
            <Button size="sm" variant="outline" onClick={() => setPreset("12m")}>
              12m
            </Button>
          </div>
          <div className="ml-auto flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={downloadCSV}
              disabled={rows.length === 0}
            >
              <Download className="mr-1 h-4 w-4" /> CSV
            </Button>
            <Button
              size="sm"
              onClick={downloadXLSX}
              disabled={rows.length === 0}
            >
              <FileSpreadsheet className="mr-1 h-4 w-4" /> XLSX
            </Button>
          </div>
        </div>

        <div className="mt-5 overflow-hidden rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">
                  {granularity === "month" ? "Month" : "Day"}
                </th>
                <th className="px-3 py-2 text-right">MCP Calls</th>
                <th className="px-3 py-2 text-right">Prompts</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                    Loading…
                  </td>
                </tr>
              )}
              {!isLoading && rows.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-muted-foreground">
                    No usage in this range.
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.period}>
                  <td className="px-3 py-2 font-mono text-xs">{r.period}</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.mcp_calls.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {r.prompts.toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="bg-muted/30 font-medium">
                <tr>
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right font-mono">
                    {totals.mcp_calls.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {totals.prompts.toLocaleString()}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
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

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
