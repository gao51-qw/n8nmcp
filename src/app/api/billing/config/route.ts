// GET → Paddle.js checkout config plus the signed-in user's subscription.
// Only the public client token and price ID leave the server; the Paddle API
// key stays in src/lib/paddle.server.ts.
import { loadBillingConfig } from "@/lib/billing/billing.server";
import { apiJson, withApiErrors } from "@/lib/http/api-response.server";
import { requireSupportUser } from "@/lib/support/auth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const user = await requireSupportUser(request);
      return apiJson(await loadBillingConfig(user), { requestId });
    },
    { logEvent: "billing.config_failed", internalMessage: "Billing details could not be loaded." },
  );
}
