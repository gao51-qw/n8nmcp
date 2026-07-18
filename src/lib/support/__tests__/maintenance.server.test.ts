import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  logWarn: vi.fn(),
  outbox: vi.fn(),
  remove: vi.fn(),
  rpc: vi.fn(),
  scan: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: mocks.rpc,
    storage: {
      from: vi.fn(() => ({ remove: mocks.remove })),
    },
  },
}));

vi.mock("@/lib/logger.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger.server")>();
  return {
    ...actual,
    log: {
      ...actual.log,
      warn: mocks.logWarn,
    },
  };
});

type CleanupClaim = {
  path: string;
  name: string;
  ticket_id: string;
  expired_at: string;
};

function claim(index: number, overrides: Partial<CleanupClaim> = {}): CleanupClaim {
  return {
    path: `user-1/ticket-1/file-${index}.png`,
    name: `file-${index}.png`,
    ticket_id: "ticket-1",
    expired_at: "2025-12-13T10:00:00.000Z",
    ...overrides,
  };
}

async function service() {
  vi.resetModules();
  return import("@/lib/support/maintenance.server");
}

describe("support SLA maintenance", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("delegates an idempotent scan that creates due-soon only once", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { dueSoonCreated: 1, breachedCreated: 0 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { dueSoonCreated: 0, breachedCreated: 0 },
        error: null,
      });
    const { scanSupportSla } = await service();

    await expect(scanSupportSla()).resolves.toEqual({
      dueSoonCreated: 1,
      breachedCreated: 0,
    });
    await expect(scanSupportSla()).resolves.toEqual({
      dueSoonCreated: 0,
      breachedCreated: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("support_scan_sla", {
      _due_soon_window_minutes: 15,
    });
  });

  it("reports a breach timestamp and event only once", async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: { dueSoonCreated: 0, breachedCreated: 1 },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { dueSoonCreated: 0, breachedCreated: 0 },
        error: null,
      });
    const { scanSupportSla } = await service();

    await expect(scanSupportSla()).resolves.toEqual({
      dueSoonCreated: 0,
      breachedCreated: 1,
    });
    await expect(scanSupportSla()).resolves.toEqual({
      dueSoonCreated: 0,
      breachedCreated: 0,
    });
  });

  it("uses a database scan contract that ignores resolved and closed tickets", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: {
        dueSoonCreated: 0,
        breachedCreated: 0,
        ignoredStatuses: ["resolved", "closed"],
      },
      error: null,
    });
    const { scanSupportSla } = await service();

    await expect(scanSupportSla()).resolves.toEqual({
      dueSoonCreated: 0,
      breachedCreated: 0,
    });
  });
});

