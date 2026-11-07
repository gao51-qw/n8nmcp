import { isBillingCronAuthorized } from "@/lib/billing/cron-auth.server";
import { syncPaddleSubscriptions } from "@/lib/billing/subscription-sync.server";
import { errorFields } from "@/lib/error-fields.server";
import { getRequestId, log } from "@/lib/logger.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  if (!isBillingCronAuthorized(request)) {
    return Response.json(
      { error: "Unauthorized", requestId },
      { status: 401, headers: { "x-request-id": requestId } },
    );
  }

  try {
    const subscriptionSync = await syncPaddleSubscriptions({ limit: 50 });
    return Response.json({ subscriptionSync }, { headers: { "x-request-id": requestId } });
  } catch (error) {
    log.error("billing.subscription_sync.failed", { requestId, ...errorFields(error) });
    return Response.json(
      { error: "Billing subscription sync failed", requestId },
      { status: 500, headers: { "x-request-id": requestId } },
    );
  }
}
