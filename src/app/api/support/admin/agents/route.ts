import { getRequestId } from "@/lib/logger.server";
import { listAdminAgents } from "@/lib/support/admin.server";
import { requireSupportAdmin } from "@/lib/support/auth.server";
import { supportJson, supportRouteError } from "../../tickets/_route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    await requireSupportAdmin(request);
    const agents = await listAdminAgents();
    return supportJson({ agents }, requestId);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}
