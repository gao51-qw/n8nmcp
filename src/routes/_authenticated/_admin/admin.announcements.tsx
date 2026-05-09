import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
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
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  CalendarX,
  Clock,
  Eye,
  FileText,
  History,
  Loader2,
  Megaphone,
  Pencil,
  Send,
  Trash2,
} from "lucide-react";
import { Markdown } from "@/components/markdown";

export const Route = createFileRoute("/_authenticated/_admin/admin/announcements")({
  head: () => ({ meta: [{ title: "Admin · Announcements — n8n-mcp" }] }),
  component: AdminAnnouncements,
});

type Status = "draft" | "scheduled" | "published";

type Announcement = {
  id: string;
  title: string;
  body: string;
  published_at: string;
  created_by: string | null;
  status: Status;
  scheduled_for: string | null;
};

const TITLE_MAX = 200;
const BODY_MAX = 5000;

// Convert local datetime-input value to ISO; empty -> null.
function localInputToIso(v: string): string | null {
  if (!v) return null;
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

// Convert ISO -> "YYYY-MM-DDTHH:mm" for <input type="datetime-local">.
function isoToLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function StatusBadge({ a }: { a: Announcement }) {
  if (a.status === "draft") return <Badge variant="secondary">Draft</Badge>;
  if (a.status === "scheduled")
    return (
      <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300">
        Scheduled
      </Badge>
    );
  return <Badge>Published</Badge>;
}

/**
 * Mirrors the article styling used by /whats-new so admins can see the exact
 * rendered output before saving / publishing / scheduling.
 */
function WhatsNewPreview({
  title,
  body,
  publishAt,
}: {
  title: string;
  body: string;
  publishAt?: string | null;
}) {
  const hasContent = title.trim() || body.trim();
  if (!hasContent) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-muted/30 p-6 text-center text-sm text-muted-foreground">
        Add a title or body to preview the announcement.
      </div>
    );
  }
  const stamp = publishAt ? new Date(publishAt) : new Date();
  return (
    <div className="rounded-lg border border-dashed border-primary/40 bg-muted/20 p-3">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Preview · /whats-new
      </div>
      <article className="rounded-xl border border-border bg-card p-6">
        <div className="flex items-center justify-between gap-3">
          <time className="text-xs text-muted-foreground" title={stamp.toLocaleString()}>
            {stamp.toLocaleString()}
          </time>
          <Badge>Latest</Badge>
        </div>
        <h2 className="mt-2 text-lg font-semibold">{title || "Untitled"}</h2>
        {body.trim() ? (
          <Markdown className="mt-2">{body}</Markdown>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">No body yet.</p>
        )}
      </article>
    </div>
  );
}

