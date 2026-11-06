import { z } from "zod";

import { clientIp } from "@/lib/client-ip.server";
import {
  apiErrorResponse,
  apiJson,
  jsonError,
  readJsonBody,
  withApiErrors,
} from "@/lib/http/api-response.server";
import { requireSupportUser } from "@/lib/support/auth.server";
import { ConfirmationRequiredError } from "@/lib/workflow-agent/confirmation.server";
import {
  DashboardAgentActionError,
  executeDashboardAgentAction,
} from "@/lib/workflow-agent/dashboard-actions.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("apply"),
    previewCallId: z.string().uuid(),
    selectedOperationIndexes: z.array(z.number().int().nonnegative()).min(1),
    confirmationToken: z.string().min(1).optional(),
  }),
  z.object({
    action: z.literal("rollback"),
    auditLogId: z.string().uuid(),
    reason: z.string().trim().max(500).optional(),
    confirmationToken: z.string().min(1).optional(),
  }),
]);

export async function POST(request: Request): Promise<Response> {
  return withApiErrors(request, async ({ requestId }) => {
    try {
      const user = await requireSupportUser(request);
      const input = actionSchema.parse(await readJsonBody(request));
      const result = await executeDashboardAgentAction(user.userId, input, {
        requestId,
        ip: clientIp(request),
        userAgent: request.headers.get("user-agent") ?? undefined,
      });
      return apiJson(result, { requestId });
    } catch (error) {
      return actionErrorResponse(error, requestId);
    }
  });
}

// The agent-console client reads `error.message`, and on 409 the
// `confirmation` challenge next to `error`.
function actionErrorResponse(error: unknown, requestId: string): Response {
  if (error instanceof ConfirmationRequiredError) {
    return jsonError(409, error.code, error.message, {
      requestId,
      extra: {
        confirmation: {
          token: error.token,
          expiresAt: error.expiresAt,
          summary: error.summary,
        },
      },
    });
  }
  if (error instanceof DashboardAgentActionError) {
    return jsonError(error.status, error.code, error.message, { requestId });
  }
  return apiErrorResponse(error, requestId, {
    invalidRequestMessage: "Invalid action request",
    internalMessage: "Workflow action failed",
    logEvent: "agent_console.action_failed",
  });
}
