import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger.server";

type DbError = { message?: string };
type DbResult = { data: unknown; error: DbError | null };

interface SupportMaintenanceDatabase {
  rpc(name: string, args: Record<string, unknown>): Promise<DbResult>;
  storage: {
    from(bucket: string): {
      remove(paths: string[]): Promise<{ data: unknown; error: DbError | null }>;
    };
  };
}

type AttachmentClaim = {
  path: string;
  name: string;
  ticket_id: string;
  expired_at: string;
};

export type SupportSlaScanCounts = {
  dueSoonCreated: number;
  breachedCreated: number;
};

export type SupportAttachmentCleanupCounts = {
  claimed: number;
  removed: number;
  failed: number;
};

const MAX_ATTACHMENT_CLEANUP_BATCH = 100;
const db = supabaseAdmin as unknown as SupportMaintenanceDatabase;

function databaseError(error: DbError | null, fallback: string): never {
  throw new Error(error?.message || fallback);
}

function validateDbResult(result: DbResult, fallback: string): void {
  if (result.error) databaseError(result.error, fallback);
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function boundedCleanupLimit(limit: number): number {
  return Math.max(1, Math.min(MAX_ATTACHMENT_CLEANUP_BATCH, Math.trunc(limit)));
}

function isAttachmentClaim(value: unknown): value is AttachmentClaim {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.path === "string" &&
    row.path.length > 0 &&
    typeof row.name === "string" &&
    row.name.length > 0 &&
    typeof row.ticket_id === "string" &&
    row.ticket_id.length > 0 &&
    typeof row.expired_at === "string" &&
    row.expired_at.length > 0
  );
}

export async function scanSupportSla(): Promise<SupportSlaScanCounts> {
  const result = await db.rpc("support_scan_sla", {
    _due_soon_window_minutes: 15,
  });
  if (result.error) databaseError(result.error, "Unable to scan support SLA");
  const data =
    result.data && typeof result.data === "object" ? (result.data as Record<string, unknown>) : {};
  return {
    dueSoonCreated: count(data.dueSoonCreated),
    breachedCreated: count(data.breachedCreated),
  };
}

export async function cleanupExpiredSupportAttachments(
  limit = MAX_ATTACHMENT_CLEANUP_BATCH,
): Promise<SupportAttachmentCleanupCounts> {
  const boundedLimit = boundedCleanupLimit(limit);
  const expiredBefore = new Date(Date.now()).toISOString();
  const claimed = await db.rpc("support_claim_expired_attachments", {
    _expired_before: expiredBefore,
    _limit: boundedLimit,
  });
  if (claimed.error) {
    databaseError(claimed.error, "Unable to claim expired support attachments");
  }

  const rows = (Array.isArray(claimed.data) ? claimed.data : [])
    .filter(isAttachmentClaim)
    .slice(0, boundedLimit);
  const counts: SupportAttachmentCleanupCounts = {
    claimed: rows.length,
    removed: 0,
    failed: 0,
  };

  for (const row of rows) {
    try {
      const removed = await db.storage.from("ticket-attachments").remove([row.path]);
      if (removed.error) databaseError(removed.error, "Unable to remove support attachment");

      const completed = await db.rpc("support_complete_attachment_cleanup", {
        _path: row.path,
        _ticket_id: row.ticket_id,
        _event_payload: {
          pathHash: createHash("sha256").update(row.path).digest("hex"),
          name: row.name,
          expiredAt: row.expired_at,
        },
      });
      if (completed.error || completed.data !== true) {
        databaseError(completed.error, "Unable to complete support attachment cleanup");
      }
      counts.removed += 1;
    } catch (error) {
      counts.failed += 1;
      log.warn("support.attachment.cleanup_failed", {
        ticketId: row.ticket_id,
        pathHash: createHash("sha256").update(row.path).digest("hex"),
        errorType: error instanceof Error ? error.name : typeof error,
      });
      try {
        const released = await db.rpc("support_fail_attachment_cleanup", { _path: row.path });
        validateDbResult(released, "Unable to release support attachment cleanup claim");
      } catch (releaseError) {
        log.warn("support.attachment.claim_release_failed", {
          ticketId: row.ticket_id,
          pathHash: createHash("sha256").update(row.path).digest("hex"),
          errorType: releaseError instanceof Error ? releaseError.name : typeof releaseError,
        });
        // A stale claim is reclaimable after its lease expires.
      }
    }
  }

  return counts;
}