function AdminAnnouncements() {
  const { user } = useAuth();
  const qc = useQueryClient();

  // Create form
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<Status>("published");
  const [scheduledFor, setScheduledFor] = useState("");

  // Edit dialog
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [editStatus, setEditStatus] = useState<Status>("published");
  const [editScheduledFor, setEditScheduledFor] = useState("");
  const [republish, setRepublish] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-announcements"],
    queryFn: async (): Promise<Announcement[]> => {
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .order("status", { ascending: true })
        .order("scheduled_for", { ascending: true, nullsFirst: false })
        .order("published_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Announcement[];
    },
  });

  const grouped = useMemo(() => {
    const list = data ?? [];
    return {
      drafts: list.filter((a) => a.status === "draft"),
      scheduled: list.filter((a) => a.status === "scheduled"),
      published: list.filter((a) => a.status === "published"),
    };
  }, [data]);

  const validateBase = (t: string, b: string) => {
    if (!t || !b) throw new Error("Title and body are required");
    if (t.length > TITLE_MAX) throw new Error(`Title must be under ${TITLE_MAX} chars`);
    if (b.length > BODY_MAX) throw new Error(`Body must be under ${BODY_MAX} chars`);
  };

  type AuditAction =
    | "create"
    | "update"
    | "delete"
    | "publish"
    | "cancel_schedule"
    | "republish";

  // Best-effort audit log writer. Never blocks the primary mutation: we already
  // ran the user's intended change before logging, so a failure here only
  // surfaces a console warning.
  const logAudit = async (
    announcementId: string | null,
    action: AuditAction,
    summary: string,
    changes: Record<string, unknown>,
  ) => {
    if (!user?.id) return;
    const { error } = await supabase.from("announcement_audit_logs").insert({
      announcement_id: announcementId,
      actor_id: user.id,
      action,
      summary,
      changes: changes as never,
    });
    if (error) console.warn("audit log insert failed", error);
  };

  // Diff two announcement snapshots into { field: { from, to } } pairs so the
  // log only stores fields that actually changed.
  const diffFields = (
    before: Partial<Announcement>,
    after: Partial<Announcement>,
  ): Record<string, { from: unknown; to: unknown }> => {
    const fields: Array<keyof Announcement> = [
      "title",
      "body",
      "status",
      "scheduled_for",
      "published_at",
    ];
    const out: Record<string, { from: unknown; to: unknown }> = {};
    for (const f of fields) {
      const b = before[f] ?? null;
      const a = after[f] ?? null;
      if (b !== a) out[f] = { from: b, to: a };
    }
    return out;
  };

  const create = useMutation({
    mutationFn: async () => {
      const t = title.trim();
      const b = body.trim();
      validateBase(t, b);

      let row: {
        title: string;
        body: string;
        created_by: string | null;
        status: Status;
        scheduled_for: string | null;
        published_at?: string;
      };

      if (mode === "scheduled") {
        const iso = localInputToIso(scheduledFor);
        if (!iso) throw new Error("Pick a future publish time");
        if (new Date(iso).getTime() <= Date.now())
          throw new Error("Scheduled time must be in the future");
        row = {
          title: t,
          body: b,
          created_by: user?.id ?? null,
          status: "scheduled",
          scheduled_for: iso,
          published_at: iso, // sort hint until auto-publish runs
        };
      } else {
        row = {
          title: t,
          body: b,
          created_by: user?.id ?? null,
          status: mode,
          scheduled_for: null,
        };
      }

      const { data: inserted, error } = await supabase
        .from("announcements")
        .insert(row)
        .select("id")
        .single();
      if (error) throw error;
      await logAudit(inserted?.id ?? null, "create", `Created (${row.status})`, {
        after: row,
      });
    },
    onSuccess: () => {
      toast.success(
        mode === "draft"
          ? "Saved as draft"
          : mode === "scheduled"
            ? "Scheduled"
            : "Published",
      );
      setTitle("");
      setBody("");
      setScheduledFor("");
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
      qc.invalidateQueries({ queryKey: ["whats-new"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const t = editTitle.trim();
      const b = editBody.trim();
      validateBase(t, b);

      const patch: Partial<Announcement> = {
        title: t,
        body: b,
        status: editStatus,
      };

      if (editStatus === "scheduled") {
        const iso = localInputToIso(editScheduledFor);
        if (!iso) throw new Error("Pick a publish time");
        patch.scheduled_for = iso;
        patch.published_at = iso;
      } else if (editStatus === "draft") {
        patch.scheduled_for = null;
      } else if (editStatus === "published") {
        patch.scheduled_for = null;
        if (republish || editing.status !== "published") {
          patch.published_at = new Date().toISOString();
        }
      }

      const { error } = await supabase
        .from("announcements")
        .update(patch)
        .eq("id", editing.id);
      if (error) throw error;

      const wasRepublish =
        editing.status === "published" &&
        editStatus === "published" &&
        republish;
      const action: AuditAction = wasRepublish ? "republish" : "update";
      const changes = diffFields(editing, { ...editing, ...patch });
      const summaryParts = Object.keys(changes);
      const summary = wasRepublish
        ? "Republished (bumped to top)"
        : summaryParts.length
          ? `Updated: ${summaryParts.join(", ")}`
          : "Saved (no field changes)";
      await logAudit(editing.id, action, summary, { changes });
    },
    onSuccess: () => {
      toast.success("Updated");
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
      qc.invalidateQueries({ queryKey: ["whats-new"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (a: Announcement) => {
      const { error } = await supabase.from("announcements").delete().eq("id", a.id);
      if (error) throw error;
      await logAudit(a.id, "delete", `Deleted "${a.title}"`, {
        before: {
          title: a.title,
          body: a.body,
          status: a.status,
          scheduled_for: a.scheduled_for,
          published_at: a.published_at,
        },
      });
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
      qc.invalidateQueries({ queryKey: ["announcement-audit"] });
      qc.invalidateQueries({ queryKey: ["whats-new"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publishNow = useMutation({
    mutationFn: async (a: Announcement) => {
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from("announcements")
        .update({
          status: "published",
          scheduled_for: null,
          published_at: nowIso,
        })
        .eq("id", a.id);
      if (error) throw error;
      await logAudit(a.id, "publish", `Published "${a.title}"`, {
        changes: diffFields(a, {
          ...a,
          status: "published",
          scheduled_for: null,
          published_at: nowIso,
        }),
      });
    },
    onSuccess: () => {
      toast.success("Published");
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
      qc.invalidateQueries({ queryKey: ["announcement-audit"] });
      qc.invalidateQueries({ queryKey: ["whats-new"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelSchedule = useMutation({
    mutationFn: async (a: Announcement) => {
      const { error } = await supabase
        .from("announcements")
        .update({ status: "draft", scheduled_for: null })
        .eq("id", a.id);
      if (error) throw error;
      await logAudit(
        a.id,
        "cancel_schedule",
        `Canceled schedule for "${a.title}"`,
        {
          changes: diffFields(a, { ...a, status: "draft", scheduled_for: null }),
        },
      );
    },
    onSuccess: () => {
      toast.success("Schedule canceled — moved to Draft");
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
      qc.invalidateQueries({ queryKey: ["announcement-audit"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openEdit = (a: Announcement) => {
    setEditing(a);
    setEditTitle(a.title);
    setEditBody(a.body);
    setEditStatus(a.status);
    setEditScheduledFor(isoToLocalInput(a.scheduled_for));
    setRepublish(false);
  };

  const renderRow = (a: Announcement) => (
    <div
      key={a.id}
      className="flex items-start justify-between gap-4 rounded-lg border border-border p-4"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <StatusBadge a={a} />
          {a.status === "scheduled" && a.scheduled_for ? (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Publishes {new Date(a.scheduled_for).toLocaleString()}
            </span>
          ) : a.status === "published" ? (
            <span>Published {new Date(a.published_at).toLocaleString()}</span>
          ) : (
            <span>Draft · saved {new Date(a.published_at).toLocaleString()}</span>
          )}
        </div>
        <div className="mt-1 font-semibold">{a.title}</div>
        <Markdown className="mt-1">{a.body}</Markdown>
      </div>
      <div className="flex shrink-0 gap-1">
        {a.status !== "published" && (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => publishNow.mutate(a)}
            disabled={publishNow.isPending}
            title="Publish now"
          >
            <Send className="h-4 w-4" />
          </Button>
        )}
        {a.status === "scheduled" && (
          <Button
            size="icon"
            variant="ghost"
            onClick={() => cancelSchedule.mutate(a.id)}
            disabled={cancelSchedule.isPending}
            title="Cancel schedule (move to Draft)"
          >
            <CalendarX className="h-4 w-4" />
          </Button>
        )}
        <Button size="icon" variant="ghost" onClick={() => openEdit(a)} title="Edit">
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="text-destructive"
          onClick={() => remove.mutate(a.id)}
          disabled={remove.isPending}
          title="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Megaphone className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-3xl font-bold">Announcements</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Save drafts, schedule for later, or publish immediately to{" "}
            <strong>What's New</strong>.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New announcement</CardTitle>
          <CardDescription>
            Markdown supported. Choose Draft to save without publishing or Scheduled to
            auto-publish at a specific time.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="MCP gateway now supports streaming"
              maxLength={TITLE_MAX}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="body">Body</Label>
            <Tabs defaultValue="write">
              <TabsList>
                <TabsTrigger value="write">
                  <Pencil className="mr-1 h-3 w-3" /> Write
                </TabsTrigger>
                <TabsTrigger value="preview">
                  <Eye className="mr-1 h-3 w-3" /> Preview
                </TabsTrigger>
              </TabsList>
              <TabsContent value="write" className="mt-2">
                <Textarea
                  id="body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder="What changed and why it matters."
                  rows={6}
                  maxLength={BODY_MAX}
                />
              </TabsContent>
              <TabsContent value="preview" className="mt-2">
                <WhatsNewPreview
                  title={title}
                  body={body}
                  publishAt={
                    mode === "scheduled" ? localInputToIso(scheduledFor) : null
                  }
                />
              </TabsContent>
            </Tabs>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>Action</Label>
              <Select value={mode} onValueChange={(v) => setMode(v as Status)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="published">Publish now</SelectItem>
                  <SelectItem value="scheduled">Schedule for later</SelectItem>
                  <SelectItem value="draft">Save as draft</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {mode === "scheduled" && (
              <div className="space-y-2">
                <Label htmlFor="schedule">Publish at</Label>
                <Input
                  id="schedule"
                  type="datetime-local"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                />
              </div>
            )}
          </div>

          <div className="flex justify-end">
            <Button
              onClick={() => create.mutate()}
              disabled={!title.trim() || !body.trim() || create.isPending}
            >
              {create.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              {mode === "draft" ? (
                <>
                  <FileText className="mr-1 h-4 w-4" /> Save draft
                </>
              ) : mode === "scheduled" ? (
                <>
                  <Clock className="mr-1 h-4 w-4" /> Schedule
                </>
              ) : (
                <>
                  <Send className="mr-1 h-4 w-4" /> Publish
                </>
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {(["scheduled", "drafts", "published"] as const).map((key) => {
        const items =
          key === "scheduled"
            ? grouped.scheduled
            : key === "drafts"
              ? grouped.drafts
              : grouped.published;
        const titleMap = {
          scheduled: "Scheduled",
          drafts: "Drafts",
          published: "Published",
        } as const;
        const descMap = {
          scheduled: "Will auto-publish at the configured time.",
          drafts: "Only visible to admins until you publish.",
          published: "Live on the What's New page.",
        } as const;

        return (
          <Card key={key}>
            <CardHeader>
              <CardTitle>
                {titleMap[key]} <span className="text-muted-foreground">({items.length})</span>
              </CardTitle>
              <CardDescription>{descMap[key]}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {isLoading ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading…
                </div>
              ) : items.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  Nothing here yet.
                </p>
              ) : (
                items.map(renderRow)
              )}
            </CardContent>
          </Card>
        );
      })}

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit announcement</DialogTitle>
            <DialogDescription>
              Change content or move between draft, scheduled, and published.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-title">Title</Label>
              <Input
                id="edit-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={TITLE_MAX}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-body">Body</Label>
              <Tabs defaultValue="write">
                <TabsList>
                  <TabsTrigger value="write">
                    <Pencil className="mr-1 h-3 w-3" /> Write
                  </TabsTrigger>
                  <TabsTrigger value="preview">
                    <Eye className="mr-1 h-3 w-3" /> Preview
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="write" className="mt-2">
                  <Textarea
                    id="edit-body"
                    value={editBody}
                    onChange={(e) => setEditBody(e.target.value)}
                    rows={8}
                    maxLength={BODY_MAX}
                  />
                </TabsContent>
                <TabsContent value="preview" className="mt-2">
                  <WhatsNewPreview
                    title={editTitle}
                    body={editBody}
                    publishAt={
                      editStatus === "scheduled"
                        ? localInputToIso(editScheduledFor)
                        : editStatus === "published" &&
                            !republish &&
                            editing?.published_at
                          ? editing.published_at
                          : null
                    }
                  />
                </TabsContent>
              </Tabs>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={(v) => setEditStatus(v as Status)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Draft</SelectItem>
                    <SelectItem value="scheduled">Scheduled</SelectItem>
                    <SelectItem value="published">Published</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {editStatus === "scheduled" && (
                <div className="space-y-2">
                  <Label htmlFor="edit-schedule">Publish at</Label>
                  <Input
                    id="edit-schedule"
                    type="datetime-local"
                    value={editScheduledFor}
                    onChange={(e) => setEditScheduledFor(e.target.value)}
                  />
                </div>
              )}
            </div>

            {editStatus === "published" && editing?.status === "published" && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-border"
                  checked={republish}
                  onChange={(e) => setRepublish(e.target.checked)}
                />
                Republish (bump to top of What's New)
              </label>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => update.mutate()}
              disabled={!editTitle.trim() || !editBody.trim() || update.isPending}
            >
              {update.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