describe("support attachment retention", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-11T10:00:00.000Z"));
  });

  it("claims attachments whose absolute expiresAt is at or before now", async () => {
    mocks.rpc
      .mockResolvedValueOnce({ data: [claim(1)], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.remove.mockResolvedValue({ data: [], error: null });
    const { cleanupExpiredSupportAttachments } = await service();

    await expect(cleanupExpiredSupportAttachments()).resolves.toEqual({
      claimed: 1,
      removed: 1,
      failed: 0,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "support_claim_expired_attachments", {
      _expired_before: "2026-06-11T10:00:00.000Z",
      _limit: 100,
    });
    expect(mocks.remove).toHaveBeenCalledWith(["user-1/ticket-1/file-1.png"]);
  });

  it("finalizes cleanup with only pathHash, name, and expiredAt event metadata", async () => {
    const expired = claim(1);
    mocks.rpc
      .mockResolvedValueOnce({ data: [expired], error: null })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.remove.mockResolvedValue({ data: [], error: null });
    const { cleanupExpiredSupportAttachments } = await service();

    await cleanupExpiredSupportAttachments();

    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "support_complete_attachment_cleanup", {
      _path: expired.path,
      _ticket_id: expired.ticket_id,
      _event_payload: {
        pathHash: createHash("sha256").update(expired.path).digest("hex"),
        name: expired.name,
        expiredAt: expired.expired_at,
      },
    });
    const payload = mocks.rpc.mock.calls[1][1]._event_payload;
    expect(Object.keys(payload)).toEqual(["pathHash", "name", "expiredAt"]);
    expect(JSON.stringify(payload)).not.toContain(expired.path);
  });

  it("bounds cleanup claims and processing to at most 100 objects", async () => {
    mocks.rpc.mockResolvedValueOnce({
      data: Array.from({ length: 101 }, (_, index) => claim(index)),
      error: null,
    });
    mocks.remove.mockResolvedValue({ data: [], error: null });
    for (let index = 0; index < 100; index += 1) {
      mocks.rpc.mockResolvedValueOnce({ data: true, error: null });
    }
    const { cleanupExpiredSupportAttachments } = await service();

    await expect(cleanupExpiredSupportAttachments(500)).resolves.toEqual({
      claimed: 100,
      removed: 100,
      failed: 0,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "support_claim_expired_attachments", {
      _expired_before: "2026-06-11T10:00:00.000Z",
      _limit: 100,
    });
    expect(mocks.remove).toHaveBeenCalledTimes(100);
  });

  it("logs a resolved release RPC error and continues processing later claims", async () => {
    const first = claim(1);
    const second = claim(2);
    mocks.rpc
      .mockResolvedValueOnce({ data: [first, second], error: null })
      .mockResolvedValueOnce({ data: false, error: { message: "finalize failed" } })
      .mockResolvedValueOnce({ data: null, error: { message: "release secret" } })
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.remove.mockResolvedValue({ data: [], error: null });
    const { cleanupExpiredSupportAttachments } = await service();

    await expect(cleanupExpiredSupportAttachments()).resolves.toEqual({
      claimed: 2,
      removed: 1,
      failed: 1,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(3, "support_fail_attachment_cleanup", {
      _path: first.path,
    });
    expect(mocks.remove).toHaveBeenCalledWith([second.path]);
    expect(mocks.logWarn).toHaveBeenCalledWith("support.attachment.claim_release_failed", {
      ticketId: first.ticket_id,
      pathHash: createHash("sha256").update(first.path).digest("hex"),
      errorType: "Error",
    });
    expect(JSON.stringify(mocks.logWarn.mock.calls)).not.toContain("release secret");
  });

  it("logs a rejected release RPC and continues processing later claims", async () => {
    const first = claim(1);
    const second = claim(2);
    mocks.rpc
      .mockResolvedValueOnce({ data: [first, second], error: null })
      .mockResolvedValueOnce({ data: false, error: { message: "finalize failed" } })
      .mockRejectedValueOnce(new TypeError("release secret"))
      .mockResolvedValueOnce({ data: true, error: null });
    mocks.remove.mockResolvedValue({ data: [], error: null });
    const { cleanupExpiredSupportAttachments } = await service();

    await expect(cleanupExpiredSupportAttachments()).resolves.toEqual({
      claimed: 2,
      removed: 1,
      failed: 1,
    });
    expect(mocks.remove).toHaveBeenCalledWith([second.path]);
    expect(mocks.logWarn).toHaveBeenCalledWith("support.attachment.claim_release_failed", {
      ticketId: first.ticket_id,
      pathHash: createHash("sha256").update(first.path).digest("hex"),
      errorType: "TypeError",
    });
    expect(JSON.stringify(mocks.logWarn.mock.calls)).not.toContain("release secret");
  });
});

describe("support maintenance cron route", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.doMock("@/lib/support/maintenance.server", () => ({
      scanSupportSla: mocks.scan,
      cleanupExpiredSupportAttachments: mocks.cleanup,
    }));
    vi.doMock("@/lib/support/notifications.server", () => ({
      processSupportNotificationOutbox: mocks.outbox,
    }));
    process.env.SUPPORT_CRON_SECRET = "cron-secret";
  });

  it.each([undefined, "Bearer wrong", "Basic cron-secret"])(
    "rejects invalid cron authorization",
    async (authorization) => {
      const { POST } = await import("@/app/api/internal/support/run-maintenance/route");
      const response = await POST(
        new Request("https://example.test/api/internal/support/run-maintenance", {
          method: "POST",
          headers: authorization ? { authorization } : undefined,
        }),
      );

      expect(response.status).toBe(401);
      expect(mocks.scan).not.toHaveBeenCalled();
      expect(mocks.cleanup).not.toHaveBeenCalled();
      expect(mocks.outbox).not.toHaveBeenCalled();
    },
  );

  it("runs SLA scan, cleanup, then a bounded Task 9 outbox pass", async () => {
    mocks.scan.mockResolvedValue({ dueSoonCreated: 1, breachedCreated: 1 });
    mocks.cleanup.mockResolvedValue({ claimed: 2, removed: 2, failed: 0 });
    mocks.outbox.mockResolvedValue({ claimed: 3, sent: 3, failed: 0 });
    const { POST } = await import("@/app/api/internal/support/run-maintenance/route");

    const response = await POST(
      new Request("https://example.test/api/internal/support/run-maintenance", {
        method: "POST",
        headers: {
          authorization: "Bearer cron-secret",
          "x-request-id": "request-1",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("x-request-id")).toBe("request-1");
    expect(mocks.scan.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.cleanup.mock.invocationCallOrder[0],
    );
    expect(mocks.cleanup.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.outbox.mock.invocationCallOrder[0],
    );
    expect(mocks.outbox).toHaveBeenCalledWith(10);
    expect(await response.json()).toEqual({
      sla: { dueSoonCreated: 1, breachedCreated: 1 },
      attachments: { claimed: 2, removed: 2, failed: 0 },
      outbox: { claimed: 3, sent: 3, failed: 0 },
    });
  });
});
