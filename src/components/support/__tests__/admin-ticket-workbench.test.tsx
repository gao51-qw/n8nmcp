// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SubscribeToAdminQueue = (onInvalidate: () => void) => () => void;
type SubscribeToTicket = (
  ticketId: string,
  handlers: {
    onReply: () => void;
    onTicket: () => void;
    getLastSeenAt: () => string;
    onReconnect: (lastSeenAt: string) => void;
  },
) => () => void;

const mocks = vi.hoisted(() => ({
  supportFetch: vi.fn(),
  subscribeToAdminQueue: vi.fn<SubscribeToAdminQueue>(() => vi.fn()),
  subscribeToTicket: vi.fn<SubscribeToTicket>(() => vi.fn()),
  conversationProps: vi.fn(),
}));

vi.mock("@/lib/support/http.client", () => ({
  supportFetch: mocks.supportFetch,
}));

vi.mock("@/lib/support/realtime.client", () => ({
  subscribeToAdminQueue: mocks.subscribeToAdminQueue,
  subscribeToTicket: mocks.subscribeToTicket,
}));

vi.mock("@/components/support/ticket-conversation", () => ({
  TicketConversation: (props: unknown) => {
    mocks.conversationProps(props);
    return <div data-testid="ticket-conversation">Customer conversation</div>;
  },
}));

import { AdminAgentHeartbeat } from "../admin-agent-heartbeat";
import { AdminTicketWorkbench } from "../admin-ticket-workbench";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ticketId = "20000000-0000-4000-8000-000000000002";
const agentId = "30000000-0000-4000-8000-000000000003";

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: ticketId,
    userId: "10000000-0000-4000-8000-000000000001",
    title: "Workflow execution failed",
    description: "The scheduled workflow stopped.",
    category: "bug",
    priority: "high",
    status: "open",
    source: "ticket_form",
    assignedTo: null,
    attachments: [],
    firstResponseDueAt: "2026-06-12T10:20:00.000Z",
    firstRespondedAt: null,
    resolvedDueAt: null,
    slaBreachedAt: null,
    sentryEventId: "sentry-123",
    mcpRequestId: "mcp-456",
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z",
    lastReplyAt: "2026-06-12T10:00:00.000Z",
    ...overrides,
  };
}

function detail(overrides: Record<string, unknown> = {}) {
  return {
    ticket: ticket(overrides),
    replies: [
      {
        id: "reply-1",
        body: "Customer reply",
        is_admin: false,
        created_at: "2026-06-12T10:05:00.000Z",
        attachments: [
          {
            path: `${ticket().userId}/${ticketId}/private-storage-name.txt`,
            name: "diagnostic.txt",
            size: 120,
            expiresAt: "2026-12-09T10:05:00.000Z",
          },
        ],
      },
    ],
    tags: [{ id: "tag-1", tag: "billing" }],
    internalNotes: [{ id: "note-1", body: "Refund needs approval." }],
    events: [
      {
        id: "event-1",
        event_type: "priority_changed",
        actor_id: agentId,
        created_at: "2026-06-12T10:06:00.000Z",
        payload: { previous: "normal", next: "high", secret: "do-not-render" },
      },
    ],
  };
}

async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  await act(async () => undefined);
  return { host, root };
}

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await act(async () => undefined);
}

async function change(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
) {
  await act(async () => {
    const prototype =
      element instanceof HTMLSelectElement
        ? HTMLSelectElement.prototype
        : element instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(
      new Event(element instanceof HTMLSelectElement ? "change" : "input", {
        bubbles: true,
      }),
    );
  });
}

