import { loadWorkflowAgentConsoleData } from "@/lib/dashboard-agent-console";
import { apiJson, withApiErrors } from "@/lib/http/api-response.server";
import { requireSupportUser } from "@/lib/support/auth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const user = await requireSupportUser(request);
      const url = new URL(request.url);
      const workflowId = url.searchParams.get("workflowId") || undefined;
      const data = await loadWorkflowAgentConsoleData(user.userId, { workflowId });
      return apiJson({ data }, { requestId });
    },
    { internalMessage: "Agent console request failed", logEvent: "agent_console.load_failed" },
  );
}
