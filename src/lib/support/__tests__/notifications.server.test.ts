import { createHmac } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  logError: vi.fn(),
  logWarn: vi.fn(),
  processOutbox: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: { rpc: mocks.rpc },
}));

vi.mock("@/lib/logger.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger.server")>();
  return {
    ...actual,
    log: {
      ...actual.log,
      error: mocks.logError,
      warn: mocks.logWarn,
    },
  };
});

vi.mock("@/lib/support/notifications.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/support/notifications.server")>();
  return {
    ...actual,
    processSupportNotificationOutbox: mocks.processOutbox,
  };
});

type OutboxRow = {
  id: string;
  ticket_id: string;
  channel: "resend" | "n8n";
  event_type: string;
  payload: Record<string, unknown>;
  idempotency_key: string;
  status: "pending" | "processing" | "sent" | "failed";
  attempt_count: number;
  lease_token: string;
};

function row(overrides: Partial<OutboxRow> = {}): OutboxRow {
  return {
    id: "outbox-1",
    ticket_id: "ticket-1",
    channel: "n8n",
    event_type: "ticket.created",
    payload: {
      eventType: "ticket.created",
      ticketId: "ticket-1",
      priority: "urgent",
      status: "open",
      assignedTo: null,
      firstResponseDueAt: "2026-06-11T12:00:00.000Z",
      requestId: "request-1",
    },
    idempotency_key: "ticket-1:ticket.created:n8n",
    status: "processing",
    attempt_count: 0,
    lease_token: "lease-token-1",
    ...overrides,
  };
}

async function service() {
  vi.doUnmock("@/lib/support/notifications.server");
  return import("@/lib/support/notifications.server");
}

function migrationSqlContaining(fragment: string): string {
  const migrations = resolve(process.cwd(), "supabase", "migrations");
  const match = readdirSync(migrations)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => readFileSync(resolve(migrations, file), "utf8"))
    .find((sql) => sql.includes(fragment));

  expect(match, `migration containing ${fragment}`).toBeDefined();
  return match!;
}