describe("admin agent heartbeat", () => {
  const roots: Root[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.supportFetch.mockResolvedValue({ assignedCount: 0 });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });

  afterEach(async () => {
    for (const root of roots) await act(async () => root.unmount());
    roots.length = 0;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it("heartbeats on mount and every 30 seconds while visible", async () => {
    const view = await render(<AdminAgentHeartbeat />);
    roots.push(view.root);

    expect(mocks.supportFetch).toHaveBeenCalledTimes(1);
    expect(mocks.supportFetch).toHaveBeenCalledWith("/api/support/admin/heartbeat", {
      method: "POST",
    });

    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.supportFetch).toHaveBeenCalledTimes(3);
  });

  it("pauses while hidden and resumes immediately when visible", async () => {
    const view = await render(<AdminAgentHeartbeat />);
    roots.push(view.root);
    mocks.supportFetch.mockClear();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await act(async () => vi.advanceTimersByTimeAsync(60_000));
    expect(mocks.supportFetch).not.toHaveBeenCalled();

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(mocks.supportFetch).toHaveBeenCalledTimes(1);
  });
});

describe("admin ticket workbench", () => {
  const roots: Root[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T10:00:00.000Z"));
    mocks.subscribeToAdminQueue.mockImplementation(() => vi.fn());
    mocks.subscribeToTicket.mockImplementation(() => vi.fn());
    mocks.supportFetch.mockImplementation((url: string) => {
      if (url === "/api/support/admin/agents") {
        return Promise.resolve({
          agents: [
            {
              agentId,
              status: "online",
              lastHeartbeatAt: "2026-06-12T10:00:00.000Z",
              lastAssignedAt: null,
              updatedAt: "2026-06-12T10:00:00.000Z",
            },
          ],
        });
      }
      if (url.startsWith("/api/support/admin/tickets?")) {
        return Promise.resolve({ tickets: [ticket()] });
      }
      return Promise.resolve(detail());
    });
  });

  afterEach(async () => {
    for (const root of roots) await act(async () => root.unmount());
    roots.length = 0;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  it.each([
    ["My tickets", "mine"],
    ["Waiting for user", "waiting_user"],
    ["SLA due soon", "sla_due"],
    ["SLA breached", "sla_breached"],
    ["Closed", "closed"],
    ["Unassigned", "unassigned"],
  ])("filters the %s tab with the %s queue", async (label, queue) => {
    const view = await render(<AdminTicketWorkbench />);
    roots.push(view.root);
    if (queue === "unassigned") {
      expect(mocks.supportFetch).toHaveBeenCalledWith(
        "/api/support/admin/tickets?queue=unassigned",
      );
      return;
    }
    mocks.supportFetch.mockClear();

    await click(
      Array.from(view.host.querySelectorAll("button")).find((item) => item.textContent === label) ??
        null,
    );

    expect(mocks.supportFetch).toHaveBeenCalledWith(`/api/support/admin/tickets?queue=${queue}`);
  });

  it("distinguishes due-soon and breached SLA tickets", async () => {
    mocks.supportFetch.mockImplementation((url: string) => {
      if (url === "/api/support/admin/agents") return Promise.resolve({ agents: [] });
      if (url.startsWith("/api/support/admin/tickets?")) {
        return Promise.resolve({
          tickets: [
            ticket(),
            ticket({
              id: "40000000-0000-4000-8000-000000000004",
              title: "Breached ticket",
              firstResponseDueAt: "2026-06-12T09:45:00.000Z",
              slaBreachedAt: "2026-06-12T09:45:00.000Z",
            }),
          ],
        });
      }
      return Promise.resolve(detail());
    });
    const view = await render(<AdminTicketWorkbench />);
    roots.push(view.root);

    expect(view.host.textContent).toContain("Due soon");
    expect(view.host.textContent).toContain("Breached");
    expect(view.host.querySelector('[data-sla-state="due-soon"]')).not.toBeNull();
  });

  it("hides first-response SLA state after the ticket has received a response", async () => {
    const respondedTicket = ticket({
      firstRespondedAt: "2026-06-12T09:50:00.000Z",
      firstResponseDueAt: "2026-06-12T09:45:00.000Z",
      slaBreachedAt: "2026-06-12T09:45:00.000Z",
    });
    mocks.supportFetch.mockImplementation((url: string) => {
      if (url === "/api/support/admin/agents") return Promise.resolve({ agents: [] });
      if (url.startsWith("/api/support/admin/tickets?")) {
        return Promise.resolve({ tickets: [respondedTicket] });
      }
      return Promise.resolve({ ...detail(), ticket: respondedTicket });
    });
    const view = await render(<AdminTicketWorkbench />);
    roots.push(view.root);

    expect(view.host.querySelector("[data-sla-state]")).toBeNull();
    expect(view.host.textContent).not.toContain("Breached");
  });

  it.each([
    ["Transfer ticket", "transfer", { action: "transfer", assignedTo: agentId }],
    ["Set priority", "priority", { action: "priority", priority: "urgent" }],
  ])("refreshes queue and selected detail after %s", async (label, field, body) => {
    const view = await render(<AdminTicketWorkbench />);
    roots.push(view.root);
    const select = view.host.querySelector(`select[aria-label="${label}"]`) as HTMLSelectElement;
    await change(select, field === "transfer" ? agentId : "urgent");
    mocks.supportFetch.mockClear();

    await click(view.host.querySelector(`button[data-action="${field}"]`));

    expect(mocks.supportFetch).toHaveBeenCalledWith(
      `/api/support/admin/tickets/${ticketId}`,
      expect.objectContaining({ method: "PATCH", body: JSON.stringify(body) }),
    );
    expect(mocks.supportFetch).toHaveBeenCalledWith("/api/support/admin/tickets?queue=unassigned");
    expect(mocks.supportFetch).toHaveBeenCalledWith(`/api/support/admin/tickets/${ticketId}`);
  });

  it("refreshes queue and selected detail after adding a tag", async () => {
    const view = await render(<AdminTicketWorkbench />);
    roots.push(view.root);
    await change(view.host.querySelector('input[aria-label="New tag"]') as HTMLInputElement, "vip");
    mocks.supportFetch.mockClear();

    await click(view.host.querySelector('button[data-action="add-tag"]'));

    expect(mocks.supportFetch).toHaveBeenCalledWith(
      `/api/support/admin/tickets/${ticketId}/tags`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ tag: "vip" }),
      }),
    );
    expect(mocks.supportFetch).toHaveBeenCalledWith("/api/support/admin/tickets?queue=unassigned");
    expect(mocks.supportFetch).toHaveBeenCalledWith(`/api/support/admin/tickets/${ticketId}`);
  });

  it("posts an administrator reply through the existing replies API and refreshes", async () => {
    const view = await render(<AdminTicketWorkbench />);
    roots.push(view.root);
    const replyInput = view.host.querySelector(
      'textarea[aria-label="Reply to user"]',
    ) as HTMLTextAreaElement | null;
    expect(replyInput).not.toBeNull();
    await change(replyInput!, "We are investigating this now.");
    mocks.supportFetch.mockClear();

    await click(view.host.querySelector('button[data-action="reply"]'));

    expect(mocks.supportFetch).toHaveBeenCalledWith(
      `/api/support/tickets/${ticketId}/replies`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          body: "We are investigating this now.",
          attachments: [],
        }),
      }),
    );
    expect(mocks.supportFetch).toHaveBeenCalledWith("/api/support/admin/tickets?queue=unassigned");
    expect(mocks.supportFetch).toHaveBeenCalledWith(`/api/support/admin/tickets/${ticketId}`);
  });

  it("refreshes only the queue for queue invalidation and only detail for ticket changes", async () => {
    const view = await render(<AdminTicketWorkbench />);
    roots.push(view.root);
    expect(mocks.subscribeToTicket).toHaveBeenCalledWith(
      ticketId,
      expect.objectContaining({
        onReply: expect.any(Function),
        onTicket: expect.any(Function),
      }),
    );

    const queueInvalidate = mocks.subscribeToAdminQueue.mock.calls.at(-1)?.[0];
    const ticketHandlers = mocks.subscribeToTicket.mock.calls.at(-1)?.[1];
    expect(queueInvalidate).toBeDefined();
    expect(ticketHandlers).toBeDefined();
    if (!queueInvalidate || !ticketHandlers) {
      throw new Error("Expected realtime subscriptions to be registered");
    }

    mocks.supportFetch.mockClear();
    await act(async () => queueInvalidate());
    await act(async () => undefined);
    expect(mocks.supportFetch).toHaveBeenCalledWith("/api/support/admin/tickets?queue=unassigned");
    expect(mocks.supportFetch).not.toHaveBeenCalledWith(`/api/support/admin/tickets/${ticketId}`);

    mocks.supportFetch.mockClear();
    await act(async () => ticketHandlers.onReply());
    await act(async () => ticketHandlers.onTicket());
    expect(mocks.supportFetch).not.toHaveBeenCalledWith(
      "/api/support/admin/tickets?queue=unassigned",
    );
    expect(mocks.supportFetch).toHaveBeenCalledWith(`/api/support/admin/tickets/${ticketId}`);
  });

  it("shows safe user context, correlation IDs, and an event timeline without event payloads", async () => {
    const view = await render(<AdminTicketWorkbench />);
    roots.push(view.root);

    const context = view.host.querySelector('[data-testid="ticket-context"]');
    expect(context?.textContent).toContain(ticket().userId);
    expect(context?.textContent).toContain("sentry-123");
    expect(context?.textContent).toContain("mcp-456");
    const timeline = view.host.querySelector('[data-testid="ticket-events"]');
    expect(timeline?.textContent).toContain("Priority changed");
    expect(timeline?.textContent).toContain(agentId);
    expect(timeline?.textContent).not.toContain("do-not-render");
  });

  it("gets attachment links from the signing API and never renders storage paths", async () => {
    const storagePath = `${ticket().userId}/${ticketId}/private-storage-name.txt`;
    mocks.supportFetch.mockImplementation((url: string) => {
      if (url === "/api/support/admin/agents") return Promise.resolve({ agents: [] });
      if (url.startsWith("/api/support/admin/tickets?")) {
        return Promise.resolve({ tickets: [ticket()] });
      }
      if (url.endsWith("/attachments")) {
        return Promise.resolve({
          attachments: [{ path: storagePath, signedUrl: "https://storage.test/signed-token" }],
        });
      }
      return Promise.resolve(detail());
    });
    const view = await render(<AdminTicketWorkbench />);
    roots.push(view.root);

    expect(view.host.innerHTML).not.toContain(storagePath);
    await click(
      Array.from(view.host.querySelectorAll("button")).find(
        (button) => button.textContent === "diagnostic.txt",
      ) ?? null,
    );

    expect(mocks.supportFetch).toHaveBeenCalledWith(
      `/api/support/tickets/${ticketId}/attachments`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ paths: [storagePath] }),
      }),
    );
    const link = view.host.querySelector(
      'a[href="https://storage.test/signed-token"]',
    ) as HTMLAnchorElement | null;
    expect(link?.textContent).toContain("diagnostic.txt");
    expect(view.host.innerHTML).not.toContain(storagePath);
  });

  it("renders internal notes separately and never passes them to TicketConversation", async () => {
    const view = await render(<AdminTicketWorkbench />);
    roots.push(view.root);

    expect(view.host.querySelector('[data-testid="internal-notes"]')?.textContent).toContain(
      "Refund needs approval.",
    );
    expect(
      view.host.querySelector('[data-testid="ticket-conversation"]')?.textContent,
    ).not.toContain("Refund needs approval.");
    const lastProps = mocks.conversationProps.mock.calls.at(-1)?.[0] as {
      replies: Array<{ body?: string }>;
    };
    expect(lastProps.replies.map((reply) => reply.body)).not.toContain("Refund needs approval.");
  });

  it("shows a friendly access message for API 403 responses", async () => {
    mocks.supportFetch.mockRejectedValue(new Error("Forbidden"));
    const view = await render(<AdminTicketWorkbench />);
    roots.push(view.root);

    expect(view.host.querySelector("[data-admin-forbidden=true]")).not.toBeNull();
    expect(view.host.textContent).toContain("Administrator access required");
  });
});
