import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, Users } from "lucide-react";
import { TIER_LABELS, type Tier } from "@/lib/tiers";

export const Route = createFileRoute("/_authenticated/_admin/admin/users")({
  head: () => ({ meta: [{ title: "Admin · Users — n8n-mcp" }] }),
  component: AdminUsers,
});

type Row = {
  id: string;
  email: string | null;
  display_name: string | null;
  created_at: string;
  tier: Tier;
  callsToday: number;
  instances: number;
};

function AdminUsers() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async (): Promise<Row[]> => {
      const today = new Date().toISOString().slice(0, 10);
      const [{ data: profiles }, { data: subs }, { data: usage }, { data: insts }] =
        await Promise.all([
          supabase.from("profiles").select("*").order("created_at", { ascending: false }),
          supabase.from("subscriptions").select("user_id, tier"),
          supabase.from("usage_daily").select("user_id, mcp_calls").eq("day", today),
          supabase.from("n8n_instances").select("user_id"),
        ]);

      const tierMap = new Map((subs ?? []).map((s) => [s.user_id, s.tier as Tier]));
      const usageMap = new Map((usage ?? []).map((u) => [u.user_id, u.mcp_calls]));
      const instMap = new Map<string, number>();
      (insts ?? []).forEach((i) => instMap.set(i.user_id, (instMap.get(i.user_id) ?? 0) + 1));

      return (profiles ?? []).map((p) => ({
        id: p.id,
        email: p.email,
        display_name: p.display_name,
        created_at: p.created_at,
        tier: tierMap.get(p.id) ?? "free",
        callsToday: usageMap.get(p.id) ?? 0,
        instances: instMap.get(p.id) ?? 0,
      }));
    },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-3xl font-bold">Users</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All registered accounts with current tier, today's usage, and connected instances.
          </p>
        </div>
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
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Tier</TableHead>
                <TableHead className="text-right">Calls today</TableHead>
                <TableHead className="text-right">Instances</TableHead>
                <TableHead>Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((u) => (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>{u.display_name ?? "—"}</TableCell>
                  <TableCell>
                    <Badge variant={u.tier === "free" ? "secondary" : "default"}>
                      {TIER_LABELS[u.tier]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{u.callsToday}</TableCell>
                  <TableCell className="text-right tabular-nums">{u.instances}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(u.created_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
              {data && data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No users yet.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  );
}
