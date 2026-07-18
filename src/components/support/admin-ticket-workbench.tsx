"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import {
  AlertTriangle,
  ExternalLink,
  Inbox,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  Paperclip,
  Send,
  Tag,
  UserRoundCog,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { TicketConversation, type SupportReply } from "./ticket-conversation";
import { SlaCountdown } from "./sla-countdown";
import { supportFetch } from "@/lib/support/http.client";
import { subscribeToAdminQueue, subscribeToTicket } from "@/lib/support/realtime.client";
import type {
  SupportAgentPresence,
  SupportQueue,
  SupportTicket,
  TicketAttachment,
  TicketPriority,
  TicketStatus,
} from "@/lib/support/types";
import { cn } from "@/lib/utils";

type AdminTag = { id?: string; tag?: string };
type InternalNote = {
  id?: string;
  body?: string;
  created_at?: string;
  createdAt?: string;
};
type TicketEvent = {
  id?: string;
  event_type?: string;
  eventType?: string;
  actor_id?: string | null;
  actorId?: string | null;
  created_at?: string;
  createdAt?: string;
};
type TicketDetail = {
  ticket: SupportTicket;
  replies?: SupportReply[];
  tags?: AdminTag[];
  internalNotes?: InternalNote[];
  events?: TicketEvent[];
};
type SignedAttachment = { path: string; signedUrl: string };

const queues: Array<{ value: SupportQueue; label: string }> = [
  { value: "unassigned", label: "Unassigned" },
  { value: "mine", label: "My tickets" },
  { value: "waiting_user", label: "Waiting for user" },
  { value: "sla_due", label: "SLA due soon" },
  { value: "sla_breached", label: "SLA breached" },
  { value: "closed", label: "Closed" },
];

const priorityOptions: TicketPriority[] = ["low", "normal", "high", "urgent"];
const statusOptions: TicketStatus[] = ["open", "in_progress", "waiting_user", "resolved", "closed"];

function formatLabel(value: string) {
  return value.replaceAll("_", " ").replace(/^\w/, (letter) => letter.toUpperCase());
}

function isForbidden(error: unknown) {
  return error instanceof Error && /forbidden|administrator|403/i.test(error.message);
}

function slaState(ticket: SupportTicket) {
  if (ticket.firstRespondedAt) return null;
  if (ticket.slaBreachedAt) return "breached";
  if (!ticket.firstResponseDueAt) return null;
  const remaining = new Date(ticket.firstResponseDueAt).getTime() - Date.now();
  if (remaining <= 0) return "breached";
  return remaining <= 30 * 60_000 ? "due" : null;
}

