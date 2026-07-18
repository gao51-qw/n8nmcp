import { getRequestId } from "@/lib/logger.server";
import { heartbeatAndAssignTickets } from "@/lib/support/admin.server";
import { requireSupportAdmin } from "@/lib/support/auth.server";
import { supportJson, supportRouteError } from "../../tickets/_route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireSupportAdmin(request);
    const result = await heartbeatAndAssignTickets(admin.userId);
    return supportJson(result, requestId);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}
