import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const supabaseMocks = vi.hoisted(() => ({
  from: vi.fn(),
  getUser: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    auth: {
      getUser: supabaseMocks.getUser,
    },
    from: supabaseMocks.from,
    rpc: supabaseMocks.rpc,
  },
}));

type QueryResult = { data: unknown; error: { message?: string } | null };

function query(result: QueryResult) {
  const calls: Array<[string, ...unknown[]]> = [];
  const builder: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["select", "eq", "is", "in", "not", "lte", "gte", "order", "limit"]) {
    builder[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, ...args]);
      return builder;
    });
  }
  builder.maybeSingle = vi.fn().mockResolvedValue(result);
  builder.single = vi.fn().mockResolvedValue(result);
  builder.then = vi.fn((resolve: (value: QueryResult) => unknown) => resolve(result));
  return { builder, calls };
}

describe("admin support service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("heartbeats through the RPC and assigns at most the bounded batch", async () => {
    const unassigned = query({
      data: Array.from({ length: 12 }, (_, index) => ({ id: `ticket-${index + 1}` })),
      error: null,
    });
    supabaseMocks.from.mockReturnValue(unassigned.builder);
    supabaseMocks.rpc.mockImplementation(async (name: string) => ({
      data:
        name === "support_agent_heartbeat" ? { agent_id: "agent-1", status: "online" } : "agent-1",
      error: null,
    }));
    const { heartbeatAndAssignTickets } = await import("../admin.server");

    const result = await heartbeatAndAssignTickets("agent-1", 5);

    expect(supabaseMocks.rpc).toHaveBeenNthCalledWith(1, "support_agent_heartbeat", {
      _agent_id: "agent-1",
    });
    expect(unassigned.calls).toContainEqual(["eq", "status", "open"]);
    expect(unassigned.calls).toContainEqual(["is", "assigned_to", null]);
    expect(unassigned.calls).toContainEqual(["limit", 5]);
    expect(
      supabaseMocks.rpc.mock.calls.filter(([name]) => name === "support_assign_ticket"),
    ).toHaveLength(5);
    expect(result.assignedCount).toBe(5);
  });

  it.each([
    [
      "unassigned",
      [
        ["is", "assigned_to", null],
        ["eq", "status", "open"],
      ],
    ],
    [
      "mine",
      [
        ["eq", "assigned_to", "agent-1"],
        ["in", "status", ["open", "in_progress"]],
      ],
    ],
    ["waiting_user", [["eq", "status", "waiting_user"]]],
    [
      "sla_due",
      [
        ["is", "first_responded_at", null],
        ["is", "sla_breached_at", null],
        ["not", "status", "in", "(resolved,closed)"],
        ["gte", "first_response_due_at", "2026-06-11T10:00:00.000Z"],
        ["lte", "first_response_due_at", "2026-06-11T10:30:00.000Z"],
      ],
    ],
    ["sla_breached", [["not", "sla_breached_at", "is", null]]],
    ["closed", [["in", "status", ["resolved", "closed"]]]],
  ] as const)("uses exact predicates for the %s queue", async (queueName, expected) => {
    const tickets = query({ data: [], error: null });
    supabaseMocks.from.mockReturnValue(tickets.builder);
    const { listAdminTickets } = await import("../admin.server");

    await listAdminTickets(queueName, "agent-1", new Date("2026-06-11T10:00:00.000Z"));

    for (const predicate of expected) {
      expect(tickets.calls).toContainEqual(predicate);
    }
  });

  it("transfers through the atomic event-writing RPC", async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: { id: "ticket-1", assigned_to: "agent-2" },
      error: null,
    });
    const { transferSupportTicket } = await import("../admin.server");

    await transferSupportTicket("ticket-1", "agent-1", "agent-2");

    expect(supabaseMocks.rpc).toHaveBeenCalledWith("support_admin_transfer_ticket", {
      _actor_id: "agent-1",
      _assigned_to: "agent-2",
      _ticket_id: "ticket-1",
    });
  });

  it("recomputes first-response SLA when priority changes before first response", async () => {
    supabaseMocks.rpc.mockResolvedValue({
      data: {
        id: "ticket-1",
        priority: "urgent",
        first_responded_at: null,
        first_response_due_at: "2026-06-11T10:30:00.000Z",
      },
      error: null,
    });
    const { updateSupportTicketPriority } = await import("../admin.server");

    await updateSupportTicketPriority("ticket-1", "agent-1", "urgent");

    expect(supabaseMocks.rpc).toHaveBeenCalledWith("support_admin_set_priority", {
      _actor_id: "agent-1",
      _priority: "urgent",
      _ticket_id: "ticket-1",
    });
  });

  it.each([
    ["support_admin_set_status", "updateSupportTicketStatus", ["ticket-1", "agent-1", "resolved"]],
    ["support_admin_add_tag", "addSupportTicketTag", ["ticket-1", "agent-1", "billing"]],
    ["support_admin_remove_tag", "removeSupportTicketTag", ["ticket-1", "agent-1", "billing"]],
    ["support_admin_add_note", "addSupportInternalNote", ["ticket-1", "agent-1", "Investigating"]],
    [
      "support_admin_update_note",
      "updateSupportInternalNote",
      ["ticket-1", "note-1", "agent-1", "Updated"],
    ],
  ] as const)("uses atomic event-writing RPC %s", async (rpcName, exportName, args) => {
    supabaseMocks.rpc.mockResolvedValue({ data: {}, error: null });
    const service = await import("../admin.server");

    await (service[exportName] as (...values: string[]) => Promise<unknown>)(...args);

    expect(supabaseMocks.rpc).toHaveBeenCalledWith(rpcName, expect.any(Object));
  });
});