export function AdminTicketWorkbench() {
  const [queue, setQueue] = useState<SupportQueue>("unassigned");
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [agents, setAgents] = useState<SupportAgentPresence[]>([]);
  const [transferTo, setTransferTo] = useState("");
  const [priority, setPriority] = useState<TicketPriority>("normal");
  const [status, setStatus] = useState<TicketStatus>("open");
  const [newTag, setNewTag] = useState("");
  const [note, setNote] = useState("");
  const [reply, setReply] = useState("");
  const [signedLinks, setSignedLinks] = useState<Record<string, string>>({});
  const [signingPath, setSigningPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [mutating, setMutating] = useState(false);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const detailRef = useRef<TicketDetail | null>(null);

  const loadQueue = useCallback(async (nextQueue: SupportQueue) => {
    const result = await supportFetch<{ tickets: SupportTicket[] }>(
      `/api/support/admin/tickets?queue=${nextQueue}`,
    );
    setTickets(result.tickets);
    setSelectedId((current) => {
      if (current && result.tickets.some((ticket) => ticket.id === current)) return current;
      return result.tickets[0]?.id ?? null;
    });
  }, []);

  const loadDetail = useCallback(async (ticketId: string) => {
    const result = await supportFetch<TicketDetail>(`/api/support/admin/tickets/${ticketId}`);
    setDetail(result);
    detailRef.current = result;
    setSignedLinks({});
    setTransferTo(result.ticket.assignedTo ?? "");
    setPriority(result.ticket.priority);
    setStatus(result.ticket.status);
  }, []);

  const loadAgents = useCallback(async () => {
    const result = await supportFetch<{ agents: SupportAgentPresence[] }>(
      "/api/support/admin/agents",
    );
    setAgents(result.agents);
  }, []);

  const handleLoadError = useCallback((loadError: unknown) => {
    if (isForbidden(loadError)) {
      setForbidden(true);
      return;
    }
    setError(loadError instanceof Error ? loadError.message : "Unable to load support tickets.");
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    void Promise.all([loadQueue(queue), loadAgents()])
      .catch(handleLoadError)
      .finally(() => setLoading(false));
  }, [handleLoadError, loadAgents, loadQueue, queue]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    setError(null);
    void loadDetail(selectedId).catch(handleLoadError);
  }, [handleLoadError, loadDetail, selectedId]);

  const refreshSelected = useCallback(async () => {
    const requests: Promise<unknown>[] = [loadQueue(queue)];
    if (selectedId) requests.push(loadDetail(selectedId));
    await Promise.all(requests);
  }, [loadDetail, loadQueue, queue, selectedId]);

  useEffect(
    () =>
      subscribeToAdminQueue(() => {
        void loadQueue(queue).catch(handleLoadError);
      }),
    [handleLoadError, loadQueue, queue],
  );

  useEffect(() => {
    if (!selectedId) return;
    const refreshDetail = () => {
      void loadDetail(selectedId).catch(handleLoadError);
    };
    return subscribeToTicket(selectedId, {
      onReply: refreshDetail,
      onTicket: refreshDetail,
      getLastSeenAt: () => detailRef.current?.ticket.lastReplyAt ?? new Date(0).toISOString(),
      onReconnect: refreshDetail,
    });
  }, [handleLoadError, loadDetail, selectedId]);

  async function mutate(url: string, init: RequestInit) {
    if (!selectedId || mutating) return;
    setMutating(true);
    setError(null);
    try {
      await supportFetch(url, init);
      await refreshSelected();
    } catch (mutationError) {
      handleLoadError(mutationError);
    } finally {
      setMutating(false);
    }
  }

  function patchTicket(body: Record<string, unknown>) {
    if (!selectedId) return;
    void mutate(`/api/support/admin/tickets/${selectedId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  function addTag(event: FormEvent) {
    event.preventDefault();
    const tag = newTag.trim();
    if (!selectedId || !tag) return;
    setNewTag("");
    void mutate(`/api/support/admin/tickets/${selectedId}/tags`, {
      method: "POST",
      body: JSON.stringify({ tag }),
    });
  }

  function removeTag(tag: string) {
    if (!selectedId) return;
    void mutate(`/api/support/admin/tickets/${selectedId}/tags`, {
      method: "DELETE",
      body: JSON.stringify({ tag }),
    });
  }

  function addNote(event: FormEvent) {
    event.preventDefault();
    const body = note.trim();
    if (!selectedId || !body) return;
    setNote("");
    void mutate(`/api/support/admin/tickets/${selectedId}/notes`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
  }

  function addReply(event: FormEvent) {
    event.preventDefault();
    const body = reply.trim();
    if (!selectedId || !body) return;
    setReply("");
    void mutate(`/api/support/tickets/${selectedId}/replies`, {
      method: "POST",
      body: JSON.stringify({ body, attachments: [] }),
    });
  }

  async function openAttachment(attachment: TicketAttachment) {
    if (!selectedId || signingPath) return;
    setSigningPath(attachment.path);
    setError(null);
    try {
      const result = await supportFetch<{ attachments: SignedAttachment[] }>(
        `/api/support/tickets/${selectedId}/attachments`,
        {
          method: "POST",
          body: JSON.stringify({ paths: [attachment.path] }),
        },
      );
      const signed = result.attachments.find((item) => item.path === attachment.path);
      if (signed) {
        setSignedLinks((current) => ({ ...current, [attachment.path]: signed.signedUrl }));
      }
    } catch (attachmentError) {
      handleLoadError(attachmentError);
    } finally {
      setSigningPath(null);
    }
  }

  const activeAgents = useMemo(() => agents.filter((agent) => agent.status === "online"), [agents]);
  const attachments = useMemo(() => {
    if (!detail) return [];
    return [
      ...detail.ticket.attachments,
      ...(detail.replies ?? []).flatMap((item) => item.attachments ?? []),
    ];
  }, [detail]);

  if (forbidden) {
    return (
      <div data-admin-forbidden="true" className="rounded-xl border bg-card px-6 py-12 text-center">
        <LockKeyhole className="mx-auto h-9 w-9 text-muted-foreground" aria-hidden="true" />
        <h2 className="mt-4 text-lg font-semibold">Administrator access required</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Your account is signed in, but it does not have permission to open the support workbench.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="overflow-x-auto border-b" aria-label="Support queues">
        <div className="flex min-w-max gap-1 p-2" role="tablist">
          {queues.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={queue === item.value}
              onClick={() => setQueue(item.value)}
              className={cn(
                "rounded-md px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                queue === item.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {error ? (
        <p
          className="m-4 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      <div className="grid min-h-[40rem] lg:grid-cols-[21rem_minmax(0,1fr)]">
        <section className="border-b lg:border-b-0 lg:border-r" aria-label="Ticket queue">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="font-semibold">{queues.find((item) => item.value === queue)?.label}</h2>
            <span className="text-xs text-muted-foreground">{tickets.length} tickets</span>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Loading queue...
            </div>
          ) : tickets.length ? (
            <ul className="max-h-[26rem] overflow-y-auto lg:max-h-[46rem]">
              {tickets.map((ticket) => {
                const state = slaState(ticket);
                return (
                  <li key={ticket.id} className="border-b last:border-b-0">
                    <button
                      type="button"
                      data-ticket-id={ticket.id}
                      aria-pressed={selectedId === ticket.id}
                      onClick={() => setSelectedId(ticket.id)}
                      className={cn(
                        "w-full space-y-2 px-4 py-4 text-left hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
                        selectedId === ticket.id && "bg-muted",
                      )}
                    >
                      <span className="block text-sm font-medium">{ticket.title}</span>
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline">{formatLabel(ticket.priority)}</Badge>
                        {state === "due" ? (
                          <Badge className="border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-50">
                            Due soon
                          </Badge>
                        ) : null}
                        {state === "breached" ? (
                          <Badge variant="destructive">Breached</Badge>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="grid place-items-center gap-2 px-5 py-12 text-center">
              <Inbox className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              <p className="text-sm font-medium">Queue is clear</p>
            </div>
          )}
        </section>

        <section className="min-w-0" aria-label="Admin ticket detail">
          {detail ? (
            <>
              <header className="space-y-4 border-b p-4 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">
                      #{detail.ticket.id.slice(0, 8).toUpperCase()}
                    </p>
                    <h2 className="mt-1 text-xl font-semibold">{detail.ticket.title}</h2>
                  </div>
                  {!detail.ticket.firstRespondedAt ? (
                    <SlaCountdown dueAt={detail.ticket.firstResponseDueAt} />
                  ) : null}
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <label className="space-y-1 text-xs font-medium">
                    Transfer
                    <select
                      aria-label="Transfer ticket"
                      value={transferTo}
                      onChange={(event) => setTransferTo(event.target.value)}
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      <option value="">Unassigned</option>
                      {activeAgents.map((agent) => (
                        <option key={agent.agentId} value={agent.agentId}>
                          {agent.agentId}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-action="transfer"
                      disabled={mutating}
                      onClick={() =>
                        patchTicket({ action: "transfer", assignedTo: transferTo || null })
                      }
                    >
                      <UserRoundCog aria-hidden="true" />
                      Apply
                    </Button>
                  </label>

                  <label className="space-y-1 text-xs font-medium">
                    Priority
                    <select
                      aria-label="Set priority"
                      value={priority}
                      onChange={(event) => setPriority(event.target.value as TicketPriority)}
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      {priorityOptions.map((option) => (
                        <option key={option} value={option}>
                          {formatLabel(option)}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-action="priority"
                      disabled={mutating}
                      onClick={() => patchTicket({ action: "priority", priority })}
                    >
                      <AlertTriangle aria-hidden="true" />
                      Apply
                    </Button>
                  </label>

                  <label className="space-y-1 text-xs font-medium">
                    Status
                    <select
                      aria-label="Set status"
                      value={status}
                      onChange={(event) => setStatus(event.target.value as TicketStatus)}
                      className="h-9 w-full rounded-md border bg-background px-2 text-sm"
                    >
                      {statusOptions.map((option) => (
                        <option key={option} value={option}>
                          {formatLabel(option)}
                        </option>
                      ))}
                    </select>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      data-action="status"
                      disabled={mutating}
                      onClick={() => patchTicket({ action: "status", status })}
                    >
                      Apply
                    </Button>
                  </label>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {(detail.tags ?? []).map((item) =>
                    item.tag ? (
                      <button
                        key={item.id ?? item.tag}
                        type="button"
                        onClick={() => removeTag(item.tag!)}
                        className="rounded-full border bg-muted px-2.5 py-1 text-xs hover:border-destructive hover:text-destructive"
                        aria-label={`Remove tag ${item.tag}`}
                      >
                        {item.tag} ×
                      </button>
                    ) : null,
                  )}
                  <form className="flex gap-2" onSubmit={addTag}>
                    <Input
                      aria-label="New tag"
                      value={newTag}
                      onChange={(event) => setNewTag(event.target.value)}
                      placeholder="Add tag"
                      className="h-8 w-32"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      variant="outline"
                      data-action="add-tag"
                      disabled={mutating || !newTag.trim()}
                    >
                      <Tag aria-hidden="true" />
                      Add
                    </Button>
                  </form>
                </div>

                <section
                  data-testid="ticket-context"
                  className="grid gap-3 rounded-lg border bg-muted/30 p-3 text-xs sm:grid-cols-2"
                  aria-label="Ticket user and correlation context"
                >
                  <div>
                    <p className="font-semibold text-foreground">User context</p>
                    <p className="mt-1 break-all text-muted-foreground">
                      User ID: {detail.ticket.userId}
                    </p>
                    <p className="text-muted-foreground">
                      Source: {formatLabel(detail.ticket.source)}
                    </p>
                  </div>
                  <div>
                    <p className="font-semibold text-foreground">Correlation IDs</p>
                    <p className="mt-1 break-all text-muted-foreground">
                      Sentry: {detail.ticket.sentryEventId ?? "Not provided"}
                    </p>
                    <p className="break-all text-muted-foreground">
                      MCP request: {detail.ticket.mcpRequestId ?? "Not provided"}
                    </p>
                  </div>
                </section>

                {attachments.length ? (
                  <section aria-label="Ticket attachments">
                    <p className="text-xs font-semibold">Attachments</p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {attachments.map((attachment, index) => {
                        const signedUrl = signedLinks[attachment.path];
                        return (
                          <li key={`${attachment.name}-${index}`}>
                            {signedUrl ? (
                              <a
                                href={signedUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                              >
                                <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                                {attachment.name}
                                <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              </a>
                            ) : (
                              <button
                                type="button"
                                onClick={() => void openAttachment(attachment)}
                                disabled={signingPath !== null}
                                className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                              >
                                <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
                                {attachment.name}
                              </button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ) : null}
              </header>

              <TicketConversation ticket={detail.ticket} replies={detail.replies ?? []} />

              <form className="space-y-2 border-t p-4 sm:p-6" onSubmit={addReply}>
                <Textarea
                  aria-label="Reply to user"
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder="Write a reply visible to the user"
                  className="min-h-24"
                />
                <Button
                  type="submit"
                  data-action="reply"
                  disabled={mutating || !reply.trim() || detail.ticket.status === "closed"}
                >
                  <Send aria-hidden="true" />
                  Reply to user
                </Button>
              </form>

              <section
                data-testid="ticket-events"
                className="border-t p-4 sm:p-6"
                aria-labelledby="ticket-events-title"
              >
                <h3 id="ticket-events-title" className="text-sm font-semibold">
                  Event timeline
                </h3>
                <ol className="mt-3 space-y-2">
                  {(detail.events ?? []).map((item, index) => {
                    const eventType = item.event_type ?? item.eventType ?? "ticket_event";
                    const actor = item.actor_id ?? item.actorId;
                    const createdAt = item.created_at ?? item.createdAt;
                    return (
                      <li key={item.id ?? index} className="rounded-md border p-3 text-xs">
                        <p className="font-medium">{formatLabel(eventType)}</p>
                        {actor ? (
                          <p className="mt-1 break-all text-muted-foreground">Actor: {actor}</p>
                        ) : null}
                        {createdAt ? (
                          <time className="text-muted-foreground" dateTime={createdAt}>
                            {new Date(createdAt).toLocaleString()}
                          </time>
                        ) : null}
                      </li>
                    );
                  })}
                </ol>
              </section>

              <aside
                data-testid="internal-notes"
                className="border-t border-amber-300 bg-amber-50/70 p-4 text-amber-950 sm:p-6 dark:bg-amber-950/20 dark:text-amber-100"
                aria-labelledby="internal-notes-title"
              >
                <div className="flex items-center gap-2">
                  <MessageSquareText className="h-4 w-4" aria-hidden="true" />
                  <h3 id="internal-notes-title" className="text-sm font-semibold">
                    Internal notes
                  </h3>
                  <Badge
                    variant="outline"
                    className="border-amber-400 text-amber-800 dark:text-amber-200"
                  >
                    Staff only
                  </Badge>
                </div>
                <ul className="mt-3 space-y-2">
                  {(detail.internalNotes ?? []).map((item, index) => (
                    <li
                      key={item.id ?? index}
                      className="rounded-md border border-amber-200 bg-background/70 p-3 text-sm"
                    >
                      {item.body}
                    </li>
                  ))}
                </ul>
                <form className="mt-3 space-y-2" onSubmit={addNote}>
                  <Textarea
                    aria-label="Internal note"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    placeholder="Visible to administrators only"
                    className="min-h-20 bg-background"
                  />
                  <Button type="submit" size="sm" disabled={mutating || !note.trim()}>
                    Add internal note
                  </Button>
                </form>
              </aside>
            </>
          ) : (
            <div className="grid min-h-[30rem] place-items-center p-8 text-center">
              <div>
                <Inbox className="mx-auto h-8 w-8 text-muted-foreground" aria-hidden="true" />
                <p className="mt-3 text-sm font-medium">Select a ticket</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Assignment, conversation, and staff-only notes will appear here.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
