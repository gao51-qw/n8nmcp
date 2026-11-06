// POST → a one-time Paddle customer portal URL for the signed-in user, where
// they can update the payment method, see invoices or cancel.
import { createCustomerPortalUrl } from "@/lib/billing/billing.server";
import { apiJson, withApiErrors } from "@/lib/http/api-response.server";
import { requireSupportUser } from "@/lib/support/auth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const user = await requireSupportUser(request);
      return apiJson({ url: await createCustomerPortalUrl(user.userId) }, { requestId });
    },
    {
      logEvent: "billing.portal_failed",
      internalMessage: "The billing portal could not be opened.",
    },
  );
}