describe("support admin migration contract", () => {
  const migrationPath = resolve(
    process.cwd(),
    "supabase/migrations/20260611230000_harden_support_admin_rpcs.sql",
  );
  const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

  it("allows only service-role heartbeat calls for an explicit admin agent", () => {
    expect(migration).toMatch(/drop function .*support_agent_heartbeat\(\)/i);
    expect(migration).toMatch(/support_agent_heartbeat\(_agent_id uuid\)/i);
    expect(migration).toMatch(/auth\.role\(\).*service_role/is);
    expect(migration).toMatch(/support_require_admin_actor\(_agent_id\)/i);
    expect(migration).toMatch(
      /grant execute on function .*support_agent_heartbeat\(uuid\) to service_role/i,
    );
    expect(migration).not.toMatch(
      /grant execute on function .*support_agent_heartbeat.* to authenticated/i,
    );
  });

  it("records old and new assignment values for automatic assignment", () => {
    expect(migration).toMatch(
      /'assigned'.*jsonb_build_object\(\s*'old',\s*current_agent,\s*'new',\s*selected_agent\s*\)/is,
    );
  });

  it("preserves first-response due time after the first response", () => {
    expect(migration).toMatch(
      /first_response_due_at\s*=\s*case\s+when first_responded_at is null.*else first_response_due_at\s+end/is,
    );
  });
});

describe("admin support routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    supabaseMocks.getUser.mockResolvedValue({
      data: { user: { id: "user-1", email: "user@example.com" } },
      error: null,
    });
    const role = query({ data: null, error: null });
    supabaseMocks.from.mockReturnValue(role.builder);
  });

  it("returns 403 for an authenticated non-admin", async () => {
    const { POST } = await import("@/app/api/support/admin/heartbeat/route");
    const response = await POST(
      new Request("https://example.test/api/support/admin/heartbeat", {
        method: "POST",
        headers: { authorization: "Bearer valid-token" },
      }),
    );

    expect(response.status).toBe(403);
    expect(supabaseMocks.rpc).not.toHaveBeenCalled();
  });

  it("passes the authenticated admin UUID to the service-role heartbeat RPC", async () => {
    const role = query({ data: { role: "admin" }, error: null });
    const tickets = query({ data: [], error: null });
    supabaseMocks.from.mockImplementation((table: string) =>
      table === "user_roles" ? role.builder : tickets.builder,
    );
    supabaseMocks.rpc.mockResolvedValue({
      data: { agent_id: "user-1", status: "online" },
      error: null,
    });
    const { POST } = await import("@/app/api/support/admin/heartbeat/route");

    const response = await POST(
      new Request("https://example.test/api/support/admin/heartbeat", {
        method: "POST",
        headers: { authorization: "Bearer valid-token" },
      }),
    );

    expect(response.status).toBe(200);
    expect(supabaseMocks.rpc).toHaveBeenCalledWith("support_agent_heartbeat", {
      _agent_id: "user-1",
    });
  });
});
