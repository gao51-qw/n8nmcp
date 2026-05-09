import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChevronLeft, ChevronRight, Megaphone, Sparkles } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { formatLocal, formatLocalLong } from "@/lib/format-datetime";

const PAGE_SIZE = 5;

type Announcement = {
  id: string;
  title: string;
  body: string;
  published_at: string;
};

export const Route = createFileRoute("/_authenticated/whats-new")({
  head: () => ({ meta: [{ title: "What's New — n8n-mcp" }] }),
  component: WhatsNew,
});

function relativeTime(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.round(diff / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

function WhatsNew() {
  const [page, setPage] = useState(0);

  const { data, isLoading } = useQuery({
    queryKey: ["whats-new", page],
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      const { data, count, error } = await supabase
        .from("announcements")
        .select("*", { count: "exact" })
        .eq("status", "published")
        .order("published_at", { ascending: false })
        .range(from, to);
      if (error) throw error;
      return { items: (data ?? []) as Announcement[], total: count ?? 0 };
    },
  });

  const total = data?.total ?? 0;
  const items = data?.items ?? [];
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrev = page > 0;
  const hasNext = page + 1 < totalPages;

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Megaphone className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-3xl font-bold">What's new</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Product updates, sorted by most recent.
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-6">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-5 w-3/4" />
              <Skeleton className="mt-2 h-4 w-full" />
              <Skeleton className="mt-1 h-4 w-5/6" />
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-primary/10">
            <Sparkles className="h-6 w-6 text-primary" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">No announcements yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Check back later — product updates will appear here.
          </p>
          <Button asChild variant="outline" size="sm" className="mt-5">
            <Link to="/dashboard">Back to dashboard</Link>
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-4">
            {items.map((a, idx) => {
              const isFreshest = page === 0 && idx === 0;
              return (
                <article
                  key={a.id}
                  className="rounded-xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
                >
                  <div className="flex items-center justify-between gap-3">
                    <time
                      dateTime={a.published_at}
                      className="text-xs text-muted-foreground"
                      title={`${formatLocalLong(a.published_at)} — exact: ${formatLocal(
                        a.published_at,
                      )}`}
                    >
                      {relativeTime(a.published_at)}
                    </time>
                    {isFreshest && <Badge>Latest</Badge>}
                  </div>
                  <h2 className="mt-2 text-lg font-semibold">{a.title}</h2>
                  <Markdown className="mt-2">{a.body}</Markdown>
                </article>
              );
            })}
          </div>

          <div className="flex items-center justify-between border-t border-border pt-4">
            <div className="text-xs text-muted-foreground">
              Page {page + 1} of {totalPages} · {total} total
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!hasPrev}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
              >
                <ChevronLeft className="mr-1 h-4 w-4" /> Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!hasNext}
                onClick={() => setPage((p) => p + 1)}
              >
                Next <ChevronRight className="ml-1 h-4 w-4" />
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
