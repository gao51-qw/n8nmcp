import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireSupportAdmin: vi.fn(),
  requireSupportUser: vi.fn(),
  transferSupportTicket: vi.fn(),
  updateSupportTicketStatus: vi.fn(),
  updateSupportTicketPriority: vi.fn(),
  addSupportTicketTag: vi.fn(),
  removeSupportTicketTag: vi.fn(),
  addSupportInternalNote: vi.fn(),
  updateSupportInternalNote: vi.fn(),
  addSupportReply: vi.fn(),
}));

vi.mock("@/lib/support/auth.server", () => ({
  requireSupportAdmin: mocks.requireSupportAdmin,
  requireSupportUser: mocks.requireSupportUser,
}));

vi.mock("@/lib/support/admin.server", () => ({
  getAdminTicket: vi.fn(),
  transferSupportTicket: mocks.transferSupportTicket,
  updateSupportTicketStatus: mocks.updateSupportTicketStatus,
  updateSupportTicketPriority: mocks.updateSupportTicketPriority,
  addSupportTicketTag: mocks.addSupportTicketTag,
  removeSupportTicketTag: mocks.removeSupportTicketTag,
  addSupportInternalNote: mocks.addSupportInternalNote,
  updateSupportInternalNote: mocks.updateSupportInternalNote,
}));

vi.mock("@/lib/support/tickets.server", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/support/tickets.server")>();
  return { ...original, addSupportReply: mocks.addSupportReply };
});

vi.mock("@/lib/logger.server", () => ({
  createSafeErrorDto: (message: string, requestId: string) => ({ error: message, requestId }),
  getRequestId: () => "route-request-id",
  log: { error: vi.fn() },
}));

const ticketId = "20000000-0000-4000-8000-000000000002";
const adminId = "30000000-0000-4000-8000-000000000003";
const assignedTo = "40000000-0000-4000-8000-000000000004";
const context = { params: Promise.resolve({ ticketId }) };
let ticketRoute: typeof import("@/app/api/support/admin/tickets/[ticketId]/route");

beforeAll(async () => {
  ticketRoute = await import("@/app/api/support/admin/tickets/[ticketId]/route");
});

function request(method: string, body: unknown) {
  return new Request(`https://example.test/api/support/admin/tickets/${ticketId}`, {
    method,
    headers: {
      authorization: "Bearer admin-token",
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

describe("admin support route contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireSupportAdmin.mockResolvedValue({ userId: adminId, email: "admin@example.test" });
    mocks.requireSupportUser.mockResolvedValue({ userId: adminId, email: "admin@example.test" });
    for (const mock of [
      mocks.transferSupportTicket,
      mocks.updateSupportTicketStatus,
      mocks.updateSupportTicketPriority,
      mocks.addSupportTicketTag,
      mocks.removeSupportTicketTag,
      mocks.addSupportInternalNote,
      mocks.updateSupportInternalNote,
      mocks.addSupportReply,
    ]) {
      mock.mockResolvedValue({ id: "result-1" });
    }
  });

  it.each([
    [
      { action: "transfer", assignedTo },
      mocks.transferSupportTicket,
      [ticketId, adminId, assignedTo],
    ],
    [
      { action: "status", status: "waiting_user" },
      mocks.updateSupportTicketStatus,
      [ticketId, adminId, "waiting_user"],
    ],
    [
      { action: "priority", priority: "urgent" },
      mocks.updateSupportTicketPriority,
      [ticketId, adminId, "urgent"],
    ],
  ])(
    "PATCH uses admin auth and forwards the validated mutation body",
    async (body, service, args) => {
      const response = await ticketRoute.PATCH(request("PATCH", body), context);

      expect(response.status).toBe(200);
      expect(mocks.requireSupportAdmin).toHaveBeenCalledOnce();
      expect(service).toHaveBeenCalledWith(...args);
    },
  );

  it.each([
    ["POST", "addSupportTicketTag", mocks.addSupportTicketTag],
    ["DELETE", "removeSupportTicketTag", mocks.removeSupportTicketTag],
  ])("%s tags uses admin auth and forwards the tag body", async (method, _name, service) => {
    const route = await import("@/app/api/support/admin/tickets/[ticketId]/tags/route");

    const response = await route[method as "POST" | "DELETE"](
      request(method, { tag: "vip" }),
      context,
    );

    expect(response.status).toBe(method === "POST" ? 201 : 200);
    expect(mocks.requireSupportAdmin).toHaveBeenCalledOnce();
    expect(service).toHaveBeenCalledWith(ticketId, adminId, "vip");
  });

  it("POST notes uses admin auth and forwards the note body", async () => {
    const { POST } = await import("@/app/api/support/admin/tickets/[ticketId]/notes/route");

    const response = await POST(request("POST", { body: "Internal only" }), context);

    expect(response.status).toBe(201);
    expect(mocks.requireSupportAdmin).toHaveBeenCalledOnce();
    expect(mocks.addSupportInternalNote).toHaveBeenCalledWith(ticketId, adminId, "Internal only");
  });

  it("PATCH notes uses admin auth and forwards note id and body", async () => {
    const noteId = "50000000-0000-4000-8000-000000000005";
    const { PATCH } = await import("@/app/api/support/admin/tickets/[ticketId]/notes/route");

    const response = await PATCH(
      request("PATCH", { noteId, body: "Updated internal note" }),
      context,
    );

    expect(response.status).toBe(200);
    expect(mocks.requireSupportAdmin).toHaveBeenCalledOnce();
    expect(mocks.updateSupportInternalNote).toHaveBeenCalledWith(
      ticketId,
      noteId,
      adminId,
      "Updated internal note",
    );
  });

  it("POST replies uses bearer user auth and forwards the reply body", async () => {
    const { POST } = await import("@/app/api/support/tickets/[ticketId]/replies/route");

    const response = await POST(
      request("POST", { body: "Administrator response", attachments: [] }),
      context,
    );

    expect(response.status).toBe(201);
    expect(mocks.requireSupportUser).toHaveBeenCalledOnce();
    expect(mocks.addSupportReply).toHaveBeenCalledWith(adminId, ticketId, {
      body: "Administrator response",
      attachments: [],
    });
  });

  it("does not call mutation services when admin authentication fails", async () => {
    mocks.requireSupportAdmin.mockRejectedValueOnce(new Response(null, { status: 403 }));
    const { PATCH } = await import("@/app/api/support/admin/tickets/[ticketId]/route");

    const response = await PATCH(
      request("PATCH", { action: "priority", priority: "urgent" }),
      context,
    );

    expect(response.status).toBe(403);
    expect(mocks.updateSupportTicketPriority).not.toHaveBeenCalled();
  });
});
