import { createHash, timingSafeEqual } from "node:crypto";
import { getRequestId, log } from "@/lib/logger.server";
import { cleanupExpiredSupportAttachments, scanSupportSla } from "@/lib/support/maintenance.server";
import { processSupportNotificationOutbox } from "@/lib/support/notifications.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.SUPPORT_CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;

  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization.slice(7)), digest(secret));
}

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  if (!authorized(request)) {
    return Response.json(
      { error: "Unauthorized", requestId },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }

  try {
    const sla = await scanSupportSla();
    const attachments = await cleanupExpiredSupportAttachments();
    const outbox = await processSupportNotificationOutbox(10);
    return Response.json({ sla, attachments, outbox }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    log.error("support.maintenance.failed", {
      requestId,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return Response.json(
      { error: "Support maintenance failed", requestId },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }
}
