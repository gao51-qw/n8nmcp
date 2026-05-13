import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Loader2, UserMinus } from "lucide-react";
import { adminProcessDeletionRequest } from "@/lib/admin-actions.functions";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/_admin/admin/deletion-requests")({
  head: () => ({ meta: [{ title: "Admin · Deletion Requests — n8n-mcp" }] }),
  component: DeletionRequests,
});

function DeletionRequests() {
  const qc = useQueryClient();
  const process = useServerFn(adminProcessDeletionRequest);
  const [busy, setBusy] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-deletion-requests"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_deletion_requests")
        .select("id, user_id, reason, requested_at, processed_at")
        .is("processed_at", null)
        .order("requested_at", { ascending: true });
      if (error) throw error;
      const ids = (data ?? []).map((r) => r.user_id);
      if (ids.length === 0) return [];
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, email, display_name")
        .in("id", ids);
      const m = new Map((profiles ?? []).map((p) => [p.id, p]));
      return (data ?? []).map((r) => ({ ...r, profile: m.get(r.user_id) }));
    },
    staleTime: 30_000,
  });

  const act = async (id: string, decision: "approve" | "dismiss") => {
    setBusy(id);
    try {
      await process({ data: { requestId: id, decision } });
      toast.success(decision === "approve" ? "Account deleted" : "Request dismissed");
      qc.invalidateQueries({ queryKey: ["admin-deletion-requests"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <UserMinus className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-3xl font-bold">Deletion requests</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            User-initiated GDPR deletion requests awaiting review.
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
                <TableHead>User</TableHead>
                <TableHead>Reason</TableHead>
                <TableHead>Requested</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(data ?? []).map((r) => (
                <TableRow key={r.id}>
                  <TableCell>
                    <div className="text-sm font-medium">{r.profile?.email ?? r.user_id}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.profile?.display_name ?? "—"}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-[280px] text-xs text-muted-foreground">
                    {r.reason || <Badge variant="outline">no reason</Badge>}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {new Date(r.requested_at).toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => act(r.id, "dismiss")}
                      >
                        Dismiss
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy !== null}
                        onClick={() => act(r.id, "approve")}
                      >
                        {busy === r.id ? "Working…" : "Approve & delete"}
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {data && data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="py-8 text-center text-sm text-muted-foreground">
                    No pending requests.
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