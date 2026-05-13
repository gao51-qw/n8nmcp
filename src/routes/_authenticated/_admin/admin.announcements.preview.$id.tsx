import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Markdown } from "@/components/markdown";
import { ArrowLeft, Eye } from "lucide-react";
import {
  formatLocal,
  formatLocalLong,
  formatUtc,
  localTimeZone,
} from "@/lib/format-datetime";

type Status = "draft" | "scheduled" | "published";
type Announcement = {
  id: string;
  title: string;
  body: string;
  status: Status;
  published_at: string;
  scheduled_for: string | null;
};

export const Route = createFileRoute(
  "/_authenticated/_admin/admin/announcements/preview/$id",
)({
  head: () => ({ meta: [{ title: "Preview announcement — n8n-mcp" }] }),
  component: AnnouncementPreview,
});

function StatusBadge({ status }: { status: Status }) {
  if (status === "draft") return <Badge variant="secondary">Draft</Badge>;
  if (status === "scheduled")
    return (
      <Badge className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/20 dark:text-amber-300">
        Scheduled
      </Badge>
    );
  return <Badge>Published</Badge>;
}

function AnnouncementPreview() {
  const { id } = Route.useParams();

  const { data, isLoading, error } = useQuery({
    queryKey: ["announcement-preview", id],
    queryFn: async (): Promise<Announcement> => {
      const { data, error } = await supabase
        .from("announcements")
        .select("id,title,body,status,published_at,scheduled_for")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Announcement;
    },
    // Keyed by id; the only mutation paths invalidate via
    // ["admin-announcements"]. Treat as effectively immutable per id.
    staleTime: Infinity,
    gcTime: 30 * 60_000,
  });

  // Time we'll show in the article — mirrors what /whats-new will render once
  // it's actually published.
  const stamp =
    data?.status === "scheduled" && data.scheduled_for
      ? data.scheduled_for
      : data?.published_at ?? new Date().toISOString();

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <Button asChild variant="ghost" size="sm">
          <Link to="/admin/announcements">
            <ArrowLeft className="mr-1 h-4 w-4" /> Back to admin
          </Link>
        </Button>
        {data && (
          <Button asChild variant="outline" size="sm">
            <Link to="/whats-new">Open live /whats-new</Link>
          </Button>
        )}
      </div>

      <div className="rounded-lg border border-dashed border-primary/40 bg-primary/5 p-3 text-xs">
        <div className="flex items-center gap-2 font-medium text-primary">
          <Eye className="h-3.5 w-3.5" />
          Preview mode — only visible to admins
        </div>
        <p className="mt-1 text-muted-foreground">
          This page renders the announcement using the exact article styling and
          timestamp formatting from <code>/whats-new</code>. Times are shown in
          your local timezone ({localTimeZone}).
        </p>
      </div>

      {isLoading ? (
        <div className="rounded-xl border border-border bg-card p-6">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="mt-3 h-5 w-3/4" />
          <Skeleton className="mt-2 h-4 w-full" />
          <Skeleton className="mt-1 h-4 w-5/6" />
        </div>
      ) : error || !data ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 p-6 text-sm">
          <p className="font-medium text-destructive">Couldn't load announcement</p>
          <p className="mt-1 text-muted-foreground">
            It may have been deleted, or you don't have access to it.
          </p>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>Status:</span> <StatusBadge status={data.status} />
            {data.status === "scheduled" && data.scheduled_for && (
              <span>· will go live {formatLocal(data.scheduled_for)}</span>
            )}
          </div>

          <article className="rounded-xl border border-border bg-card p-6">
            <div className="flex items-center justify-between gap-3">
              <time
                dateTime={stamp}
                className="text-xs text-muted-foreground"
                title={`${formatLocalLong(stamp)} — ${formatUtc(stamp)}`}
              >
                {formatLocal(stamp)}
              </time>
              {data.status === "published" && <Badge>Latest</Badge>}
            </div>
            <h2 className="mt-2 text-lg font-semibold">{data.title}</h2>
            <Markdown className="mt-2">{data.body}</Markdown>
          </article>

          <p className="text-xs text-muted-foreground">
            Tip: hover the timestamp above to see the long-form local time and
            UTC equivalent — same tooltip users will see on{" "}
            <code>/whats-new</code>.
          </p>
        </>
      )}
    </div>
  );
}