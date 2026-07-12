import { getRequestId } from "@/lib/logger.server";
import { loadWorkflowAgentConsoleData } from "@/lib/dashboard-agent-console";
import { requireSupportUser } from "@/lib/support/auth.server";
import { supportJson, supportRouteError } from "@/app/api/support/tickets/_route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await requireSupportUser(request);
    const url = new URL(request.url);
    const workflowId = url.searchParams.get("workflowId") || undefined;
    const data = await loadWorkflowAgentConsoleData(user.userId, { workflowId });
    return supportJson({ data }, requestId);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}
