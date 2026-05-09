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
import {
  CalendarX,
  Clock,
  FileText,
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

      const { error } = await supabase.from("announcements").insert(row);
      if (error) throw error;
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
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("announcements").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Deleted");
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const publishNow = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("announcements")
        .update({
          status: "published",
          scheduled_for: null,
          published_at: new Date().toISOString(),
        })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Published");
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
      qc.invalidateQueries({ queryKey: ["whats-new"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const cancelSchedule = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("announcements")
        .update({ status: "draft", scheduled_for: null })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Schedule canceled — moved to Draft");
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
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
            onClick={() => publishNow.mutate(a.id)}
            disabled={publishNow.isPending}
            title="Publish now"
          >
            <Send className="h-4 w-4" />
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
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What changed and why it matters."
              rows={6}
              maxLength={BODY_MAX}
            />
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
              <Textarea
                id="edit-body"
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                rows={8}
                maxLength={BODY_MAX}
              />
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
