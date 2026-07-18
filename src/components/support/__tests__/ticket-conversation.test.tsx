// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupportTicket } from "@/lib/support/types";

const mocks = vi.hoisted(() => ({
  supportFetch: vi.fn(),
  subscribeToTicket: vi.fn(() => vi.fn()),
}));

vi.mock("@/lib/support/http.client", () => ({
  supportFetch: mocks.supportFetch,
}));

vi.mock("@/lib/support/realtime.client", () => ({
  subscribeToTicket: mocks.subscribeToTicket,
}));

import SupportHistoryPage from "@/app/dashboard/support/page";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const ticketId = "20000000-0000-4000-8000-000000000002";
const secondTicketId = "30000000-0000-4000-8000-000000000003";

function ticket(overrides: Partial<SupportTicket> = {}): SupportTicket {
  return {
    id: ticketId,
    userId: "10000000-0000-4000-8000-000000000001",
    title: "Workflow execution failed",
    description: "The scheduled workflow stopped.",
    category: "bug",
    priority: "high",
    status: "open",
    source: "ticket_form",
    assignedTo: "agent-42",
    attachments: [],
    firstResponseDueAt: "2099-06-12T12:00:00.000Z",
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

async function renderPage() {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(<SupportHistoryPage />));
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

async function input(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype =
      element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("user ticket history", () => {
  const roots: Root[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.subscribeToTicket.mockImplementation(() => vi.fn());
  });

  afterEach(async () => {
    for (const root of roots) {
      await act(async () => root.unmount());
    }
    roots.length = 0;
    document.body.innerHTML = "";
  });

  it("lists tickets and sends status and text filters to the active API", async () => {
    mocks.supportFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url.startsWith("/api/support/tickets?")
          ? { tickets: [ticket()] }
          : url === "/api/support/tickets"
            ? { tickets: [ticket()] }
            : { ticket: ticket(), replies: [] },
      ),
    );
    const view = await renderPage();
    roots.push(view.root);

    expect(view.host.textContent).toContain("Workflow execution failed");
    const status = view.host.querySelector('select[aria-label="Filter tickets by status"]')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        status,
        "in_progress",
      );
      status.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await input(view.host.querySelector('input[aria-label="Search tickets"]')!, "workflow failed");
    await click(
      Array.from(view.host.querySelectorAll('button[type="submit"]')).find(
        (button) => button.textContent === "Search",
      ) ?? null,
    );

    expect(mocks.supportFetch).toHaveBeenLastCalledWith(
      "/api/support/tickets?status=in_progress&search=workflow+failed",
    );
  });

  it("loads a selected ticket detail and renders its replies", async () => {
    mocks.supportFetch
      .mockResolvedValueOnce({
        tickets: [
          ticket(),
          ticket({ id: secondTicketId, title: "Billing question", assignedTo: null }),
        ],
      })
      .mockResolvedValueOnce({ ticket: ticket(), replies: [] })
      .mockResolvedValueOnce({
        ticket: ticket({ id: secondTicketId, title: "Billing question", assignedTo: null }),
        replies: [{ id: "reply-1", body: "We found the invoice.", is_admin: true }],
      });
    const view = await renderPage();
    roots.push(view.root);

    await click(view.host.querySelector(`[data-ticket-id="${secondTicketId}"]`));

    expect(mocks.supportFetch).toHaveBeenCalledWith(
      `/api/support/tickets/${secondTicketId}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const firstDetailRequest = mocks.supportFetch.mock.calls.find(
      ([url]) => url === `/api/support/tickets/${ticketId}`,
    );
    expect((firstDetailRequest?.[1] as RequestInit | undefined)?.signal?.aborted).toBe(true);
    expect(view.host.textContent).toContain("We found the invoice.");
  });

  it("ignores an older detail response that completes after the newly selected ticket", async () => {
    const staleFirstDetail = deferred<{ ticket: SupportTicket; replies: [] }>();
    const secondDetail = deferred<{ ticket: SupportTicket; replies: [] }>();
    let firstTicketDetailRequests = 0;
    mocks.supportFetch.mockImplementation((url: string) => {
      if (url === "/api/support/tickets") {
        return Promise.resolve({
          tickets: [ticket(), ticket({ id: secondTicketId, title: "Billing question" })],
        });
      }
      if (url === `/api/support/tickets/${ticketId}`) {
        firstTicketDetailRequests += 1;
        return firstTicketDetailRequests === 1
          ? Promise.resolve({ ticket: ticket(), replies: [] })
          : staleFirstDetail.promise;
      }
      if (url === `/api/support/tickets/${secondTicketId}`) return secondDetail.promise;
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    const view = await renderPage();
    roots.push(view.root);
    expect(view.host.textContent).toContain("The scheduled workflow stopped.");

    const handlers = (
      mocks.subscribeToTicket.mock.calls as unknown as Array<[string, { onReply: () => void }]>
    )[0][1];
    await act(async () => handlers.onReply());
    await click(view.host.querySelector(`[data-ticket-id="${secondTicketId}"]`));
    expect(view.host.textContent).not.toContain("The scheduled workflow stopped.");

    await act(async () => {
      secondDetail.resolve({
        ticket: ticket({
          id: secondTicketId,
          title: "Billing question",
          description: "The invoice is missing.",
        }),
        replies: [],
      });
    });
    expect(view.host.textContent).toContain("The invoice is missing.");

    await act(async () => {
      staleFirstDetail.resolve({ ticket: ticket(), replies: [] });
    });
    expect(view.host.textContent).toContain("The invoice is missing.");
    expect(view.host.textContent).not.toContain("The scheduled workflow stopped.");
  });

  it("does not submit a reply while the selected ticket and loaded detail differ", async () => {
    const staleFirstDetail = deferred<{ ticket: SupportTicket; replies: [] }>();
    const secondDetail = deferred<{ ticket: SupportTicket; replies: [] }>();
    let firstTicketDetailRequests = 0;
    mocks.supportFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve({ reply: { id: "reply-2" } });
      if (url === "/api/support/tickets") {
        return Promise.resolve({
          tickets: [ticket(), ticket({ id: secondTicketId, title: "Billing question" })],
        });
      }
      if (url === `/api/support/tickets/${ticketId}`) {
        firstTicketDetailRequests += 1;
        return firstTicketDetailRequests === 1
          ? Promise.resolve({ ticket: ticket(), replies: [] })
          : staleFirstDetail.promise;
      }
      if (url === `/api/support/tickets/${secondTicketId}`) return secondDetail.promise;
      return Promise.reject(new Error(`Unexpected request: ${url}`));
    });
    const view = await renderPage();
    roots.push(view.root);

    const handlers = (
      mocks.subscribeToTicket.mock.calls as unknown as Array<[string, { onReply: () => void }]>
    )[0][1];
    await act(async () => handlers.onReply());
    await click(view.host.querySelector(`[data-ticket-id="${secondTicketId}"]`));
    await act(async () => {
      staleFirstDetail.resolve({ ticket: ticket(), replies: [] });
    });

    expect(view.host.querySelector("textarea")).toBeNull();
    expect(
      mocks.supportFetch.mock.calls.some(
        ([, init]) => (init as RequestInit | undefined)?.method === "POST",
      ),
    ).toBe(false);

    await act(async () => {
      secondDetail.resolve({
        ticket: ticket({ id: secondTicketId, title: "Billing question" }),
        replies: [],
      });
    });
    await input(view.host.querySelector("textarea")!, "This belongs to billing.");
    await click(
      Array.from(view.host.querySelectorAll('button[type="submit"]')).find((button) =>
        button.textContent?.includes("Send reply"),
      ) ?? null,
    );

    expect(mocks.supportFetch).toHaveBeenCalledWith(
      `/api/support/tickets/${secondTicketId}/replies`,
      expect.objectContaining({ method: "POST" }),
    );
    expect(mocks.supportFetch).not.toHaveBeenCalledWith(
      `/api/support/tickets/${ticketId}/replies`,
      expect.anything(),
    );
  });

  it("refetches the selected ticket when realtime invalidates it", async () => {
    mocks.supportFetch.mockResolvedValue({
      tickets: [ticket()],
      ticket: ticket(),
      replies: [],
    });
    const view = await renderPage();
    roots.push(view.root);

    const handlers = (
      mocks.subscribeToTicket.mock.calls as unknown as Array<
        [string, { onReply: () => void; onTicket: () => void }]
      >
    )[0][1];
    mocks.supportFetch.mockClear();
    await act(async () => handlers.onReply());
    await act(async () => undefined);

    expect(mocks.supportFetch).toHaveBeenCalledWith(
      `/api/support/tickets/${ticketId}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.supportFetch).toHaveBeenCalledWith("/api/support/tickets");
  });

  it("posts replies and always refetches list and detail as a fallback", async () => {
    mocks.supportFetch.mockImplementation((url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve({ reply: { id: "reply-2" } });
      if (url === "/api/support/tickets") return Promise.resolve({ tickets: [ticket()] });
      return Promise.resolve({ ticket: ticket(), replies: [] });
    });
    const view = await renderPage();
    roots.push(view.root);

    await input(view.host.querySelector("textarea")!, "Here is more context.");
    mocks.supportFetch.mockClear();
    await click(
      Array.from(view.host.querySelectorAll('button[type="submit"]')).find((button) =>
        button.textContent?.includes("Send reply"),
      ) ?? null,
    );

    expect(mocks.supportFetch).toHaveBeenNthCalledWith(
      1,
      `/api/support/tickets/${ticketId}/replies`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ body: "Here is more context.", attachments: [] }),
      }),
    );
    expect(mocks.supportFetch).toHaveBeenCalledWith(
      `/api/support/tickets/${ticketId}`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.supportFetch).toHaveBeenCalledWith("/api/support/tickets");
  });

  it("shows a safe assignment label without exposing the assigned agent UUID", async () => {
    mocks.supportFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url === "/api/support/tickets"
          ? { tickets: [ticket()] }
          : { ticket: ticket(), replies: [] },
      ),
    );
    const view = await renderPage();
    roots.push(view.root);

    expect(view.host.textContent).toContain("Assigned agent");
    expect(view.host.textContent).toContain("Assigned");
    expect(view.host.textContent).not.toContain("agent-42");
    expect(view.host.textContent).toContain("Response target");
  });

  it("blocks replies for a closed ticket", async () => {
    const closedTicket = ticket({ status: "closed" });
    mocks.supportFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url === "/api/support/tickets"
          ? { tickets: [closedTicket] }
          : { ticket: closedTicket, replies: [] },
      ),
    );
    const view = await renderPage();
    roots.push(view.root);

    expect(view.host.textContent).toContain("This ticket is closed");
    expect(view.host.querySelector("textarea")).toBeNull();
    expect(
      Array.from(view.host.querySelectorAll('button[type="submit"]')).find((button) =>
        button.textContent?.includes("Send reply"),
      ),
    ).toBeUndefined();
  });

  it("renders correlation IDs only when they are present", async () => {
    mocks.supportFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url === "/api/support/tickets"
          ? { tickets: [ticket()] }
          : { ticket: ticket(), replies: [] },
      ),
    );
    const withIds = await renderPage();
    roots.push(withIds.root);
    expect(withIds.host.textContent).toContain("sentry-123");
    expect(withIds.host.textContent).toContain("mcp-456");

    mocks.supportFetch.mockReset();
    const withoutIdsTicket = ticket({ sentryEventId: null, mcpRequestId: null });
    mocks.supportFetch.mockImplementation((url: string) =>
      Promise.resolve(
        url === "/api/support/tickets"
          ? { tickets: [withoutIdsTicket] }
          : { ticket: withoutIdsTicket, replies: [] },
      ),
    );
    const withoutIds = await renderPage();
    roots.push(withoutIds.root);
    expect(withoutIds.host.textContent).not.toContain("Correlation IDs");
  });
});
