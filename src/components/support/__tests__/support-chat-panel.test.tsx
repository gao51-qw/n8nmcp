// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  supportFetch: vi.fn(),
  subscribeToTicket: vi.fn(() => vi.fn()),
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/support/http.client", () => ({
  supportFetch: mocks.supportFetch,
}));

vi.mock("@/lib/support/realtime.client", () => ({
  subscribeToTicket: mocks.subscribeToTicket,
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    storage: {
      from: () => ({ upload: mocks.upload, remove: mocks.remove }),
    },
  },
}));

import { AttachmentPicker, validateSupportFiles } from "../attachment-picker";
import { SupportChatPanel } from "../support-chat-panel";
import { SupportLauncher } from "../support-launcher";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const userId = "10000000-0000-4000-8000-000000000001";
const ticketId = "20000000-0000-4000-8000-000000000002";
const storageKey = `n8n-mcp:support-ticket:${userId}`;

function ticket(overrides: Record<string, unknown> = {}) {
  return {
    id: ticketId,
    userId,
    title: "Chat support request",
    description: "Please help",
    category: "other",
    priority: "normal",
    status: "open",
    source: "live_chat",
    assignedTo: null,
    attachments: [],
    firstResponseDueAt: "2026-06-12T12:00:00.000Z",
    firstRespondedAt: null,
    resolvedDueAt: null,
    slaBreachedAt: null,
    sentryEventId: null,
    mcpRequestId: null,
    createdAt: "2026-06-12T10:00:00.000Z",
    updatedAt: "2026-06-12T10:00:00.000Z",
    lastReplyAt: "2026-06-12T10:00:00.000Z",
    ...overrides,
  };
}

