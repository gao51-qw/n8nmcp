import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { toast } from "sonner";
import {
  createTicket,
  listMyTickets,
  getTicket,
  replyToTicket,
  type TicketAttachment,
  type TicketStatus,
  type TicketCategory,
  type TicketPriority,
} from "@/lib/tickets.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2, MessageSquarePlus, LifeBuoy, Send } from "lucide-react";
import { AttachmentUpload } from "@/components/tickets/attachment-upload";
import { AttachmentList } from "@/components/tickets/attachment-list";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/tickets")({
  head: () => ({ meta: [{ title: "工单 — n8n-mcp" }] }),
  validateSearch: (s) => z.object({ id: z.string().uuid().optional() }).parse(s),
  component: TicketsPage,
});

const STATUS_LABEL: Record<TicketStatus, string> = {
  open: "待处理",
  in_progress: "处理中",
  waiting_user: "等待回复",
  resolved: "已解决",
  closed: "已关闭",
};

const STATUS_VARIANT: Record<TicketStatus, "default" | "secondary" | "outline"> = {
  open: "default",
  in_progress: "default",
  waiting_user: "secondary",
  resolved: "outline",
  closed: "outline",
};

const CATEGORY_LABEL: Record<TicketCategory, string> = {
  bug: "Bug",
  feature_request: "功能建议",
  billing: "账单",
  account: "账户",
  other: "其他",
};

const PRIORITY_LABEL: Record<TicketPriority, string> = {
  low: "低",
  normal: "普通",
  high: "高",
  urgent: "紧急",
};