describe("support notification outbox", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T10:00:00.000Z"));
    process.env.SUPPORT_EMAIL_FROM = "support@example.com";
    process.env.SUPPORT_N8N_WEBHOOK_URL = "https://n8n.example.test/webhook/support";
    process.env.SUPPORT_N8N_WEBHOOK_SECRET = "webhook-secret";
    delete process.env.RESEND_API_KEY;
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete process.env.RESEND_API_KEY;
  });

  it("marks missing RESEND_API_KEY failed without throwing", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [
          row({
            channel: "resend",
            idempotency_key: "ticket-1:ticket.created:resend",
            payload: {
              eventType: "ticket.created",
              ticketId: "ticket-1",
              recipientEmail: "user@example.com",
            },
          }),
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });
    const { processSupportNotificationOutbox } = await service();

    await expect(processSupportNotificationOutbox()).resolves.toEqual({
      claimed: 1,
      sent: 0,
      failed: 1,
    });
    expect(mocks.fetch).not.toHaveBeenCalled();
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "support_fail_notification_outbox", {
      _id: "outbox-1",
      _lease_token: "lease-token-1",
      _error: "RESEND_API_KEY is not configured",
      _http_status: null,
      _terminal: true,
    });
  });

  it("sends a timestamped HMAC SHA-256 n8n request with a strict safe payload", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [
          row({
            payload: {
              ...row().payload,
              body: "private message",
              attachments: [{ path: "secret" }],
              recipientEmail: "user@example.com",
              email: "other@example.com",
            },
          }),
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.fetch.mockResolvedValue(new Response(null, { status: 204 }));
    const { processSupportNotificationOutbox } = await service();

    await expect(processSupportNotificationOutbox()).resolves.toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
    });

    const [url, init] = mocks.fetch.mock.calls[0] as [string, RequestInit];
    const body = String(init.body);
    const timestamp = "1781172000";
    expect(url).toBe("https://n8n.example.test/webhook/support");
    expect(JSON.parse(body)).toEqual(row().payload);
    expect(body).not.toContain("private message");
    expect(body).not.toContain("user@example.com");
    expect(init.headers).toMatchObject({
      "content-type": "application/json",
      "Idempotency-Key": "ticket-1:ticket.created:n8n",
      "x-support-timestamp": timestamp,
      "x-support-signature": createHmac("sha256", "webhook-secret")
        .update(`${timestamp}.${body}`)
        .digest("hex"),
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "support_complete_notification_outbox", {
      _id: "outbox-1",
      _lease_token: "lease-token-1",
    });
  });

  it("marks successful Resend delivery sent and supplies its idempotency key", async () => {
    process.env.RESEND_API_KEY = "re_test";
    mocks.rpc
      .mockResolvedValueOnce({
        data: [
          row({
            channel: "resend",
            idempotency_key: "ticket-1:ticket.created:resend",
            payload: {
              eventType: "ticket.created",
              ticketId: "ticket-1",
              recipientEmail: "user@example.com",
            },
          }),
        ],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.fetch.mockResolvedValue(
      new Response(JSON.stringify({ id: "email-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { processSupportNotificationOutbox } = await service();

    await expect(processSupportNotificationOutbox()).resolves.toEqual({
      claimed: 1,
      sent: 1,
      failed: 0,
    });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://api.resend.com/emails",
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer re_test",
          "Idempotency-Key": "ticket-1:ticket.created:resend",
        }),
      }),
    );
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "support_complete_notification_outbox", {
      _id: "outbox-1",
      _lease_token: "lease-token-1",
    });
  });

  it("delegates transient failure persistence to the outbox RPC", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: [row({ attempt_count: 2 })],
        error: null,
      })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.fetch.mockResolvedValue(new Response("unavailable", { status: 503 }));
    const { processSupportNotificationOutbox } = await service();

    await expect(processSupportNotificationOutbox()).resolves.toEqual({
      claimed: 1,
      sent: 0,
      failed: 1,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "support_fail_notification_outbox", {
      _id: "outbox-1",
      _lease_token: "lease-token-1",
      _error: "n8n returned HTTP 503",
      _http_status: 503,
      _terminal: false,
    });
  });

  it.each([
    [400, true],
    [404, true],
    [408, false],
    [429, false],
    [500, false],
  ])("classifies HTTP %i with terminal=%s", async (status, terminal) => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [row()], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.fetch.mockResolvedValue(new Response("delivery failed", { status }));
    const { processSupportNotificationOutbox } = await service();

    await processSupportNotificationOutbox();

    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "support_fail_notification_outbox", {
      _id: "outbox-1",
      _lease_token: "lease-token-1",
      _error: `n8n returned HTTP ${status}`,
      _http_status: status,
      _terminal: terminal,
    });
  });

  it("aborts a delivery request after the configured timeout", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [row()], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.fetch.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new DOMException("The operation was aborted", "AbortError")),
          );
        }),
    );
    const { processSupportNotificationOutbox } = await service();

    const processing = processSupportNotificationOutbox();
    await vi.advanceTimersByTimeAsync(10_000);
    await expect(processing).resolves.toEqual({ claimed: 1, sent: 0, failed: 1 });

    expect(mocks.fetch.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "support_fail_notification_outbox", {
      _id: "outbox-1",
      _lease_token: "lease-token-1",
      _error: "The operation was aborted",
      _http_status: null,
      _terminal: false,
    });
  });

  it("continues after delivery and fail-state RPC both fail for one claimed row", async () => {
    const first = row({
      id: "outbox-1",
      lease_token: "lease-token-1",
      payload: { ...row().payload, requestId: "request-private-1" },
    });
    const second = row({
      id: "outbox-2",
      ticket_id: "ticket-2",
      idempotency_key: "ticket-2:ticket.created:n8n",
      lease_token: "lease-token-2",
      payload: {
        ...row().payload,
        ticketId: "ticket-2",
        requestId: "request-2",
      },
    });
    mocks.rpc
      .mockResolvedValueOnce({ data: [first, second], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "database secret detail" } })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.fetch
      .mockRejectedValueOnce(new Error("delivery secret detail"))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const { processSupportNotificationOutbox } = await service();

    await expect(processSupportNotificationOutbox()).resolves.toEqual({
      claimed: 2,
      sent: 1,
      failed: 1,
    });
    expect(mocks.fetch).toHaveBeenCalledTimes(2);
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "support_fail_notification_outbox", {
      _id: "outbox-1",
      _lease_token: "lease-token-1",
      _error: "delivery secret detail",
      _http_status: null,
      _terminal: false,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, "support_complete_notification_outbox", {
      _id: "outbox-2",
      _lease_token: "lease-token-2",
    });
    expect(mocks.logError).toHaveBeenCalledWith(
      "support.notification.fail_state_update_failed",
      expect.objectContaining({
        ticketId: "ticket-1",
        channel: "n8n",
        attemptCount: 1,
        terminal: false,
        deliveryErrorType: "Error",
        persistenceErrorType: "Error",
      }),
    );
    expect(JSON.stringify(mocks.logError.mock.calls)).not.toContain("secret detail");
  });

  it("retains database guards for idempotency and bounded claim locking", () => {
    const tableSql = migrationSqlContaining("create table public.support_notification_outbox");
    const workerSql = migrationSqlContaining("function public.support_claim_notification_outbox");

    expect(tableSql).toMatch(/idempotency_key\s+text\s+not null\s+unique/i);
    expect(workerSql).toMatch(/for\s+update\s+skip\s+locked/i);
    expect(workerSql).toMatch(/limit\s+least\(greatest\(coalesce\(_limit,\s*25\),\s*1\),\s*25\)/i);
  });

  it("defines token-isolated recoverable leases and an eight-attempt SQL cap", () => {
    const workerSql = migrationSqlContaining("support notification outbox leases");

    expect(workerSql).toMatch(/add column if not exists claimed_at timestamptz/i);
    expect(workerSql).toMatch(/add column if not exists lease_token uuid/i);
    expect(workerSql).toMatch(
      /status = 'processing'.*claimed_at <= now\(\) - interval '5 minutes'/is,
    );
    expect(workerSql).toMatch(/lease_token = gen_random_uuid\(\)/i);
    expect(workerSql).toMatch(/where id = _id.*lease_token = _lease_token/is);
    expect(workerSql).toMatch(/attempt_count \+ 1 >= 8/i);
    expect(workerSql).toMatch(/processed_at = case.*attempt_count \+ 1 >= 8/is);
  });

  it("casts conditional outbox statuses to the enum type on PostgreSQL 17", () => {
    const workerSql = migrationSqlContaining("function public.support_claim_notification_outbox");
    const leaseSql = migrationSqlContaining("support notification outbox leases");

    expect(workerSql).toMatch(/end::public\.support_outbox_status/i);
    expect(leaseSql).toMatch(/end::public\.support_outbox_status/i);
  });
});

