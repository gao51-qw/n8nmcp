import { createHash, timingSafeEqual } from "node:crypto";
import { syncPaddleSubscriptions } from "@/lib/billing/subscription-sync.server";
import { getRequestId, log } from "@/lib/logger.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.BILLING_CRON_SECRET;
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
    const subscriptionSync = await syncPaddleSubscriptions({ limit: 50 });
    return Response.json({ subscriptionSync }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    log.error("billing.subscription_sync.failed", {
      requestId,
      errorType: error instanceof Error ? error.name : typeof error,
    });
    return Response.json(
      { error: "Billing subscription sync failed", requestId },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }
}
