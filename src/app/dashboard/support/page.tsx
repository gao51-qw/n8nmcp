"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Inbox, Loader2, Search, Send, UserRound } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TicketConversation, type SupportReply } from "@/components/support/ticket-conversation";
import { supportFetch } from "@/lib/support/http.client";
import { subscribeToTicket } from "@/lib/support/realtime.client";
import type { SupportTicket, TicketStatus } from "@/lib/support/types";
import { cn } from "@/lib/utils";

type TicketListResponse = { tickets: SupportTicket[] };
type TicketDetailResponse = { ticket: SupportTicket; replies?: SupportReply[] };
type StatusFilter = TicketStatus | "all";

const statusOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "All statuses" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In progress" },
  { value: "waiting_user", label: "Waiting for you" },
  { value: "resolved", label: "Resolved" },
  { value: "closed", label: "Closed" },
];

const statusLabels: Record<TicketStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  waiting_user: "Waiting for you",
  resolved: "Resolved",
  closed: "Closed",
};

function listUrl(status: StatusFilter, search: string) {
  const params = new URLSearchParams();
  if (status !== "all") params.set("status", status);
  if (search.trim()) params.set("search", search.trim());
  const query = params.toString();
  return `/api/support/tickets${query ? `?${query}` : ""}`;
}

function formatDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export default function SupportHistoryPage() {
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetailResponse | null>(null);
  const [status, setStatus] = useState<StatusFilter>("all");
  const [search, setSearch] = useState("");
  const [appliedSearch, setAppliedSearch] = useState("");
  const [reply, setReply] = useState("");
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastSeenAt = useRef(new Date().toISOString());
  const selectedIdRef = useRef<string | null>(null);
  const detailRequestRef = useRef<{ sequence: number; controller: AbortController | null }>({
    sequence: 0,
    controller: null,
  });
  selectedIdRef.current = selectedId;

  const loadList = useCallback(async (nextStatus: StatusFilter, nextSearch: string) => {
    const result = await supportFetch<TicketListResponse>(listUrl(nextStatus, nextSearch));
    setTickets(result.tickets);
    setSelectedId((current) => {
      if (current && result.tickets.some((ticket) => ticket.id === current)) return current;
      return result.tickets[0]?.id ?? null;
    });
  }, []);

  const loadDetail = useCallback(async (ticketId: string) => {
    detailRequestRef.current.controller?.abort();
    const controller = new AbortController();
    const sequence = detailRequestRef.current.sequence + 1;
    detailRequestRef.current = { sequence, controller };
    setLoadingDetail(true);
    try {
      const result = await supportFetch<TicketDetailResponse>(`/api/support/tickets/${ticketId}`, {
        signal: controller.signal,
      });
      if (detailRequestRef.current.sequence !== sequence || selectedIdRef.current !== ticketId) {
        return;
      }
      setDetail(result);
      lastSeenAt.current = result.ticket.lastReplyAt || new Date().toISOString();
    } catch (loadError) {
      if (controller.signal.aborted || detailRequestRef.current.sequence !== sequence) return;
      throw loadError;
    } finally {
      if (detailRequestRef.current.sequence === sequence) {
        setLoadingDetail(false);
      }
    }
  }, []);

  const refetchSelected = useCallback(async () => {
    const requests: Promise<unknown>[] = [loadList(status, appliedSearch)];
    if (selectedId) requests.push(loadDetail(selectedId));
    await Promise.all(requests);
  }, [appliedSearch, loadDetail, loadList, selectedId, status]);

  useEffect(() => {
    setLoadingList(true);
    setError(null);
    void loadList(status, appliedSearch)
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : "Unable to load tickets."),
      )
      .finally(() => setLoadingList(false));
  }, [appliedSearch, loadList, status]);

  useEffect(() => {
    if (!selectedId) {
      detailRequestRef.current.controller?.abort();
      setDetail(null);
      return;
    }
    setDetail(null);
    setError(null);
    void loadDetail(selectedId).catch((loadError) =>
      setError(loadError instanceof Error ? loadError.message : "Unable to load this ticket."),
    );
  }, [loadDetail, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    const invalidate = () => {
      void refetchSelected().catch(() => undefined);
    };
    return subscribeToTicket(selectedId, {
      onReply: invalidate,
      onTicket: invalidate,
      getLastSeenAt: () => lastSeenAt.current,
      onReconnect: invalidate,
    });
  }, [refetchSelected, selectedId]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void refetchSelected().catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(timer);
  }, [refetchSelected]);

  function applyFilters(event: FormEvent) {
    event.preventDefault();
    setAppliedSearch(search.trim());
  }

  async function submitReply(event: FormEvent) {
    event.preventDefault();
    const body = reply.trim();
    if (
      !selectedId ||
      !detail ||
      detail.ticket.id !== selectedId ||
      detail.ticket.status === "closed" ||
      !body ||
      sending
    ) {
      return;
    }

    const submitTicketId = selectedId;
    setSending(true);
    setError(null);
    try {
      await supportFetch(`/api/support/tickets/${submitTicketId}/replies`, {
        method: "POST",
        body: JSON.stringify({ body, attachments: [] }),
      });
      setReply("");
    } catch (replyError) {
      setError(replyError instanceof Error ? replyError.message : "Unable to send reply.");
    } finally {
      try {
        const requests: Promise<unknown>[] = [loadList(status, appliedSearch)];
        if (selectedIdRef.current === submitTicketId) {
          requests.push(loadDetail(submitTicketId));
        }
        await Promise.all(requests);
      } catch (refreshError) {
        setError(
          refreshError instanceof Error ? refreshError.message : "Unable to refresh this ticket.",
        );
      }
      setSending(false);
    }
  }

  return (
    <main id="main" className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:py-14">
      <div className="max-w-3xl">
        <p className="text-sm font-semibold text-primary">Support</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Your support tickets</h1>
        <p className="mt-3 text-muted-foreground">
          Review previous requests, follow agent replies, and continue open conversations.
        </p>
      </div>

      <form
        className="mt-8 grid gap-3 rounded-xl border bg-card p-4 sm:grid-cols-[12rem_1fr_auto]"
        onSubmit={applyFilters}
      >
        <label>
          <span className="sr-only">Status</span>
          <select
            aria-label="Filter tickets by status"
            value={status}
            onChange={(event) => setStatus(event.target.value as StatusFilter)}
            className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="relative">
          <span className="sr-only">Search tickets</span>
          <Search
            className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            aria-label="Search tickets"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search title or description"
            className="pl-9"
          />
        </label>
        <Button type="submit" variant="outline">
          Search
        </Button>
      </form>

      {error ? (
        <p
          className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="mt-6 grid min-h-[34rem] overflow-hidden rounded-xl border bg-card lg:grid-cols-[21rem_1fr]">
        <section className="border-b lg:border-b-0 lg:border-r" aria-labelledby="ticket-list-title">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 id="ticket-list-title" className="font-semibold">
              Tickets
            </h2>
            <span className="text-xs text-muted-foreground">{tickets.length} total</span>
          </div>
          {loadingList ? (
            <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading tickets...
            </div>
          ) : tickets.length ? (
            <ul className="max-h-[20rem] overflow-y-auto lg:max-h-[40rem]">
              {tickets.map((ticket) => (
                <li key={ticket.id} className="border-b last:border-b-0">
                  <button
                    type="button"
                    data-ticket-id={ticket.id}
                    aria-pressed={selectedId === ticket.id}
                    onClick={() => {
                      selectedIdRef.current = ticket.id;
                      setDetail(null);
                      setSelectedId(ticket.id);
                    }}
                    className={cn(
                      "w-full px-4 py-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                      selectedId === ticket.id && "bg-muted",
                    )}
                  >
                    <span className="flex items-start justify-between gap-3">
                      <span className="line-clamp-2 text-sm font-medium">{ticket.title}</span>
                      <Badge variant="outline" className="shrink-0 font-normal">
                        {statusLabels[ticket.status]}
                      </Badge>
                    </span>
                    <span className="mt-2 block text-xs text-muted-foreground">
                      #{ticket.id.slice(0, 8).toUpperCase()} - {formatDate(ticket.lastReplyAt)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="grid place-items-center gap-2 px-5 py-12 text-center">
              <Inbox className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">No tickets found</p>
              <p className="text-xs text-muted-foreground">Try another status or search term.</p>
            </div>
          )}
        </section>

        <section className="flex min-w-0 flex-col" aria-label="Ticket detail">
          {loadingDetail && !detail ? (
            <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading ticket...
            </div>
          ) : detail ? (
            <>
              <header className="space-y-3 border-b px-4 py-4 sm:px-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold">{detail.ticket.title}</h2>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Created {formatDate(detail.ticket.createdAt)}
                    </p>
                  </div>
                  <Badge variant="outline">{statusLabels[detail.ticket.status]}</Badge>
                </div>
                <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
                  <span className="inline-flex items-center gap-1.5">
                    <UserRound className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                    <span className="text-muted-foreground">Assigned agent:</span>{" "}
                    {detail.ticket.assignedTo ? "Assigned" : "Unassigned"}
                  </span>
                  {detail.ticket.firstRespondedAt ? (
                    <span className="text-muted-foreground">First response received</span>
                  ) : (
                    <span className="text-muted-foreground">SLA shown in conversation</span>
                  )}
                </div>
                {detail.ticket.sentryEventId || detail.ticket.mcpRequestId ? (
                  <div className="rounded-md bg-muted/60 px-3 py-2 text-xs">
                    <span className="font-medium">Correlation IDs</span>
                    {detail.ticket.sentryEventId ? (
                      <span className="ml-3 text-muted-foreground">
                        Sentry: {detail.ticket.sentryEventId}
                      </span>
                    ) : null}
                    {detail.ticket.mcpRequestId ? (
                      <span className="ml-3 text-muted-foreground">
                        MCP: {detail.ticket.mcpRequestId}
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </header>

              <TicketConversation ticket={detail.ticket} replies={detail.replies ?? []} />

              {detail.ticket.status === "closed" ? (
                <p className="border-t bg-muted/30 px-4 py-4 text-sm text-muted-foreground sm:px-6">
                  This ticket is closed. Create a new ticket if you need more help.
                </p>
              ) : (
                <form className="space-y-3 border-t p-4 sm:p-6" onSubmit={submitReply}>
                  <label htmlFor="ticket-reply" className="text-sm font-medium">
                    Reply
                  </label>
                  <Textarea
                    id="ticket-reply"
                    value={reply}
                    onChange={(event) => setReply(event.target.value)}
                    disabled={sending}
                    placeholder="Add context or answer the support agent..."
                    className="min-h-24"
                  />
                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      disabled={sending || !reply.trim() || selectedId !== detail.ticket.id}
                    >
                      {sending ? (
                        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Send className="h-4 w-4" aria-hidden="true" />
                      )}
                      Send reply
                    </Button>
                  </div>
                </form>
              )}
            </>
          ) : (
            <div className="grid flex-1 place-items-center px-6 py-16 text-center">
              <div>
                <Inbox className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">Select a ticket</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Its conversation and current support status will appear here.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