function TicketsPage() {
  const search = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();
  const fetchList = useServerFn(listMyTickets);
  const [createOpen, setCreateOpen] = useState(false);

  const { data: tickets, isLoading } = useQuery({
    queryKey: ["tickets", "mine"],
    queryFn: () => fetchList(),
  });

  const openTicketId = search.id ?? null;

  return (
    <>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">工单</h1>
          <p className="mt-2 text-muted-foreground">
            提交问题或反馈，我们会在工作日内回复。
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <MessageSquarePlus className="mr-1.5 h-4 w-4" /> 新建工单
        </Button>
      </div>

      <CreateTicketDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={(id) => {
          setCreateOpen(false);
          qc.invalidateQueries({ queryKey: ["tickets", "mine"] });
          navigate({ search: { id } });
        }}
      />

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !tickets || tickets.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center gap-3 py-12 text-center">
            <LifeBuoy className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">暂无工单</p>
            <Button onClick={() => setCreateOpen(true)} variant="outline" size="sm">
              新建第一个工单
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {tickets.map((t) => (
            <button
              key={t.id}
              onClick={() => navigate({ search: { id: t.id } })}
              className="block w-full rounded-lg border border-border bg-card p-4 text-left transition-colors hover:bg-muted/50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <Badge variant={STATUS_VARIANT[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {CATEGORY_LABEL[t.category]}
                    </Badge>
                    {(t.priority === "high" || t.priority === "urgent") && (
                      <Badge variant="destructive" className="text-[10px]">
                        {PRIORITY_LABEL[t.priority]}
                      </Badge>
                    )}
                  </div>
                  <h3 className="mt-1.5 truncate font-medium">{t.title}</h3>
                  <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">
                    {t.description}
                  </p>
                </div>
                <div className="text-right text-xs text-muted-foreground">
                  {new Date(t.last_reply_at).toLocaleDateString()}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      <TicketDetailSheet
        ticketId={openTicketId}
        onClose={() => navigate({ search: {} })}
      />
    </>
  );
}

function CreateTicketDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (id: string) => void;
}) {
  const submit = useServerFn(createTicket);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<TicketCategory>("other");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);

  const m = useMutation({
    mutationFn: () =>
      submit({ data: { title, description, category, priority, attachments } }),
    onSuccess: ({ id }) => {
      toast.success("工单已提交");
      setTitle("");
      setDescription("");
      setAttachments([]);
      setCategory("other");
      setPriority("normal");
      onCreated(id);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "提交失败"),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>新建工单</DialogTitle>
          <DialogDescription>请尽量提供清晰的复现步骤或上下文</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            m.mutate();
          }}
          className="space-y-4"
        >
          <div className="space-y-2">
            <Label htmlFor="t-title">标题</Label>
            <Input
              id="t-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>分类</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as TicketCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(CATEGORY_LABEL) as TicketCategory[]).map((k) => (
                    <SelectItem key={k} value={k}>{CATEGORY_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>优先级</Label>
              <Select value={priority} onValueChange={(v) => setPriority(v as TicketPriority)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(PRIORITY_LABEL) as TicketPriority[]).map((k) => (
                    <SelectItem key={k} value={k}>{PRIORITY_LABEL[k]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="t-desc">描述</Label>
            <Textarea
              id="t-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              maxLength={10000}
              required
            />
          </div>
          <div className="space-y-2">
            <Label>附件（可选）</Label>
            <AttachmentUpload folder="drafts" value={attachments} onChange={setAttachments} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={m.isPending}>
              {m.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              提交
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TicketDetailSheet({
  ticketId,
  onClose,
}: {
  ticketId: string | null;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const fetchTicket = useServerFn(getTicket);
  const sendReply = useServerFn(replyToTicket);
  const [body, setBody] = useState("");
  const [attachments, setAttachments] = useState<TicketAttachment[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["tickets", "detail", ticketId],
    queryFn: () => fetchTicket({ data: { id: ticketId! } }),
    enabled: !!ticketId,
  });

  const reply = useMutation({
    mutationFn: () =>
      sendReply({ data: { ticket_id: ticketId!, body, attachments } }),
    onSuccess: () => {
      setBody("");
      setAttachments([]);
      qc.invalidateQueries({ queryKey: ["tickets", "detail", ticketId] });
      qc.invalidateQueries({ queryKey: ["tickets", "mine"] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "发送失败"),
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
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={STATUS_VARIANT[data.ticket.status]}>
                  {STATUS_LABEL[data.ticket.status]}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  {CATEGORY_LABEL[data.ticket.category]}
                </Badge>
                <Badge variant="outline" className="text-[10px]">
                  优先级：{PRIORITY_LABEL[data.ticket.priority]}
                </Badge>
              </div>
              <SheetTitle className="text-left">{data.ticket.title}</SheetTitle>
              <SheetDescription className="text-left text-xs">
                创建于 {new Date(data.ticket.created_at).toLocaleString()}
              </SheetDescription>
            </SheetHeader>

            <div className="mt-6 space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-3">
                <div className="text-xs font-medium text-muted-foreground">
                  {data.owner?.name ?? "你"}
                </div>
                <div className="mt-1 whitespace-pre-wrap text-sm">
                  {data.ticket.description}
                </div>
                <AttachmentList
                  ticketId={data.ticket.id}
                  attachments={data.ticket.attachments}
                />
              </div>

              {data.replies.map((r) => {
                const mine = r.author_id === user?.id;
                return (
                  <div
                    key={r.id}
                    className={`rounded-lg border p-3 ${
                      r.is_admin
                        ? "border-primary/40 bg-primary/5"
                        : mine
                        ? "border-border bg-muted/30"
                        : "border-border bg-card"
                    }`}
                  >
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span className="font-medium">
                        {r.is_admin ? "支持团队" : r.author_name ?? "用户"}
                      </span>
                      <span>{new Date(r.created_at).toLocaleString()}</span>
                    </div>
                    <div className="mt-1 whitespace-pre-wrap text-sm">{r.body}</div>
                    <AttachmentList ticketId={data.ticket.id} attachments={r.attachments} />
                  </div>
                );
              })}

              {data.ticket.status === "closed" ? (
                <p className="text-center text-xs text-muted-foreground">
                  此工单已关闭，如需继续请新建工单。
                </p>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!body.trim()) return;
                    reply.mutate();
                  }}
                  className="space-y-2 pt-2"
                >
                  <Textarea
                    placeholder="补充信息或回复..."
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
                  <div className="flex justify-end">
                    <Button type="submit" disabled={reply.isPending || !body.trim()}>
                      {reply.isPending ? (
                        <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                      ) : (
                        <Send className="mr-1 h-4 w-4" />
                      )}
                      发送
                    </Button>
                  </div>
                </form>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
