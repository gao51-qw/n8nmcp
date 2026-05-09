import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  CalendarX,
  Clock,
  Eye,
  FileText,
  History,
  Loader2,
  Megaphone,
  ChevronDown,
  Download,
  Pencil,
  Search,
  Send,
  Trash2,
} from "lucide-react";
import { Markdown } from "@/components/markdown";
import {
  formatLocal,
  formatLocalLong,
  formatUtc,
  isoToLocalInput,
  localInputToIso,
  localTimeZone,
} from "@/lib/format-datetime";

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

const FIELD_LABELS: Record<string, string> = {
  title: "Title",
  body: "Body",
  status: "Status",
  scheduled_for: "Scheduled for",
  published_at: "Published at",
};

const DATE_FIELDS = new Set(["scheduled_for", "published_at"]);

function formatDiffValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (DATE_FIELDS.has(field) && typeof value === "string") {
    try {
      return formatLocal(value);
    } catch {
      return String(value);
    }
  }
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}

type ExportEntry = {
  e: {
    id: string;
    announcement_id: string | null;
    actor_id: string | null;
    action: string;
    summary: string | null;
    changes: Record<string, unknown> | null;
    created_at: string;
  };
  actorName: string;
  announcement: { title: string } | null | undefined;
  changes: {
    changes?: Record<string, { from: unknown; to: unknown }>;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
};

function downloadBlob(filename: string, mime: string, content: string) {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "string" ? value : JSON.stringify(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportAudit(entries: ExportEntry[], format: "csv" | "json") {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  if (format === "json") {
    const payload = entries.map(({ e, actorName, announcement }) => ({
      id: e.id,
      created_at: e.created_at,
      action: e.action,
      actor_id: e.actor_id,
      actor_name: actorName,
      announcement_id: e.announcement_id,
      announcement_title: announcement?.title ?? null,
      summary: e.summary,
      changes: e.changes,
    }));
    downloadBlob(
      `announcement-audit-${stamp}.json`,
      "application/json",
      JSON.stringify(payload, null, 2),
    );
    return;
  }
  const headers = [
    "id",
    "created_at",
    "action",
    "actor_id",
    "actor_name",
    "announcement_id",
    "announcement_title",
    "summary",
    "changed_fields",
    "changes_json",
  ];
  const rows = entries.map(({ e, actorName, announcement, changes }) => {
    const diff = changes.changes ?? {};
    return [
      e.id,
      e.created_at,
      e.action,
      e.actor_id ?? "",
      actorName,
      e.announcement_id ?? "",
      announcement?.title ?? "",
      e.summary ?? "",
      Object.keys(diff).join("|"),
      JSON.stringify(changes),
    ]
      .map(csvEscape)
      .join(",");
  });
  downloadBlob(
    `announcement-audit-${stamp}.csv`,
    "text/csv",
    [headers.join(","), ...rows].join("\r\n"),
  );
}

function ChangesDiff({

  changes,
}: {
  changes: {
    changes?: Record<string, { from: unknown; to: unknown }>;
    before?: Record<string, unknown>;
    after?: Record<string, unknown>;
  };
}) {
  const diff = changes.changes ?? {};
  const entries = Object.entries(diff);
  if (!entries.length) {
    return (
      <p className="mt-2 rounded bg-muted px-3 py-2 text-xs text-muted-foreground">
        No field-level changes recorded.
      </p>
    );
  }
  return (
    <dl className="mt-2 space-y-2 rounded border border-border bg-muted/40 p-3">
      {entries.map(([field, { from, to }]) => {
        const label = FIELD_LABELS[field] ?? field;
        const isLong =
          field === "body" ||
          (typeof from === "string" && from.length > 80) ||
          (typeof to === "string" && to.length > 80);
        return (
          <div key={field} className="text-xs">
            <dt className="mb-1 font-medium text-foreground">{label}</dt>
            <dd
              className={
                isLong
                  ? "grid gap-1.5"
                  : "grid items-center gap-1.5 sm:grid-cols-[1fr_auto_1fr]"
              }
            >
              <span className="rounded bg-destructive/10 px-2 py-1 font-mono text-[11px] leading-relaxed text-destructive line-through decoration-destructive/60 whitespace-pre-wrap break-words">
                {formatDiffValue(field, from)}
              </span>
              <span
                aria-hidden
                className="text-center text-muted-foreground sm:px-1"
              >
                →
              </span>
              <span className="rounded bg-emerald-500/10 px-2 py-1 font-mono text-[11px] leading-relaxed text-emerald-700 dark:text-emerald-400 whitespace-pre-wrap break-words">
                {formatDiffValue(field, to)}
              </span>
            </dd>
          </div>
        );
      })}
    </dl>
  );
}

const TITLE_MAX = 200;
const BODY_MAX = 5000;


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
          <time className="text-xs text-muted-foreground" title={formatLocalLong(stamp)}>
            {formatLocal(stamp)}
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
  const router = useRouter();
  // Tracks audit-log row IDs we already toasted in this session, so realtime
  // echoes from our own writes (or duplicate events) never produce dup toasts.
  const seenAuditIds = useRef<Set<string>>(new Set());

  const goToWhatsNew = () => router.navigate({ to: "/whats-new" });

  /**
   * Rich notification for high-impact actions. Includes a description with
   * the announcement title + the relevant timestamp, and (where useful) a
   * "View on What's New" action so the admin can confirm immediately.
   */
  const notify = (
    kind: "create" | "publish" | "republish" | "delete" | "cancel_schedule" | "schedule" | "draft" | "update",
    title: string,
    detail?: string,
  ) => {
    const headlines: Record<typeof kind, string> = {
      create: "Announcement created",
      publish: "Published to What's New",
      republish: "Republished — bumped to top",
      delete: "Announcement deleted",
      cancel_schedule: "Schedule canceled",
      schedule: "Announcement scheduled",
      draft: "Saved as draft",
      update: "Announcement updated",
    };
    const showAction = kind === "publish" || kind === "republish" || kind === "create";
    toast(headlines[kind], {
      description: detail ? `"${title}" — ${detail}` : `"${title}"`,
      action: showAction
        ? { label: "View on What's New", onClick: goToWhatsNew }
        : undefined,
    });
  };


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
  const [auditQuery, setAuditQuery] = useState("");
  const [exportingAll, setExportingAll] = useState(false);

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

  type AuditEntry = {
    id: string;
    announcement_id: string | null;
    actor_id: string | null;
    action: string;
    summary: string | null;
    changes: Record<string, unknown> | null;
    created_at: string;
  };

  const { data: auditData, isLoading: auditLoading } = useQuery({
    queryKey: ["announcement-audit"],
    queryFn: async (): Promise<{
      entries: AuditEntry[];
      actors: Record<string, { display_name: string | null; email: string | null }>;
    }> => {
      const { data: entries, error } = await supabase
        .from("announcement_audit_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      const list = (entries ?? []) as AuditEntry[];
      const ids = Array.from(
        new Set(list.map((e) => e.actor_id).filter((v): v is string => !!v)),
      );
      let actors: Record<string, { display_name: string | null; email: string | null }> = {};
      if (ids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, email")
          .in("id", ids);
        for (const p of profs ?? []) {
          actors[p.id] = { display_name: p.display_name, email: p.email };
        }
      }
      return { entries: list, actors };
    },
  });

  const handleExportAll = async (format: "csv" | "json") => {
    if (exportingAll) return;
    setExportingAll(true);
    const t = toast.loading("Loading full audit history…");
    try {
      const all: AuditEntry[] = [];
      const pageSize = 1000;
      let from = 0;
      for (;;) {
        const { data: page, error } = await supabase
          .from("announcement_audit_logs")
          .select("*")
          .order("created_at", { ascending: false })
          .range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = (page ?? []) as AuditEntry[];
        all.push(...rows);
        if (rows.length < pageSize) break;
        from += pageSize;
      }
      const actorIds = Array.from(
        new Set(all.map((e) => e.actor_id).filter((v): v is string => !!v)),
      );
      const annIds = Array.from(
        new Set(all.map((e) => e.announcement_id).filter((v): v is string => !!v)),
      );
      const actors: Record<string, { display_name: string | null; email: string | null }> = {
        ...(auditData?.actors ?? {}),
      };
      if (actorIds.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, display_name, email")
          .in("id", actorIds);
        for (const p of profs ?? []) {
          actors[p.id] = { display_name: p.display_name, email: p.email };
        }
      }
      const annTitles: Record<string, string> = {};
      for (const a of data ?? []) annTitles[a.id] = a.title;
      const missing = annIds.filter((id) => !annTitles[id]);
      if (missing.length) {
        const { data: anns } = await supabase
          .from("announcements")
          .select("id, title")
          .in("id", missing);
        for (const a of anns ?? []) annTitles[a.id] = a.title;
      }
      const exportEntries = all.map((e) => {
        const actor = e.actor_id ? actors[e.actor_id] : null;
        return {
          e,
          actorName: actor?.display_name || actor?.email || "Unknown admin",
          announcement:
            e.announcement_id && annTitles[e.announcement_id]
              ? { title: annTitles[e.announcement_id] }
              : null,
          changes: (e.changes ?? {}) as {
            changes?: Record<string, { from: unknown; to: unknown }>;
            before?: Record<string, unknown>;
            after?: Record<string, unknown>;
          },
        };
      });
      exportAudit(exportEntries, format);
      toast.success(`Exported ${exportEntries.length} entries`, { id: t });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Export failed", { id: t });
    } finally {
      setExportingAll(false);
    }
  };

  // Live-update audit list + show toast when ANOTHER admin session (or the
  // pg_cron auto-publisher, if it ever logs) writes a new audit row.
  useEffect(() => {
    const channel = supabase
      .channel("announcement-audit-stream")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "announcement_audit_logs" },
        (payload) => {
          const row = payload.new as {
            id: string;
            action: string;
            summary: string | null;
            actor_id: string | null;
          };
          // Skip echoes of writes we already toasted in this tab.
          if (seenAuditIds.current.has(row.id)) return;
          seenAuditIds.current.add(row.id);
          // Skip our own writes that happened in another tab where we already
          // hold the actor session — we still want to know, so show as a
          // lighter "info" toast instead of suppressing entirely.
          const isSelf = row.actor_id && user?.id && row.actor_id === user.id;
          toast(isSelf ? "Synced from another tab" : "Announcement activity", {
            description: row.summary ?? row.action,
          });
          qc.invalidateQueries({ queryKey: ["announcement-audit"] });
          qc.invalidateQueries({ queryKey: ["admin-announcements"] });
          qc.invalidateQueries({ queryKey: ["whats-new"] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [qc, user?.id]);

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
  ): Promise<string | null> => {
    if (!user?.id) return null;
    const { data, error } = await supabase
      .from("announcement_audit_logs")
      .insert({
        announcement_id: announcementId,
        actor_id: user.id,
        action,
        summary,
        changes: changes as never,
      })
      .select("id")
      .single();
    if (error) {
      console.warn("audit log insert failed", error);
      return null;
    }
    // Mark as seen so the realtime subscription doesn't re-toast our own write.
    if (data?.id) seenAuditIds.current.add(data.id);
    return data?.id ?? null;
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
      const t = title.trim();
      const detail =
        mode === "scheduled" && scheduledFor
          ? `publishes ${formatLocal(localInputToIso(scheduledFor))}`
          : mode === "published"
            ? `now live`
            : undefined;
      notify(
        mode === "draft" ? "draft" : mode === "scheduled" ? "schedule" : "create",
        t,
        detail,
      );
      setTitle("");
      setBody("");
      setScheduledFor("");
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
      qc.invalidateQueries({ queryKey: ["announcement-audit"] });
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
      const wasRepublish =
        editing?.status === "published" &&
        editStatus === "published" &&
        republish;
      notify(
        wasRepublish ? "republish" : "update",
        editTitle.trim() || editing?.title || "(untitled)",
        wasRepublish ? "bumped to top of What's New" : undefined,
      );
      setEditing(null);
      qc.invalidateQueries({ queryKey: ["admin-announcements"] });
      qc.invalidateQueries({ queryKey: ["announcement-audit"] });
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
    onSuccess: (_, a) => {
      notify("delete", a.title);
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
    onSuccess: (_, a) => {
      notify("publish", a.title, "now live on What's New");
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
    onSuccess: (_, a) => {
      notify("cancel_schedule", a.title, "moved back to Draft");
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
            <span
              className="inline-flex items-center gap-1"
              title={formatLocalLong(a.scheduled_for)}
            >
              <Clock className="h-3 w-3" />
              Publishes {formatLocal(a.scheduled_for)}
            </span>
          ) : a.status === "published" ? (
            <span title={formatLocalLong(a.published_at)}>
              Published {formatLocal(a.published_at)}
            </span>
          ) : (
            <span title={formatLocalLong(a.published_at)}>
              Draft · saved {formatLocal(a.published_at)}
            </span>
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
            onClick={() => cancelSchedule.mutate(a)}
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
          onClick={() => remove.mutate(a)}
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
                <p className="text-[11px] text-muted-foreground">
                  Times use your local zone <strong>{localTimeZone}</strong>.
                  {scheduledFor && (
                    <>
                      {" "}
                      Saved as <span className="font-mono">{formatUtc(localInputToIso(scheduledFor))}</span>;
                      readers see it in their own zone.
                    </>
                  )}
                </p>
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

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> Audit log
            <span className="text-muted-foreground">
              ({auditData?.entries.length ?? 0})
            </span>
          </CardTitle>
          <CardDescription>
            Last 50 actions on announcements — who did what, when, and which fields
            changed. Auto-publish runs by the system are not captured here.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {auditLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          ) : !auditData?.entries.length ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No activity yet — your next edit will appear here.
            </p>
          ) : (
            (() => {
              const entries = auditData.entries.map((e) => {
                const actor = e.actor_id ? auditData.actors[e.actor_id] : null;
                const actorName =
                  actor?.display_name || actor?.email || "Unknown admin";
                const announcement = e.announcement_id
                  ? data?.find((a) => a.id === e.announcement_id)
                  : null;
                const changes = (e.changes ?? {}) as {
                  changes?: Record<string, { from: unknown; to: unknown }>;
                  before?: Record<string, unknown>;
                  after?: Record<string, unknown>;
                };
                return { e, actorName, announcement, changes };
              });
              const q = auditQuery.trim().toLowerCase();
              const filtered = q
                ? entries.filter(({ e, actorName, announcement, changes }) => {
                    const haystack: string[] = [
                      e.action,
                      e.summary ?? "",
                      actorName,
                      announcement?.title ?? "",
                      announcement?.body ?? "",
                    ];
                    const diff = changes.changes ?? {};
                    for (const [field, { from, to }] of Object.entries(diff)) {
                      haystack.push(field);
                      if (from != null) haystack.push(String(from));
                      if (to != null) haystack.push(String(to));
                    }
                    return haystack.join(" \u0001 ").toLowerCase().includes(q);
                  })
                : entries;
              return (
                <>
                  <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        type="search"
                        value={auditQuery}
                        onChange={(ev) => setAuditQuery(ev.target.value)}
                        placeholder="Search by title, summary, action, actor, or field changes…"
                        className="pl-8"
                        aria-label="Search audit log"
                      />
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => exportAudit(filtered, "csv")}
                        disabled={!filtered.length}
                      >
                        <Download className="mr-1.5 h-4 w-4" /> CSV
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => exportAudit(filtered, "json")}
                        disabled={!filtered.length}
                      >
                        <Download className="mr-1.5 h-4 w-4" /> JSON
                      </Button>
                    </div>
                  </div>
                  {auditQuery && (
                    <div className="mb-2 text-xs text-muted-foreground">
                      {filtered.length} of {entries.length} matching
                    </div>
                  )}

                  {filtered.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No entries match "{auditQuery}".
                    </p>
                  ) : (
                    <ul className="divide-y divide-border">
                      {filtered.map(({ e, actorName, announcement, changes }) => (
                        <li key={e.id} className="py-3">
                          <details className="group">
                            <summary className="flex cursor-pointer items-center justify-between gap-3 list-none">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2 text-xs">
                                  <Badge variant="outline" className="font-mono">
                                    {e.action}
                                  </Badge>
                                  <span className="font-medium">{actorName}</span>
                                  <span
                                    className="text-muted-foreground"
                                    title={formatLocalLong(e.created_at)}
                                  >
                                    · {formatLocal(e.created_at)}
                                  </span>
                                </div>
                                <div className="mt-1 truncate text-sm">
                                  {e.summary || "—"}
                                  {announcement && (
                                    <span className="ml-1 text-muted-foreground">
                                      — "{announcement.title}"
                                    </span>
                                  )}
                                </div>
                              </div>
                              <span className="shrink-0 text-xs text-muted-foreground group-open:hidden">
                                Show
                              </span>
                              <span className="hidden shrink-0 text-xs text-muted-foreground group-open:inline">
                                Hide
                              </span>
                            </summary>
                            <ChangesDiff changes={changes} />
                          </details>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              );
            })()
          )}
        </CardContent>
      </Card>

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
                  <p className="text-[11px] text-muted-foreground">
                    {localTimeZone}
                    {editScheduledFor && (
                      <>
                        {" "}
                        · <span className="font-mono">{formatUtc(localInputToIso(editScheduledFor))}</span>
                      </>
                    )}
                  </p>
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
