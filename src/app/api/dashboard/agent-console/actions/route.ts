import { z } from "zod";

import { getRequestId } from "@/lib/logger.server";
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
  const requestId = getRequestId(request);
  try {
    const user = await requireSupportUser(request);
    const input = actionSchema.parse(await request.json());
    const result = await executeDashboardAgentAction(user.userId, input, {
      requestId,
      ip: (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || undefined,
      userAgent: request.headers.get("user-agent") ?? undefined,
    });
    return json(result, requestId);
  } catch (error) {
    if (error instanceof ConfirmationRequiredError) {
      return json(
        {
          error: {
            code: error.code,
            message: error.message,
            requestId,
          },
          confirmation: {
            token: error.token,
            expiresAt: error.expiresAt,
            summary: error.summary,
          },
        },
        requestId,
        409,
      );
    }
    if (error instanceof DashboardAgentActionError) {
      return json(
        { error: { code: error.code, message: error.message, requestId } },
        requestId,
        error.status,
      );
    }
    if (error instanceof z.ZodError || error instanceof SyntaxError) {
      return json(
        { error: { code: "invalid_request", message: "Invalid action request", requestId } },
        requestId,
        400,
      );
    }
    if (error instanceof Response) {
      return json(
        {
          error: {
            code: error.status === 401 ? "authentication_required" : "request_failed",
            message: error.status === 401 ? "Authentication required" : "Request failed",
            requestId,
          },
        },
        requestId,
        error.status,
      );
    }
    return json(
      { error: { code: "internal_error", message: "Workflow action failed", requestId } },
      requestId,
      500,
    );
  }
}

function json(body: unknown, requestId: string, status = 200): Response {
  return Response.json(body, { status, headers: { "x-request-id": requestId } });
}