async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => {
    element!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function typeInto(element: HTMLTextAreaElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("authenticated support chat", () => {
  let roots: Root[] = [];

  beforeEach(() => {
    vi.resetAllMocks();
    localStorage.clear();
    mocks.subscribeToTicket.mockImplementation(() => vi.fn());
    mocks.upload.mockResolvedValue({ data: {}, error: null });
    mocks.remove.mockResolvedValue({ data: [], error: null });
  });

  afterEach(async () => {
    for (const root of roots) {
      await act(async () => root.unmount());
    }
    roots = [];
    document.body.innerHTML = "";
  });

  it("renders no launcher for a logged-out user", async () => {
    const view = await render(<SupportLauncher user={null} />);
    roots.push(view.root);
    expect(view.host.querySelector('[aria-label="Open support chat"]')).toBeNull();
  });

  it("loads aggregate availability through the authenticated support API", async () => {
    mocks.supportFetch.mockResolvedValueOnce({ online: true, count: 2 });
    const view = await render(<SupportLauncher user={{ id: userId }} />);
    roots.push(view.root);

    await click(view.host.querySelector('[aria-label="Open support chat"]'));
    await act(async () => undefined);

    expect(mocks.supportFetch).toHaveBeenCalledWith("/api/support/availability");
    expect(view.host.textContent).toContain("Support agents are available");
  });

  it.each([
    [true, "Support agents are available"],
    [false, "Your message will become a support ticket"],
  ])("renders the correct availability copy", async (online, copy) => {
    const view = await render(
      <SupportChatPanel open onOpenChange={() => undefined} userId={userId} online={online} />,
    );
    roots.push(view.root);
    expect(view.host.textContent).toContain(copy);
  });

  it("preallocates a ticket, submits correlation IDs, and renders its number", async () => {
    vi.spyOn(crypto, "randomUUID").mockReturnValue(ticketId);
    mocks.supportFetch.mockResolvedValueOnce({ ticket: ticket() });
    const view = await render(
      <SupportChatPanel
        open
        onOpenChange={() => undefined}
        userId={userId}
        online
        sentryEventId="sentry-123"
        mcpRequestId="mcp-456"
      />,
    );
    roots.push(view.root);

    await typeInto(view.host.querySelector("textarea")!, "Please help");
    await click(view.host.querySelector('button[type="submit"]'));
    await act(async () => undefined);

    expect(mocks.supportFetch).toHaveBeenCalledWith(
      "/api/support/tickets",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"ticketId":"' + ticketId + '"'),
      }),
    );
    const payload = JSON.parse(mocks.supportFetch.mock.calls[0][1].body);
    expect(payload).toMatchObject({
      sentryEventId: "sentry-123",
      mcpRequestId: "mcp-456",
      source: "live_chat",
    });
    expect(localStorage.getItem(storageKey)).toBe(ticketId);
    expect(view.host.textContent).toContain("Ticket #20000000");
  });

  it("restores only the ticket UUID and fetches conversation content from the server", async () => {
    localStorage.setItem(storageKey, ticketId);
    mocks.supportFetch.mockResolvedValueOnce({
      ticket: ticket({ description: "Server-owned body" }),
      replies: [{ id: "reply-1", body: "Fresh server reply", is_admin: true }],
    });
    const view = await render(
      <SupportChatPanel open onOpenChange={() => undefined} userId={userId} online />,
    );
    roots.push(view.root);

    expect(mocks.supportFetch).toHaveBeenCalledWith(`/api/support/tickets/${ticketId}`);
    expect(localStorage.getItem(storageKey)).toBe(ticketId);
    expect(view.host.textContent).toContain("Fresh server reply");
  });

  it.each(["resolved", "closed"] as const)(
    "clears a restored %s ticket and returns to a new-ticket composer",
    async (status) => {
      localStorage.setItem(storageKey, ticketId);
      mocks.supportFetch.mockResolvedValueOnce({
        ticket: ticket({ status }),
        replies: [],
      });
      const view = await render(
        <SupportChatPanel open onOpenChange={() => undefined} userId={userId} online />,
      );
      roots.push(view.root);
      await act(async () => undefined);

      expect(localStorage.getItem(storageKey)).toBeNull();
      expect(view.host.querySelector("textarea")?.getAttribute("placeholder")).toBe(
        "Describe what you need help with...",
      );
      expect(view.host.textContent).toContain("How can we help?");
    },
  );

  it("unsubscribes when the panel closes", async () => {
    localStorage.setItem(storageKey, ticketId);
    const unsubscribe = vi.fn();
    mocks.subscribeToTicket.mockReturnValueOnce(unsubscribe);
    mocks.supportFetch.mockResolvedValue({ ticket: ticket(), replies: [] });
    const view = await render(
      <SupportChatPanel open onOpenChange={() => undefined} userId={userId} online />,
    );
    roots.push(view.root);
    await act(async () =>
      view.root.render(
        <SupportChatPanel open={false} onOpenChange={() => undefined} userId={userId} online />,
      ),
    );
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("rejects six files and files over 10 MB before upload", async () => {
    const sixFiles = Array.from({ length: 6 }, (_, index) => new File(["x"], `file-${index}.txt`));
    expect(validateSupportFiles(sixFiles)).toMatch(/up to 5 files/i);
    expect(
      validateSupportFiles([new File([new Uint8Array(11 * 1024 * 1024)], "large.bin")]),
    ).toMatch(/10 MB/i);

    const onChange = vi.fn();
    const view = await render(<AttachmentPicker files={[]} onChange={onChange} />);
    roots.push(view.root);
    const input = view.host.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, "files", { value: sixFiles });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    expect(onChange).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it("uploads attachments under the user and preallocated ticket with 180-day expiry", async () => {
    const attachmentId = "30000000-0000-4000-8000-000000000003";
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(ticketId).mockReturnValueOnce(attachmentId);
    mocks.supportFetch.mockResolvedValueOnce({ ticket: ticket() });
    const view = await render(
      <SupportChatPanel open onOpenChange={() => undefined} userId={userId} online />,
    );
    roots.push(view.root);

    const input = view.host.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["hello"], "unsafe report (final).txt", { type: "text/plain" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await typeInto(view.host.querySelector("textarea")!, "Please review the attachment");
    const before = Date.now();
    await click(view.host.querySelector('button[type="submit"]'));

    const expectedPath = `${userId}/${ticketId}/${attachmentId}-unsafe-report-final-.txt`;
    expect(mocks.upload).toHaveBeenCalledWith(
      expectedPath,
      file,
      expect.objectContaining({ contentType: "text/plain", upsert: false }),
    );
    const payload = JSON.parse(mocks.supportFetch.mock.calls[0][1].body);
    expect(payload.attachments[0].path).toBe(expectedPath);
    const expiryDays = (new Date(payload.attachments[0].expiresAt).getTime() - before) / 86_400_000;
    expect(expiryDays).toBeGreaterThanOrEqual(179.99);
    expect(expiryDays).toBeLessThanOrEqual(180.01);
  });

  it("best-effort removes this submission's uploads when ticket creation fails", async () => {
    const attachmentId = "30000000-0000-4000-8000-000000000003";
    vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(ticketId).mockReturnValueOnce(attachmentId);
    mocks.supportFetch.mockRejectedValueOnce(new Error("Ticket API failed"));
    const view = await render(
      <SupportChatPanel open onOpenChange={() => undefined} userId={userId} online />,
    );
    roots.push(view.root);

    const input = view.host.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(["hello"], "trace.txt", { type: "text/plain" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    await typeInto(view.host.querySelector("textarea")!, "Please inspect this trace");
    await click(view.host.querySelector('button[type="submit"]'));
    await act(async () => undefined);

    expect(mocks.remove).toHaveBeenCalledWith([`${userId}/${ticketId}/${attachmentId}-trace.txt`]);
    expect(localStorage.getItem(storageKey)).toBeNull();
  });
});
