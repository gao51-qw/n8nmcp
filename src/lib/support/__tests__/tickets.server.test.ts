import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: supabaseMocks.from,
    rpc: supabaseMocks.rpc,
    storage: {
      from: vi.fn(() => ({
        createSignedUrl: supabaseMocks.createSignedUrl,
      })),
    },
  },
}));

type QueryResult = { data: unknown; error: unknown };

function query(result: QueryResult) {
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    builder[method] = vi.fn(() => builder);
  }
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.single = vi.fn().mockResolvedValue(result);
  builder.then = vi.fn((resolve: (value: QueryResult) => unknown) => resolve(result));
  return builder;
}

describe("ticket validation", () => {
  it("requires a client-preallocated ticket UUID", async () => {
    const { CreateTicketSchema } = await import("../validation");
    const result = CreateTicketSchema.safeParse({
      title: "Upload problem",
      description: "Please inspect this file.",
      category: "bug",
      source: "ticket_form",
      attachments: [],
    });

    expect(result.success).toBe(false);
  });

  it("accepts attachments under the preallocated ticket UUID", async () => {
    const { CreateTicketSchema } = await import("../validation");
    const ticketId = "30000000-0000-4000-8000-000000000001";
    const result = CreateTicketSchema.safeParse({
      ticketId,
      title: "Upload problem",
      description: "Please inspect this file.",
      category: "bug",
      source: "ticket_form",
      attachments: [
        {
          path: `10000000-0000-4000-8000-000000000001/${ticketId}/trace.txt`,
          name: "trace.txt",
          size: 10,
          expiresAt: "2026-12-08T00:00:00.000Z",
        },
      ],
    });

    expect(result.success).toBe(true);
  });

  it("rejects six attachments", async () => {
    const { CreateTicketSchema } = await import("../validation");
    const result = CreateTicketSchema.safeParse({
      ticketId: "30000000-0000-4000-8000-000000000001",
      title: "Upload problem",
      description: "Please inspect these files.",
      category: "bug",
      source: "ticket_form",
      attachments: Array.from({ length: 6 }, (_, index) => ({
        path: `user-1/ticket-1/file-${index}.txt`,
        name: `file-${index}.txt`,
        size: 1,
        expiresAt: "2026-12-08T00:00:00.000Z",
      })),
    });

    expect(result.success).toBe(false);
  });

  it("rejects an attachment larger than 10 MB", async () => {
    const { AttachmentSchema } = await import("../validation");
    const result = AttachmentSchema.safeParse({
      path: "user-1/ticket-1/large.bin",
      name: "large.bin",
      size: 11 * 1024 * 1024,
      expiresAt: "2026-12-08T00:00:00.000Z",
    });

    expect(result.success).toBe(false);
  });
});

