import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { toast } from "sonner";
import {
  adminListTickets,
  adminUpdateTicket,
  adminDeleteTicket,
} from "@/lib/admin-tickets.functions";
import {
  getTicket,
  replyToTicket,
  type TicketAttachment,
  type TicketStatus,
  type TicketPriority,
} from "@/lib/tickets.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Loader2, Search, MessageSquare, Send, Trash2 } from "lucide-react";
import { AttachmentUpload } from "@/components/tickets/attachment-upload";
import { AttachmentList } from "@/components/tickets/attachment-list";

export const Route = createFileRoute("/_authenticated/_admin/admin/tickets")({
  head: () => ({ meta: [{ title: "Admin · Tickets — n8n-mcp" }] }),
  validateSearch: (s) => z.object({ id: z.string().uuid().optional() }).parse(s),
  component: AdminTicketsPage,
});

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_user: "Waiting on user",
  resolved: "Resolved",
  closed: "Closed",
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "Low",
  normal: "Normal",
  high: "High",
  urgent: "Urgent",
};

function AdminTicketsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const fetchList = useServerFn(adminListTickets);
  const [statusFilter, setStatusFilter] = useState<"all" | TicketStatus>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["admin", "tickets", statusFilter, searchTerm],
    queryFn: () => fetchList({ data: { status: statusFilter, search: searchTerm || undefined } }),
  });

  return (
    <>
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Ticket management</h1>
        <p className="mt-2 text-muted-foreground">View and reply to tickets submitted by users.</p>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search by title..."
            className="w-64 pl-8"
          />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((k) => (
              <SelectItem key={k} value={k}>{STATUS_LABEL[k]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Title</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Priority</TableHead>
                <TableHead className="text-center">Replies</TableHead>
                <TableHead>Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(tickets ?? []).length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-sm text-muted-foreground">
                    No tickets
                  </TableCell>
                </TableRow>
              ) : (
                (tickets ?? []).map((t) => (
                  <TableRow
                    key={t.id}
                    className="cursor-pointer"
                    onClick={() => navigate({ search: { id: t.id } })}
                  >
                    <TableCell className="max-w-xs truncate font-medium">{t.title}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {t.user_name ?? t.user_email ?? t.user_id.slice(0, 8)}
                    </TableCell>
                    <TableCell><Badge variant="outline">{STATUS_LABEL[t.status]}</Badge></TableCell>
                    <TableCell>
                      <Badge variant={t.priority === "urgent" || t.priority === "high" ? "destructive" : "secondary"}>
                        {PRIORITY_LABEL[t.priority]}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center text-xs">
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <MessageSquare className="h-3 w-3" /> {t.reply_count}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {new Date(t.last_reply_at).toLocaleString()}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      <AdminTicketSheet
        ticketId={search.id ?? null}
        onClose={() => navigate({ search: {} })}
      />
    </>
  );
}

function AdminTicketSheet({
  ticketId,
  onClose,
}: {
  ticketId: string | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const fetchTicket = useServerFn(getTicket);
  const sendReply = useServerFn(replyToTicket);
  const updateTicket = useServerFn(adminUpdateTicket);
  const deleteTicket = useServerFn(adminDeleteTicket);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["admin", "ticket-detail", ticketId],
    queryFn: () => fetchTicket({ data: { id: ticketId! } }),
    enabled: !!ticketId,
  });

  const reply = useMutation({
    mutationFn: () => sendReply({ data: { ticket_id: ticketId!, body, attachments } }),
    onSuccess: () => {
      setBody("");
      setAttachments([]);
      qc.invalidateQueries({ queryKey: ["admin", "ticket-detail", ticketId] });
      qc.invalidateQueries({ queryKey: ["admin", "tickets"] });
      toast.success("Sent");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Failed to send"),
  });

  const update = useMutation({
    mutationFn: (patch: { status?: TicketStatus; priority?: TicketPriority }) =>
      updateTicket({ data: { id: ticketId!, ...patch } }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "ticket-detail", ticketId] });
      qc.invalidateQueries({ queryKey: ["admin", "tickets"] });
    },
  });

  const del = useMutation({
    mutationFn: () => deleteTicket({ data: { id: ticketId! } }),
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin", "tickets"] });
      onClose();
    },
  });

  return (
    <Sheet open={!!ticketId} onOpenChange={(o) => { if (!o) onClose(); }}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-2xl">
        {isLoading || !data ? (
          <div className="flex h-48 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <SheetHeader>
              <SheetTitle className="text-left">{data.ticket.title}</SheetTitle>
              <SheetDescription className="text-left text-xs">
                From {data.owner?.name ?? data.ticket.user_id} · Created{" "}
                {new Date(data.ticket.created_at).toLocaleString()}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Status</label>
                <Select
                  value={data.ticket.status}
                  onValueChange={(v) => update.mutate({ status: v as TicketStatus })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STATUS_LABEL) as TicketStatus[]).map((k) => (
                      <SelectItem key={k} value={k}>{STATUS_LABEL[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Priority</label>
                <Select
                  value={data.ticket.priority}
                  onValueChange={(v) => update.mutate({ priority: v as TicketPriority })}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map((k) => (
                      <SelectItem key={k} value={k}>{PRIORITY_LABEL[k]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-xs font-medium text-muted-foreground">
                  {data.owner?.name ?? "User"}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm">
                  {data.ticket.description}
                </div>
                <AttachmentList ticketId={data.ticket.id} attachments={data.ticket.attachments} />
              </div>

              {data.replies.map((r) => (
                <div
                  key={r.id}
                  className={`rounded-lg border p-3 ${
                    r.is_admin ? "border-primary/40 bg-primary/5" : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span className="font-medium">
                      {r.is_admin ? "Support Team" : r.author_name ?? "User"}
                    </span>
                    <span>{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                  <div className="mt-1 whitespace-pre-wrap text-sm">{r.body}</div>
                  <AttachmentList ticketId={data.ticket.id} attachments={r.attachments} />
                </div>
              ))}

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!body.trim()) return;
                  reply.mutate();
                }}
                className="space-y-2 pt-2"
              >
                <Textarea
                  placeholder="Reply as support team..."
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  maxLength={10000}
                />
                <AttachmentUpload
                  folder={data.ticket.id}
                  value={attachments}
                  onChange={setAttachments}
                />
                <div className="flex items-center justify-between">
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button type="button" variant="ghost" size="sm" className="text-destructive">
                        <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete ticket
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete ticket?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently deletes the ticket and all replies. This cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={() => del.mutate()}>Delete</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                  <Button type="submit" disabled={reply.isPending || !body.trim()}>
                    {reply.isPending ? (
                      <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="mr-1 h-4 w-4" />
                    )}
                    Send reply
                  </Button>
                </div>
              </form>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
