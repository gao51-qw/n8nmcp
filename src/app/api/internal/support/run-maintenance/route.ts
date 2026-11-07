import { createHash, timingSafeEqual } from "node:crypto";
import { errorFields } from "@/lib/error-fields.server";
import { getRequestId, log } from "@/lib/logger.server";
import { cleanupExpiredSupportAttachments, scanSupportSla } from "@/lib/support/maintenance.server";
import { processSupportNotificationOutbox } from "@/lib/support/notifications.server";
import { pruneMcpEphemeralState } from "@/lib/mcp-shared-state.server";

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
    // Expired MCP elicitations and request-state nonces (never fails the run).
    const mcpStatePruned = await pruneMcpEphemeralState();
    return Response.json(
      { sla, attachments, outbox, mcpStatePruned },
      { headers: { "x-request-id": requestId } },
    );
  } catch (error) {
    log.error("support.maintenance.failed", { requestId, ...errorFields(error) });
    return Response.json(
      { error: "Support maintenance failed", requestId },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }
}
