import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, ChevronLeft, ChevronRight, Info, Loader2, Megaphone, RefreshCw, Sparkles } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { formatLocal, formatLocalLong } from "@/lib/format-datetime";
import { ensureAnnouncementsSeeded } from "@/lib/announcements.functions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

const PAGE_SIZE = 5;

type Announcement = {
  id: string;
  title: string;
  body: string;
  published_at: string;
};

type ErrorStage = "db_query" | "seed_fetch" | "db_requery";

const STAGE_LABELS: Record<ErrorStage, string> = {
  db_query: "Database query failed",
  seed_fetch: "Seed data fetch failed",
  db_requery: "Database re-query after seeding failed",
};

const STAGE_DESCRIPTIONS: Record<ErrorStage, string> = {
  db_query: "Could not read announcements from the database.",
  seed_fetch: "The table was empty and the default seed loader failed.",
  db_requery: "Seeding succeeded but reading the new rows failed.",
};

class StagedError extends Error {
  stage: ErrorStage;
  cause?: unknown;
  constructor(stage: ErrorStage, cause: unknown) {
    const msg =
      cause instanceof Error
        ? cause.message
        : typeof cause === "string"
          ? cause
          : "Unknown error";
    super(msg);
    this.name = "StagedError";
    this.stage = stage;
    this.cause = cause;
  }
}

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
  const [errorDetailsOpen, setErrorDetailsOpen] = useState(false);
  const [errorAt, setErrorAt] = useState<string | null>(null);
  const ensureSeeded = useServerFn(ensureAnnouncementsSeeded);

  const { data, isLoading, isFetching, isError, error, refetch } = useQuery({
    queryKey: ["whats-new", page],
    queryFn: async () => {
      const from = page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      let data: Announcement[] | null = null;
      let count: number | null = null;
      try {
        const res = await supabase
          .from("announcements")
          .select("*", { count: "exact" })
          .eq("status", "published")
          .order("published_at", { ascending: false })
          .range(from, to);
        if (res.error) throw res.error;
        data = res.data as Announcement[] | null;
        count = res.count;
      } catch (e) {
        setErrorAt(new Date().toISOString());
        // eslint-disable-next-line no-console
        console.error("[whats-new] failure", {
          stage: "db_query",
          stageLabel: STAGE_LABELS.db_query,
          message: (e as Error)?.message,
          page,
        });
        throw new StagedError("db_query", e);
      }
      let source: string = "database";
      let seeded = false;
      // If the very first page is empty, ask the server to backfill from the
      // default seed source, then re-query so the user sees content.
      if (page === 0 && (count ?? 0) === 0) {
        let result;
        try {
          result = await ensureSeeded();
        } catch (e) {
          setErrorAt(new Date().toISOString());
          // eslint-disable-next-line no-console
          console.error("[whats-new] failure", {
            stage: "seed_fetch",
            stageLabel: STAGE_LABELS.seed_fetch,
            message: (e as Error)?.message,
            page,
          });
          throw new StagedError("seed_fetch", e);
        }
        source = result.source;
        seeded = result.seeded;
        // eslint-disable-next-line no-console
        console.info("[whats-new] data source:", {
          source,
          seeded,
          count: result.count,
          fetchedAt: result.fetchedAt,
        });
        if (seeded) {
          try {
            const refetch = await supabase
              .from("announcements")
              .select("*", { count: "exact" })
              .eq("status", "published")
              .order("published_at", { ascending: false })
              .range(from, to);
            if (refetch.error) throw refetch.error;
            data = refetch.data as Announcement[] | null;
            count = refetch.count;
          } catch (e) {
            setErrorAt(new Date().toISOString());
            // eslint-disable-next-line no-console
            console.error("[whats-new] failure", {
              stage: "db_requery",
              stageLabel: STAGE_LABELS.db_requery,
              message: (e as Error)?.message,
              page,
            });
            throw new StagedError("db_requery", e);
          }
        }
      } else {
        // eslint-disable-next-line no-console
        console.info("[whats-new] data source:", {
          source,
          count: count ?? 0,
          fetchedAt: new Date().toISOString(),
        });
      }
      return {
        items: (data ?? []) as Announcement[],
        total: count ?? 0,
        source,
        seeded,
        fetchedAt: new Date().toISOString(),
      };
    },
    retry: 1,
  });

  const errorObj = error as (Error & { stage?: ErrorStage; cause?: unknown }) | undefined;
  const errorStage: ErrorStage | undefined = errorObj?.stage;
  const stageLabel = errorStage ? STAGE_LABELS[errorStage] : "Couldn't load announcements";
  const stageDescription = errorStage ? STAGE_DESCRIPTIONS[errorStage] : null;
  const errorName = errorObj?.name ?? "Error";
  const errorMessage = errorObj?.message ?? "Unknown error";
  const errorStack = errorObj?.stack;
  const errorJson = (() => {
    try {
      const cause = errorObj?.cause;
      const payload = {
        ...(errorObj
          ? Object.fromEntries(
              Object.getOwnPropertyNames(errorObj).map((k) => [
                k,
                (errorObj as unknown as Record<string, unknown>)[k],
              ]),
            )
          : {}),
        ...(cause && cause instanceof Error
          ? {
              cause: {
                name: cause.name,
                message: cause.message,
                stack: cause.stack,
              },
            }
          : cause !== undefined
            ? { cause }
            : {}),
      };
      return JSON.stringify(payload, null, 2);
    } catch {
      return null;
    }
  })();

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
          {data ? (
            <p className="mt-1 text-xs text-muted-foreground">
              Source:{" "}
              <code className="rounded bg-muted px-1 py-0.5 text-[10px]">
                {data.source}
              </code>
              {data.seeded ? " · seeded defaults" : ""} · fetched{" "}
              {formatLocal(data.fetchedAt)}
            </p>
          ) : null}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading announcements…
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border border-border bg-card p-6">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-3 h-5 w-3/4" />
              <Skeleton className="mt-2 h-4 w-full" />
              <Skeleton className="mt-1 h-4 w-5/6" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/40 bg-destructive/5 p-10 text-center"
        >
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-6 w-6 text-destructive" />
          </div>
          <h2 className="mt-4 text-lg font-semibold">{stageLabel}</h2>
          {errorStage ? (
            <div className="mx-auto mt-2 inline-flex items-center gap-1 rounded-full border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-destructive">
              stage: {errorStage}
            </div>
          ) : null}
          {stageDescription ? (
            <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
              {stageDescription}
            </p>
          ) : null}
          <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
            {errorMessage ||
              "The request failed. Check your connection and try again."}
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              Retry
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setErrorDetailsOpen(true)}
            >
              <Info className="mr-1 h-4 w-4" />
              View details
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard">Back to dashboard</Link>
            </Button>
          </div>
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
          <div className="mt-5 flex items-center justify-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => refetch()}
              disabled={isFetching}
            >
              {isFetching ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="mr-1 h-4 w-4" />
              )}
              Refresh
            </Button>
            <Button asChild variant="ghost" size="sm">
              <Link to="/dashboard">Back to dashboard</Link>
            </Button>
          </div>
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

      <Dialog open={errorDetailsOpen} onOpenChange={setErrorDetailsOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Error details
            </DialogTitle>
            <DialogDescription>
              Diagnostic information for the failed announcements request.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
              <span className="text-muted-foreground">Stage</span>
              <span className="font-mono text-xs">
                {errorStage ? `${errorStage} — ${STAGE_LABELS[errorStage]}` : "unknown"}
              </span>
              <span className="text-muted-foreground">Time</span>
              <span className="font-mono text-xs">
                {errorAt ? `${formatLocalLong(errorAt)} (${errorAt})` : "—"}
              </span>
              <span className="text-muted-foreground">Type</span>
              <span className="font-mono text-xs">{errorName}</span>
              <span className="text-muted-foreground">Page</span>
              <span className="font-mono text-xs">{page + 1}</span>
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-muted-foreground">
                Message
              </div>
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-xs">
                {errorMessage}
              </pre>
            </div>
            {errorStack ? (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Stack
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-[11px]">
                  {errorStack}
                </pre>
              </div>
            ) : null}
            {errorJson && errorJson !== "{}" ? (
              <div>
                <div className="mb-1 text-xs font-medium text-muted-foreground">
                  Raw
                </div>
                <pre className="max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 text-[11px]">
                  {errorJson}
                </pre>
              </div>
            ) : null}
            <div className="flex justify-end gap-2 pt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const text = [
                    `Time: ${errorAt ?? "-"}`,
                    `Type: ${errorName}`,
                    `Message: ${errorMessage}`,
                    errorStack ? `Stack:\n${errorStack}` : "",
                  ]
                    .filter(Boolean)
                    .join("\n");
                  void navigator.clipboard?.writeText(text);
                }}
              >
                Copy
              </Button>
              <Button
                size="sm"
                onClick={() => {
                  setErrorDetailsOpen(false);
                  refetch();
                }}
                disabled={isFetching}
              >
                {isFetching ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="mr-1 h-4 w-4" />
                )}
                Retry
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
