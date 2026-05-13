import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Users, Download, Search } from "lucide-react";
import { TIER_LABELS, type Tier } from "@/lib/tiers";
import { adminListUsers, adminGetUserDetail } from "@/lib/admin-users.functions";
import {
  adminSetTier,
  adminGrantAdmin,
  adminRevokeAdmin,
  adminBanUser,
  adminResetPassword,
  adminForceSignOut,
  adminDeleteUser,
  adminUpsertNote,
} from "@/lib/admin-actions.functions";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/_admin/admin/users")({
  head: () => ({ meta: [{ title: "Admin · Users — n8n-mcp" }] }),
  component: AdminUsers,
});

function AdminUsers() {
  const list = useServerFn(adminListUsers);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [sort, setSort] = useState<"created_desc" | "created_asc" | "calls_desc">("created_desc");
  const [page, setPage] = useState(1);
  const pageSize = 25;
  const [selected, setSelected] = useState<string | null>(null);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["admin-users", search, sort, page],
    queryFn: () => list({ data: { search: search || undefined, sort, page, pageSize } }),
    staleTime: 30_000,
  });

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const exportCsv = async () => {
    const all = await list({
      data: { search: search || undefined, sort, page: 1, pageSize: 100 },
    });
    const header = ["id", "email", "display_name", "tier", "is_admin", "banned", "calls_today", "instances", "tags", "created_at"];
    const lines = [header.join(",")];
    for (const r of all.rows) {
      lines.push(
        [
          r.id,
          csv(r.email ?? ""),
          csv(r.display_name ?? ""),
          r.tier,
          r.isAdmin ? "yes" : "no",
          r.banned ? "yes" : "no",
          r.callsToday,
          r.instances,
          csv(r.tags.join("|")),
          r.created_at,
        ].join(","),
      );
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `users-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Users className="h-6 w-6 text-primary" />
          <div>
            <h1 className="text-3xl font-bold">Users</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {total} total accounts. Click a row to manage.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv}>
          <Download className="mr-2 h-4 w-4" /> Export CSV
        </Button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setSearch(searchInput.trim());
            setPage(1);
          }}
          className="relative flex-1 min-w-[240px]"
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search email or name…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </form>
        <Select value={sort} onValueChange={(v) => { setSort(v as typeof sort); setPage(1); }}>
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="created_desc">Newest first</SelectItem>
            <SelectItem value="created_asc">Oldest first</SelectItem>
            <SelectItem value="calls_desc">Most calls today</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="overflow-hidden rounded-xl border border-border bg-card">
        {isLoading ? (
          <div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>User</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Calls today</TableHead>
                <TableHead className="text-right">Instances</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data?.rows ?? []).map((u) => (
                <TableRow
                  key={u.id}
                  className="cursor-pointer"
                  onClick={() => setSelected(u.id)}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        {u.avatar_url && <AvatarImage src={u.avatar_url} />}
                        <AvatarFallback>
                          {(u.email ?? "?").charAt(0).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{u.email}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {u.display_name ?? "—"}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={u.tier === "free" ? "secondary" : "default"}>
                      {TIER_LABELS[u.tier as Tier]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.isAdmin && <Badge variant="outline">admin</Badge>}
                      {u.banned && <Badge variant="destructive">banned</Badge>}
                      {u.tags.slice(0, 3).map((t) => (
                        <Badge key={t} variant="outline" className="bg-muted/50 text-xs">
                          {t}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{u.callsToday}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.instances}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
              {data && data.rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No users match.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>
          Page {page} of {totalPages} {isFetching && "·"}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </Button>
        </div>
      </div>

      <UserDetailDrawer userId={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function csv(s: string) {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function UserDetailDrawer({ userId, onClose }: { userId: string | null; onClose: () => void }) {
  const qc = useQueryClient();
  const get = useServerFn(adminGetUserDetail);
  const setTier = useServerFn(adminSetTier);
  const grant = useServerFn(adminGrantAdmin);
  const revoke = useServerFn(adminRevokeAdmin);
  const ban = useServerFn(adminBanUser);
  const reset = useServerFn(adminResetPassword);
  const force = useServerFn(adminForceSignOut);
  const del = useServerFn(adminDeleteUser);
  const upsertNote = useServerFn(adminUpsertNote);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-user-detail", userId],
    enabled: !!userId,
    queryFn: () => get({ data: { userId: userId! } }),
    staleTime: 10_000,
  });

  const [busy, setBusy] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [tagsText, setTagsText] = useState("");

  useMemo(() => {
    if (data?.note) {
      setNoteText(data.note.note ?? "");
      setTagsText((data.note.tags ?? []).join(", "));
    } else {
      setNoteText("");
      setTagsText("");
    }
  }, [data?.note]);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["admin-user-detail", userId] });
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  };

  const action = async (label: string, fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const isBanned = !!data?.bannedUntil && new Date(data.bannedUntil).getTime() > Date.now();

  return (
    <Sheet open={!!userId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{data?.profile?.email ?? "User"}</SheetTitle>
          <SheetDescription>{data?.profile?.display_name ?? "—"}</SheetDescription>
        </SheetHeader>
        {!userId || isLoading || !data ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="mt-6 space-y-6">
            <Tabs defaultValue="overview">
              <TabsList>
                <TabsTrigger value="overview">Overview</TabsTrigger>
                <TabsTrigger value="activity">Activity</TabsTrigger>
                <TabsTrigger value="notes">Notes</TabsTrigger>
                <TabsTrigger value="audit">Audit</TabsTrigger>
              </TabsList>
              <TabsContent value="overview" className="space-y-3 pt-3 text-sm">
                <Field label="User ID" value={data.profile?.id ?? userId} mono />
                <Field label="Tier" value={(data.subscription?.tier as string) ?? "free"} />
                <Field
                  label="Subscription status"
                  value={(data.subscription?.status as string) ?? "—"}
                />
                <Field
                  label="Banned until"
                  value={data.bannedUntil ? new Date(data.bannedUntil).toLocaleString() : "—"}
                />
                <Field label="Joined" value={new Date(data.profile?.created_at ?? 0).toLocaleString()} />
                <div>
                  <div className="text-xs text-muted-foreground">Instances ({data.instances.length})</div>
                  <ul className="mt-1 space-y-1 text-xs">
                    {data.instances.map((i) => (
                      <li key={i.id} className="flex justify-between gap-2">
                        <span className="truncate">{i.name}</span>
                        <span className="text-muted-foreground">{i.status}</span>
                      </li>
                    ))}
                    {data.instances.length === 0 && <li className="text-muted-foreground">None</li>}
                  </ul>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">API keys ({data.apiKeys.length})</div>
                  <ul className="mt-1 space-y-1 text-xs">
                    {data.apiKeys.map((k) => (
                      <li key={k.id} className="flex justify-between gap-2">
                        <span className="truncate">{k.name} ({k.key_prefix}…)</span>
                        <span className="text-muted-foreground">{k.revoked_at ? "revoked" : "active"}</span>
                      </li>
                    ))}
                    {data.apiKeys.length === 0 && <li className="text-muted-foreground">None</li>}
                  </ul>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">
                    Calls (last 30 days): {data.usage.reduce((a, b) => a + (b.mcp_calls ?? 0), 0)}
                  </div>
                </div>
              </TabsContent>
              <TabsContent value="activity" className="space-y-2 pt-3">
                <ul className="divide-y divide-border text-xs">
                  {data.recentLogs.map((l) => (
                    <li key={l.id} className="flex items-start justify-between gap-2 py-2">
                      <div className="min-w-0">
                        <div className="truncate font-medium">{l.tool_name ?? "—"}</div>
                        <div className="text-muted-foreground">
                          {new Date(l.created_at).toLocaleString()} · {l.latency_ms ?? "?"}ms
                        </div>
                        {l.error_message && <div className="text-destructive">{l.error_message}</div>}
                      </div>
                      <Badge variant={l.status === "ok" ? "secondary" : "destructive"}>
                        {l.status}
                      </Badge>
                    </li>
                  ))}
                  {data.recentLogs.length === 0 && (
                    <li className="py-4 text-muted-foreground">No activity recorded.</li>
                  )}
                </ul>
              </TabsContent>
              <TabsContent value="notes" className="space-y-3 pt-3">
                <div>
                  <label className="text-xs text-muted-foreground">Note (admin-only)</label>
                  <Textarea
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    rows={4}
                    maxLength={4000}
                    placeholder="Internal notes about this user…"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Tags (comma-separated)</label>
                  <Input
                    value={tagsText}
                    onChange={(e) => setTagsText(e.target.value)}
                    placeholder="vip, abuse, support-priority"
                  />
                </div>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    action("Note saved", () =>
                      upsertNote({
                        data: {
                          userId: userId!,
                          note: noteText,
                          tags: tagsText
                            .split(",")
                            .map((t) => t.trim().toLowerCase())
                            .filter(Boolean),
                        },
                      }),
                    )
                  }
                >
                  Save note
                </Button>
              </TabsContent>
              <TabsContent value="audit" className="pt-3">
                <ul className="divide-y divide-border text-xs">
                  {data.audit.map((a) => (
                    <li key={a.id} className="py-2">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{a.action}</span>
                        <span className="text-muted-foreground">
                          {new Date(a.created_at).toLocaleString()}
                        </span>
                      </div>
                      {a.summary && <div className="text-muted-foreground">{a.summary}</div>}
                    </li>
                  ))}
                  {data.audit.length === 0 && (
                    <li className="py-4 text-muted-foreground">No audit entries.</li>
                  )}
                </ul>
              </TabsContent>
            </Tabs>

            <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-4">
              <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Admin actions
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Select
                  value={(data.subscription?.tier as Tier) ?? "free"}
                  onValueChange={(v) =>
                    action(`Tier set to ${v}`, () =>
                      setTier({ data: { userId: userId!, tier: v as Tier } }),
                    )
                  }
                  disabled={busy}
                >
                  <SelectTrigger className="w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["free", "pro", "enterprise"] as const).map((t) => (
                      <SelectItem key={t} value={t}>{TIER_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    action("Password reset email sent", () => reset({ data: { userId: userId! } }))
                  }
                >
                  Send password reset
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    action("All sessions revoked", () => force({ data: { userId: userId! } }))
                  }
                >
                  Force sign out
                </Button>
                {isBanned ? (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      action("User unbanned", () =>
                        ban({ data: { userId: userId!, durationHours: null } }),
                      )
                    }
                  >
                    Unban
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      action("User banned for 1 year", () =>
                        ban({ data: { userId: userId!, durationHours: 8760 } }),
                      )
                    }
                  >
                    Ban (1y)
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    action("Admin role granted", () => grant({ data: { userId: userId! } }))
                  }
                >
                  Grant admin
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    action("Admin role revoked", () => revoke({ data: { userId: userId! } }))
                  }
                >
                  Revoke admin
                </Button>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={busy}>
                      Delete account
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete this user?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Permanently removes the auth user, instances, API keys and chat. This cannot
                        be undone.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          void action("User deleted", () =>
                            del({ data: { userId: userId! } }),
                          ).then(onClose);
                        }}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Delete permanently
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={mono ? "font-mono text-xs" : "text-xs"}>{value}</span>
    </div>
  );
}