describe("support outbox cron route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock("@/lib/support/notifications.server", () => ({
      processSupportNotificationOutbox: mocks.processOutbox,
    }));
    process.env.SUPPORT_CRON_SECRET = "cron-secret";
  });

  it.each([undefined, "Bearer wrong", "Basic cron-secret"])(
    "rejects an invalid bearer credential using the protected route",
    async (authorization) => {
      const { POST } = await import("@/app/api/internal/support/process-outbox/route");
      const response = await POST(
        new Request("https://example.test/api/internal/support/process-outbox", {
          method: "POST",
          headers: authorization ? { authorization } : undefined,
        }),
      );

      expect(response.status).toBe(401);
      expect(mocks.processOutbox).not.toHaveBeenCalled();
    },
  );

  it("returns counts only for an authorized cron request", async () => {
    mocks.processOutbox.mockResolvedValue({
      claimed: 3,
      sent: 2,
      failed: 1,
      rows: [{ payload: { body: "must not leak" } }],
    });
    const { POST } = await import("@/app/api/internal/support/process-outbox/route");
    const response = await POST(
      new Request("https://example.test/api/internal/support/process-outbox", {
        method: "POST",
        headers: {
          authorization: "Bearer cron-secret",
          "x-request-id": "request-1",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("request-1");
    expect(await response.json()).toEqual({ claimed: 3, sent: 2, failed: 1 });
  });
});
