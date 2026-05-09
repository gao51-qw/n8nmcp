import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Loader2, Megaphone, Pencil, Trash2 } from "lucide-react";
import { Markdown } from "@/components/markdown";

export const Route = createFileRoute("/_authenticated/_admin/admin/announcements")({
  head: () => ({ meta: [{ title: "Admin · Announcements — n8n-mcp" }] }),
  component: AdminAnnouncements,
});

type Announcement = {
  id: string;
  title: string;
  body: string;
  published_at: string;
  created_by: string | null;
};

const TITLE_MAX = 200;
const BODY_MAX = 5000;

function AdminAnnouncements() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");

  const [editing, setEditing] = useState<Announcement | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editBody, setEditBody] = useState("");
  const [republish, setRepublish] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-announcements"],
    queryFn: async (): Promise<Announcement[]> => {
      const { data, error } = await supabase
        .from("announcements")
        .select("*")
        .order("published_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      const t = title.trim();
      const b = body.trim();
      if (!t || !b) throw new Error("Title and body are required");
      if (t.length > TITLE_MAX) throw new Error(`Title must be under ${TITLE_MAX} chars`);
      if (b.length > BODY_MAX) throw new Error(`Body must be under ${BODY_MAX} chars`);
      const { error } = await supabase.from("announcements").insert({
        title: t,
        body: b,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Published");
      setTitle("");
      setBody("");
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const update = useMutation({
    mutationFn: async () => {
      if (!editing) return;
      const t = editTitle.trim();
      const b = editBody.trim();
      if (!t || !b) throw new Error("Title and body are required");
      if (t.length > TITLE_MAX) throw new Error(`Title must be under ${TITLE_MAX} chars`);
      if (b.length > BODY_MAX) throw new Error(`Body must be under ${BODY_MAX} chars`);
      const patch = republish
        ? { title: t, body: b, published_at: new Date().toISOString() }
        : { title: t, body: b };
      const { error } = await supabase
        .from("announcements")
        .update(patch)
        .eq("id", editing.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(republish ? "Updated and republished" : "Updated");
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

  const openEdit = (a: Announcement) => {
    setEditing(a);
    setEditTitle(a.title);
    setEditBody(a.body);
    setRepublish(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Megaphone className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-3xl font-bold">Announcements</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Publish updates to the <strong>What's New</strong> page for all signed-in users.
          </p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New announcement</CardTitle>
          <CardDescription>Markdown-style line breaks are preserved.</CardDescription>
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
          <div className="flex justify-end">
            <Button
              onClick={() => create.mutate()}
              disabled={!title.trim() || !body.trim() || create.isPending}
            >
              {create.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Publish
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Published</CardTitle>
          <CardDescription>Visible to all signed-in users.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !data?.length ? (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No announcements yet.
            </p>
          ) : (
            data.map((a) => (
              <div
                key={a.id}
                className="flex items-start justify-between gap-4 rounded-lg border border-border p-4"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-xs text-muted-foreground">
                    {new Date(a.published_at).toLocaleString()}
                  </div>
                  <div className="mt-1 font-semibold">{a.title}</div>
                  <Markdown className="mt-1">{a.body}</Markdown>
                </div>
                <div className="flex shrink-0 gap-1">
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => openEdit(a)}
                    title="Edit"
                  >
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
            ))
          )}
        </CardContent>
      </Card>

      <Dialog open={!!editing} onOpenChange={(v) => !v && setEditing(null)}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit announcement</DialogTitle>
            <DialogDescription>
              Update the title or body. Optionally republish to bump it to the top of What's New.
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
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={republish}
                onCheckedChange={(v) => setRepublish(v === true)}
              />
              Republish (update timestamp to now)
            </label>
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