describe("ticket service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects attachment paths outside the user and ticket prefix", async () => {
    const { assertAttachmentPaths } = await import("../tickets.server");

    expect(() =>
      assertAttachmentPaths("user-1", "ticket-1", [
        {
          path: "user-2/ticket-1/stolen.txt",
          name: "stolen.txt",
          size: 10,
          expiresAt: "2026-12-08T00:00:00.000Z",
        },
      ]),
    ).toThrow("Invalid attachment path");
  });

  it("rejects prefixed paths without a UUID and sanitized filename", async () => {
    const { assertAttachmentPaths } = await import("../tickets.server");

    expect(() =>
      assertAttachmentPaths("user-1", "ticket-1", [
        {
          path: "user-1/ticket-1/not-a-uuid-unsafe report.txt",
          name: "unsafe report.txt",
          size: 10,
          expiresAt: "2026-12-08T00:00:00.000Z",
        },
      ]),
    ).toThrow("Invalid attachment path");
  });

  it("replaces client attachment expiry with an absolute server 180-day timestamp", async () => {
    const now = new Date("2026-06-12T00:00:00.000Z");
    const { normalizeSupportAttachments } = await import("../tickets.server");

    const result = normalizeSupportAttachments(
      "10000000-0000-4000-8000-000000000001",
      "30000000-0000-4000-8000-000000000001",
      [
        {
          path: "10000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/40000000-0000-4000-8000-000000000001-trace.txt",
          name: "trace.txt",
          size: 10,
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      ],
      now,
    );

    expect(result[0].expiresAt).toBe("2026-12-09T00:00:00.000Z");
  });

  it("creates live chat atomically with first reply, SLA, assignment, and outbox", async () => {
    const ticketId = "30000000-0000-4000-8000-000000000001";
    const ticket = {
      id: ticketId,
      user_id: "10000000-0000-4000-8000-000000000001",
      source: "live_chat",
      first_response_due_at: "2026-06-12T02:00:00.000Z",
      assigned_to: "agent-1",
    };
    supabaseMocks.rpc.mockResolvedValue({ data: ticket, error: null });
    const { createSupportTicket } = await import("../tickets.server");

    await expect(
      createSupportTicket(
        {
          userId: "10000000-0000-4000-8000-000000000001",
          email: "user@example.com",
        },
        {
          ticketId,
          title: "Chat help",
          description: "My workflow cannot start.",
          category: "bug",
          priority: "urgent",
          source: "live_chat",
          attachments: [],
        },
        "request-1",
      ),
    ).resolves.toMatchObject({
      id: ticketId,
      source: "live_chat",
      firstResponseDueAt: "2026-06-12T02:00:00.000Z",
      assignedTo: "agent-1",
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith(
      "support_create_ticket",
      expect.objectContaining({
        _ticket_id: ticketId,
        _user_id: "10000000-0000-4000-8000-000000000001",
        _description: "My workflow cannot start.",
        _source: "live_chat",
        _request_id: "request-1",
      }),
    );
  });

  it("rejects create attachments outside the preallocated ticket prefix", async () => {
    const { createSupportTicket } = await import("../tickets.server");

    await expect(
      createSupportTicket(
        {
          userId: "10000000-0000-4000-8000-000000000001",
          email: "user@example.com",
        },
        {
          ticketId: "30000000-0000-4000-8000-000000000001",
          title: "Upload problem",
          description: "Please inspect this file.",
          category: "bug",
          priority: "normal",
          source: "ticket_form",
          attachments: [
            {
              path: "10000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002/stolen.txt",
              name: "stolen.txt",
              size: 10,
              expiresAt: "2026-12-08T00:00:00.000Z",
            },
          ],
        },
        "request-1",
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it("does not return another user's ticket", async () => {
    supabaseMocks.from.mockReturnValue(
      query({
        data: { id: "ticket-2", user_id: "user-2" },
        error: null,
      }),
    );
    const { getSupportTicket } = await import("../tickets.server");

    await expect(getSupportTicket("user-1", "ticket-2")).rejects.toMatchObject({
      status: 404,
    });
  });

  it("does not expose internal notes through the user ticket DTO", async () => {
    const ticketQuery = query({
      data: {
        id: "ticket-1",
        user_id: "user-1",
        title: "Help",
        internal_notes: [{ id: "note-1", body: "Internal only" }],
      },
      error: null,
    });
    const repliesQuery = query({ data: [], error: null });
    supabaseMocks.from.mockImplementation((table: string) =>
      table === "support_ticket_replies" ? repliesQuery : ticketQuery,
    );
    const { getSupportTicket } = await import("../tickets.server");

    const result = await getSupportTicket("user-1", "ticket-1");

    expect(result).not.toHaveProperty("internalNotes");
    expect(result.ticket).not.toHaveProperty("internalNotes");
    expect(result.ticket).not.toHaveProperty("internal_notes");
    expect(supabaseMocks.from).not.toHaveBeenCalledWith("support_ticket_internal_notes");
  });

  it("atomically inserts an admin reply and marks first response", async () => {
    const ticketQuery = query({
      data: { id: "ticket-1", user_id: "user-1", status: "open" },
      error: null,
    });
    const roleQuery = query({ data: { role: "admin" }, error: null });
    const reply = {
      id: "reply-1",
      ticket_id: "ticket-1",
      author_id: "agent-1",
      is_admin: true,
      body: "We are investigating.",
      attachments: [],
      created_at: "2026-06-11T10:00:00.000Z",
    };
    supabaseMocks.rpc.mockResolvedValue({
      data: reply,
      error: null,
    });
    supabaseMocks.from.mockImplementation((table: string) => {
      if (table === "user_roles") return roleQuery;
      return ticketQuery;
    });
    const { addSupportReply } = await import("../tickets.server");

    await expect(
      addSupportReply("agent-1", "ticket-1", {
        body: "We are investigating.",
        attachments: [],
      }),
    ).resolves.toEqual(reply);

    expect(supabaseMocks.rpc).toHaveBeenCalledTimes(1);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith("support_admin_add_reply", {
      _actor_id: "agent-1",
      _attachments: [],
      _body: "We are investigating.",
      _ticket_id: "ticket-1",
    });
  });

  it("uses the atomic user reply RPC for cumulative attachment enforcement", async () => {
    const ticketQuery = query({
      data: { id: "ticket-1", user_id: "user-1", status: "open" },
      error: null,
    });
    const roleQuery = query({ data: null, error: null });
    supabaseMocks.from.mockImplementation((table: string) =>
      table === "user_roles" ? roleQuery : ticketQuery,
    );
    supabaseMocks.rpc.mockResolvedValue({
      data: { id: "reply-1", ticket_id: "ticket-1" },
      error: null,
    });
    const { addSupportReply } = await import("../tickets.server");

    await addSupportReply("user-1", "ticket-1", {
      body: "One more trace.",
      attachments: [],
    });

    expect(supabaseMocks.rpc).toHaveBeenCalledWith(
      "support_add_reply",
      expect.objectContaining({
        _actor_id: "user-1",
        _ticket_id: "ticket-1",
      }),
    );
    expect(supabaseMocks.from).not.toHaveBeenCalledWith("support_ticket_replies");
  });

  it("rejects replies to closed tickets before any insert or RPC", async () => {
    supabaseMocks.from.mockReturnValue(
      query({
        data: { id: "ticket-1", user_id: "user-1", status: "closed" },
        error: null,
      }),
    );
    const { addSupportReply } = await import("../tickets.server");

    await expect(
      addSupportReply("user-1", "ticket-1", { body: "Please reopen", attachments: [] }),
    ).rejects.toMatchObject({ status: 409 });
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it("does not fall back to a reply insert when the atomic admin RPC fails", async () => {
    const ticketQuery = query({
      data: { id: "ticket-1", user_id: "user-1", status: "open" },
      error: null,
    });
    const roleQuery = query({ data: { role: "admin" }, error: null });
    supabaseMocks.from.mockImplementation((table: string) => {
      if (table === "user_roles") return roleQuery;
      return ticketQuery;
    });
    supabaseMocks.rpc.mockResolvedValue({
      data: null,
      error: { message: "atomic reply failed" },
    });
    const { addSupportReply } = await import("../tickets.server");

    await expect(
      addSupportReply("agent-1", "ticket-1", {
        body: "We are investigating.",
        attachments: [],
      }),
    ).rejects.toThrow("atomic reply failed");
    expect(supabaseMocks.from).not.toHaveBeenCalledWith("support_ticket_replies");
  });

  it("does not mark first response for an automated reply", async () => {
    const ticketQuery = query({
      data: { id: "ticket-1", user_id: "user-1", status: "open" },
      error: null,
    });
    const reply = {
      id: "reply-1",
      ticket_id: "ticket-1",
      author_id: "agent-1",
      is_admin: false,
      body: "Automated acknowledgement.",
      attachments: [],
      created_at: "2026-06-11T10:00:00.000Z",
    };
    supabaseMocks.from.mockImplementation((table: string) => {
      return ticketQuery;
    });
    supabaseMocks.rpc.mockResolvedValue({ data: reply, error: null });
    const { addSupportReply } = await import("../tickets.server");

    await addSupportReply(
      "agent-1",
      "ticket-1",
      { body: "Automated acknowledgement.", attachments: [] },
      { automated: true },
    );

    expect(supabaseMocks.rpc).toHaveBeenCalledWith(
      "support_add_reply",
      expect.objectContaining({ _automated: true }),
    );
  });

  it("signs only paths recorded on the accessible ticket or its replies", async () => {
    const ticketQuery = query({
      data: {
        id: "ticket-1",
        user_id: "user-1",
        attachments: [
          {
            path: "user-1/ticket-1/ticket.txt",
            name: "ticket.txt",
            size: 10,
            expiresAt: "2026-12-08T00:00:00.000Z",
          },
        ],
      },
      error: null,
    });
    const repliesQuery = query({
      data: [{ attachments: [] }],
      error: null,
    });
    supabaseMocks.from.mockImplementation((table: string) =>
      table === "support_ticket_replies" ? repliesQuery : ticketQuery,
    );
    supabaseMocks.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://storage.test/signed" },
      error: null,
    });
    const { signSupportAttachments } = await import("../tickets.server");

    await expect(
      signSupportAttachments("user-1", "ticket-1", ["user-1/ticket-1/not-recorded.txt"]),
    ).rejects.toMatchObject({ status: 404 });
    expect(supabaseMocks.createSignedUrl).not.toHaveBeenCalled();

    await expect(
      signSupportAttachments("user-1", "ticket-1", ["user-1/ticket-1/ticket.txt"]),
    ).resolves.toEqual([
      {
        path: "user-1/ticket-1/ticket.txt",
        signedUrl: "https://storage.test/signed",
      },
    ]);
  });
});
