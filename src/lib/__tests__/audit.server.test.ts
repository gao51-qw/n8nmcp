import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type DbResult = { data: unknown; error: { message?: string } | null };

// A chainable Supabase query-builder mock. Every chain method records its call
// and returns the same builder; the builder is awaitable (PromiseLike) and also
// exposes maybeSingle/single. Each test sets the resolved result.
function makeBuilder(result: DbResult) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const builder: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "eq", "order", "gte", "lte", "range"]) {
    builder[method] = vi.fn((...args: unknown[]) => {
      calls.push({ method, args });
      return builder;
    });
  }
  builder.maybeSingle = vi.fn(async () => result);
  builder.single = vi.fn(async () => result);
  // Make `await builder` resolve to the configured result.
  builder.then = (onfulfilled: (value: DbResult) => unknown) => onfulfilled(result);
  builder.__calls = calls;
  return builder as Record<string, ReturnType<typeof vi.fn>> & {
    __calls: Array<{ method: string; args: unknown[] }>;
  };
}

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  logWarn: vi.fn(),
  logError: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { from: mocks.from },
}));

vi.mock("@/lib/logger.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger.server")>();
  return {
    ...actual,
    log: { ...actual.log, warn: mocks.logWarn, error: mocks.logError },
  };
});

async function mod() {
  return import("../audit.server");
}

