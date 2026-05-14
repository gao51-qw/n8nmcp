import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Loader2, Plus, Trash2, TrendingUp, DollarSign, Users, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  getRevenueOverview,
  getRevenueTrend,
  listRevenueDetails,
  createManualRevenue,
  deleteManualRevenue,
} from "@/lib/admin-revenue.functions";

export const Route = createFileRoute("/_authenticated/_admin/admin/revenue")({
  head: () => ({ meta: [{ title: "Admin · Revenue — n8n-mcp" }] }),
  component: AdminRevenuePage,
});

function fmtMoney(cents: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function AdminRevenuePage() {
  const qc = useQueryClient();
  const fetchOverview = useServerFn(getRevenueOverview);
  const fetchTrend = useServerFn(getRevenueTrend);
  const fetchList = useServerFn(listRevenueDetails);
  const createFn = useServerFn(createManualRevenue);
  const deleteFn = useServerFn(deleteManualRevenue);

  const [trendMonths, setTrendMonths] = useState(12);
  const [tab, setTab] = useState<"all" | "subscription" | "manual">("all");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [dialogOpen, setDialogOpen] = useState(false);

  const overview = useQuery({
    queryKey: ["admin-revenue-overview"],
    queryFn: () => fetchOverview(),
  });

  const trend = useQuery({
    queryKey: ["admin-revenue-trend", trendMonths],
    queryFn: () => fetchTrend({ data: { months: trendMonths } }),
  });

  const list = useQuery({
    queryKey: ["admin-revenue-list", tab, page],
    queryFn: () => fetchList({ data: { type: tab, page, pageSize } }),
  });

  const createMut = useMutation({
    mutationFn: (input: Parameters<typeof createFn>[0]["data"]) =>
      createFn({ data: input }),
    onSuccess: () => {
      toast.success("Revenue entry added");
      setDialogOpen(false);
      qc.invalidateQueries({ queryKey: ["admin-revenue-overview"] });
      qc.invalidateQueries({ queryKey: ["admin-revenue-trend"] });
      qc.invalidateQueries({ queryKey: ["admin-revenue-list"] });
    },
    onError: (e) => toast.error((e as Error).message || "Failed"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin-revenue-overview"] });
      qc.invalidateQueries({ queryKey: ["admin-revenue-trend"] });
      qc.invalidateQueries({ queryKey: ["admin-revenue-list"] });
    },
    onError: (e) => toast.error((e as Error).message || "Failed"),
  });

  const o = overview.data;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Revenue</h1>
          <p className="text-sm text-muted-foreground">
            MRR, ARR, paying users and manual revenue records.
          </p>
        </div>
        <ManualRevenueDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSubmit={(v) => createMut.mutate(v)}
          submitting={createMut.isPending}
        />
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard
          label="MRR"
          value={o ? fmtMoney(o.mrrCents) : "—"}
          icon={<TrendingUp className="h-4 w-4" />}
          loading={overview.isLoading}
        />
        <StatCard
          label="ARR"
          value={o ? fmtMoney(o.arrCents) : "—"}
          icon={<TrendingUp className="h-4 w-4" />}
          loading={overview.isLoading}
        />
        <StatCard
          label="Total revenue"
          value={o ? fmtMoney(o.totalAllTimeCents) : "—"}
          hint={
            o
              ? `Subs ${fmtMoney(o.subsTotalCents)} · Manual ${fmtMoney(
                  o.manualTotalCents,
                )}`
              : undefined
          }
          icon={<DollarSign className="h-4 w-4" />}
          loading={overview.isLoading}
        />
        <StatCard
          label="Paying users"
          value={o ? String(o.payingUsers) : "—"}
          icon={<Users className="h-4 w-4" />}
          loading={overview.isLoading}
        />
        <StatCard
          label="ARPU"
          value={o ? fmtMoney(o.arpuCents) : "—"}
          icon={<BarChart3 className="h-4 w-4" />}
          loading={overview.isLoading}
        />
      </div>

      {/* Trend chart */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Revenue trend</CardTitle>
            <CardDescription>
              Subscription MRR contribution + manual entries, by month.
            </CardDescription>
          </div>
          <Select
            value={String(trendMonths)}
            onValueChange={(v) => setTrendMonths(Number(v))}
          >
            <SelectTrigger className="w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="6">Last 6 months</SelectItem>
              <SelectItem value="12">Last 12 months</SelectItem>
              <SelectItem value="24">Last 24 months</SelectItem>
            </SelectContent>
          </Select>
        </CardHeader>
        <CardContent>
          {trend.isLoading ? (
            <div className="flex h-72 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend.data ?? []}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="month" className="text-xs" />
                  <YAxis
                    className="text-xs"
                    tickFormatter={(v) => `$${(Number(v) / 100).toFixed(0)}`}
                  />
                  <Tooltip
                    formatter={(v: number) => fmtMoney(Number(v))}
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 8,
                    }}
                  />
                  <Legend />
                  <Bar
                    dataKey="subsCents"
                    name="Subscriptions"
                    stackId="r"
                    fill="hsl(var(--primary))"
                  />
                  <Bar
                    dataKey="manualCents"
                    name="Manual"
                    stackId="r"
                    fill="hsl(var(--accent))"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tier breakdown */}
      <Card>
        <CardHeader>
          <CardTitle>Breakdown by tier</CardTitle>
        </CardHeader>
        <CardContent>
          {overview.isLoading ? (
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          ) : (
            <div className="grid gap-3 sm:grid-cols-3">
              {(o?.byTier ?? []).map((t) => (
                <div
                  key={t.tier}
                  className="rounded-lg border bg-card p-4"
                >
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium capitalize">
                      {t.tier}
                    </span>
                    <Badge variant="secondary">{t.count} users</Badge>
                  </div>
                  <div className="mt-2 text-2xl font-semibold">
                    {fmtMoney(t.mrrCents)}
                    <span className="ml-1 text-xs font-normal text-muted-foreground">
                      / mo
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Detail table */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Details</CardTitle>
            <CardDescription>
              Active paid subscriptions and manual revenue entries.
            </CardDescription>
          </div>
          <Tabs
            value={tab}
            onValueChange={(v) => {
              setTab(v as typeof tab);
              setPage(1);
            }}
          >
            <TabsList>
              <TabsTrigger value="all">All</TabsTrigger>
              <TabsTrigger value="subscription">Subscriptions</TabsTrigger>
              <TabsTrigger value="manual">Manual</TabsTrigger>
            </TabsList>
          </Tabs>
        </CardHeader>
        <CardContent>
          {list.isLoading ? (
            <div className="flex h-32 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Source</TableHead>
                      <TableHead>User / Note</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="w-12" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(list.data?.items ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={6} className="text-center text-muted-foreground">
                          No records.
                        </TableCell>
                      </TableRow>
                    )}
                    {(list.data?.items ?? []).map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="text-xs text-muted-foreground">
                          {new Date(r.occurred_at).toLocaleDateString()}
                        </TableCell>
                        <TableCell>
                          <Badge variant={r.type === "manual" ? "default" : "secondary"}>
                            {r.type}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{r.source}</TableCell>
                        <TableCell className="max-w-[280px] truncate text-xs">
                          {r.user_email ?? r.description}
                        </TableCell>
                        <TableCell className="text-right font-mono">
                          {fmtMoney(r.amount_cents, r.currency)}
                        </TableCell>
                        <TableCell>
                          {r.type === "manual" && (
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={() => {
                                if (confirm("Delete this entry?")) {
                                  deleteMut.mutate(r.id.replace(/^manual:/, ""));
                                }
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {list.data?.total ?? 0} total ·
                  {" "}page {page} of {Math.max(1, Math.ceil((list.data?.total ?? 0) / pageSize))}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={
                      (list.data?.total ?? 0) <= page * pageSize
                    }
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  icon,
  loading,
}: {
  label: string;
  value: string;
  hint?: string;
  icon?: React.ReactNode;
  loading?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium text-muted-foreground">
          {label}
        </CardTitle>
        <span className="text-muted-foreground">{icon}</span>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">
          {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : value}
        </div>
        {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function ManualRevenueDialog({
  open,
  onOpenChange,
  onSubmit,
  submitting,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSubmit: (v: {
    amount_cents: number;
    currency: string;
    source: string;
    description: string;
    occurred_at: string;
  }) => void;
  submitting: boolean;
}) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [source, setSource] = useState("consulting");
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));

  function submit() {
    const n = Number(amount);
    if (!Number.isFinite(n) || n === 0) {
      toast.error("Enter a non-zero amount");
      return;
    }
    onSubmit({
      amount_cents: Math.round(n * 100),
      currency,
      source: source.trim() || "other",
      description,
      occurred_at: new Date(date).toISOString(),
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="mr-2 h-4 w-4" /> Add revenue
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add manual revenue</DialogTitle>
          <DialogDescription>
            Record income from channels outside Paddle (consulting, custom contracts, etc.).
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="amt">Amount</Label>
              <Input
                id="amt"
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="500"
              />
            </div>
            <div>
              <Label htmlFor="cur">Currency</Label>
              <Input
                id="cur"
                value={currency}
                onChange={(e) => setCurrency(e.target.value.toUpperCase())}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="src">Source</Label>
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger id="src">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="consulting">Consulting</SelectItem>
                  <SelectItem value="enterprise">Enterprise contract</SelectItem>
                  <SelectItem value="one-time">One-time</SelectItem>
                  <SelectItem value="refund">Refund (negative)</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="dt">Date</Label>
              <Input
                id="dt"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
          </div>
          <div>
            <Label htmlFor="desc">Description</Label>
            <Textarea
              id="desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Customer name, invoice ref, notes…"
              rows={3}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={submitting}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}