function migrationSqlContaining(fragment: string): string {
  const dir = resolve(process.cwd(), "supabase", "migrations");
  const match = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .map((f) => readFileSync(resolve(dir, f), "utf8"))
    .find((sql) => sql.includes(fragment));
  expect(match, `migration containing ${fragment}`).toBeDefined();
  return match!;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("calculateChanges", () => {
  it("reports added, removed and modified fields and skips unchanged ones", async () => {
    const { calculateChanges } = await mod();
    const changes = calculateChanges(
      { name: "A", active: false, kept: 1 },
      { name: "B", active: false, added: 9 },
    );
    const byField = Object.fromEntries(changes.map((c) => [c.field, c]));

    expect(byField.name).toMatchObject({ before: "A", after: "B", type: "modified" });
    expect(byField.added).toMatchObject({ after: 9, type: "added" });
    expect(byField.kept).toMatchObject({ before: 1, type: "removed" });
    expect(byField.active).toBeUndefined(); // unchanged -> omitted
  });

  it("returns an empty array when either snapshot is missing", async () => {
    const { calculateChanges } = await mod();
    expect(calculateChanges(null, { a: 1 })).toEqual([]);
    expect(calculateChanges({ a: 1 }, null)).toEqual([]);
  });
});

describe("recordWorkflowAudit", () => {
  const entry = {
    userId: "user-1",
    instanceId: "inst-1",
    workflowId: "wf-1",
    operation: "update" as const,
    snapshotBefore: { name: "A" },
    snapshotAfter: { name: "B" },
    toolName: "update_workflow",
  };

  it("inserts a row mapped to snake_case columns", async () => {
    const builder = makeBuilder({ data: null, error: null });
    mocks.from.mockReturnValue(builder);
    const { recordWorkflowAudit } = await mod();

    await recordWorkflowAudit(entry);

    expect(mocks.from).toHaveBeenCalledWith("workflow_audit_log");
    const insert = builder.__calls.find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({
      user_id: "user-1",
      workflow_id: "wf-1",
      operation: "update",
      tool_name: "update_workflow",
      snapshot_before: { name: "A" },
      snapshot_after: { name: "B" },
    });
  });

  it("redacts sensitive tool parameters before insert", async () => {
    const builder = makeBuilder({ data: null, error: null });
    mocks.from.mockReturnValue(builder);
    const { recordWorkflowAudit } = await mod();

    await recordWorkflowAudit({
      ...entry,
      toolParams: {
        name: "Safe workflow name",
        apiKey: "sk-secret",
        nested: {
          password: "password-secret",
          headers: {
            Authorization: "Bearer secret-token",
          },
        },
        safeArray: [{ token: "array-token", visible: "kept" }],
      },
    });

    const insert = builder.__calls.find((c) => c.method === "insert");
    expect(insert?.args[0]).toMatchObject({
      tool_params: {
        name: "Safe workflow name",
        apiKey: "[REDACTED]",
        nested: {
          password: "[REDACTED]",
          headers: {
            Authorization: "[REDACTED]",
          },
        },
        safeArray: [{ token: "[REDACTED]", visible: "kept" }],
      },
    });
    expect(JSON.stringify(insert?.args[0])).not.toContain("sk-secret");
    expect(JSON.stringify(insert?.args[0])).not.toContain("secret-token");
  });

  it("never throws and warns when the insert fails (audit must not block the tool)", async () => {
    mocks.from.mockReturnValue(makeBuilder({ data: null, error: { message: "boom" } }));
    const { recordWorkflowAudit } = await mod();

    await expect(recordWorkflowAudit(entry)).resolves.toBeUndefined();
    expect(mocks.logWarn).toHaveBeenCalled();
  });
});

describe("queryWorkflowAudit", () => {
  it("always scopes by user_id and applies optional filters", async () => {
    const builder = makeBuilder({ data: [], error: null });
    mocks.from.mockReturnValue(builder);
    const { queryWorkflowAudit } = await mod();

    await queryWorkflowAudit({
      userId: "user-1",
      workflowId: "wf-9",
      operation: "delete",
    });

    const eqCols = builder.__calls.filter((c) => c.method === "eq").map((c) => c.args[0]);
    expect(eqCols).toContain("user_id");
    expect(eqCols).toContain("workflow_id");
    expect(eqCols).toContain("operation");
  });
});

describe("rollback audit lifecycle", () => {
  function withRow(row: Record<string, unknown> | null) {
    const lookup = makeBuilder({ data: row, error: null });
    mocks.from.mockReturnValue(lookup);
    return lookup;
  }

  it("loads a rollback snapshot without marking the audit row", async () => {
    const lookup = withRow({
      id: "a1",
      user_id: "user-1",
      is_rolled_back: false,
      snapshot_before: { name: "old" },
    });
    const { getRollbackSnapshotForUser } = await mod();

    const row = await getRollbackSnapshotForUser("user-1", "a1");

    expect(row.snapshot_before).toEqual({ name: "old" });
    expect(lookup.__calls.some((call) => call.method === "update")).toBe(false);
  });

  it("marks the audit row only during explicit finalization", async () => {
    const update = makeBuilder({ data: null, error: null });
    mocks.from.mockReturnValue(update);
    const { markAuditRolledBack } = await mod();

    await markAuditRolledBack("user-1", "a1");

    expect(update.__calls.some((call) => call.method === "update")).toBe(true);
    const eqCols = update.__calls
      .filter((call) => call.method === "eq")
      .map((call) => call.args[0]);
    expect(eqCols).toEqual(expect.arrayContaining(["id", "user_id", "is_rolled_back"]));
  });

  it("rejects when the row is missing or owned by another user", async () => {
    withRow(null);
    const { getRollbackSnapshotForUser } = await mod();
    await expect(getRollbackSnapshotForUser("user-1", "missing")).rejects.toThrow();
  });

  it("rejects an already-rolled-back row", async () => {
    withRow({ id: "a1", user_id: "user-1", is_rolled_back: true, snapshot_before: { name: "x" } });
    const { getRollbackSnapshotForUser } = await mod();
    await expect(getRollbackSnapshotForUser("user-1", "a1")).rejects.toThrow(/already/i);
  });

  it("rejects when there is no snapshot_before to restore", async () => {
    withRow({ id: "a1", user_id: "user-1", is_rolled_back: false, snapshot_before: null });
    const { getRollbackSnapshotForUser } = await mod();
    await expect(getRollbackSnapshotForUser("user-1", "a1")).rejects.toThrow();
  });
});

describe("audit migration", () => {
  it("creates workflow_audit_log with RLS and the operation enum", () => {
    const sql = migrationSqlContaining("create table public.workflow_audit_log");
    expect(sql).toContain("workflow_audit_operation");
    expect(sql).toContain("snapshot_before");
    expect(sql).toContain("snapshot_after");
    expect(sql).toContain("enable row level security");
    expect(sql).toContain("user_id = auth.uid()");
  });
});
