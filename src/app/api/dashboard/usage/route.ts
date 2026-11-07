// MCP usage of the signed-in user.
//   GET ?recent=1..100 → { usage: DashboardUsage }
// Errors use the shared { error: { code, message, requestId } } shape; every
// response is no-store.
import { z } from "zod";
import { errorFields } from "@/lib/error-fields.server";
import { apiJson, jsonError, withApiErrors } from "@/lib/http/api-response.server";
import { log } from "@/lib/logger.server";
import { requireSupportUser } from "@/lib/support/auth.server";
import {
  loadDashboardUsage,
  USAGE_RECENT_DEFAULT,
  USAGE_RECENT_MAX,
  UsageUnavailableError,
} from "@/lib/usage.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  recent: z.coerce.number().int().min(1).max(USAGE_RECENT_MAX).default(USAGE_RECENT_DEFAULT),
});

export async function GET(request: Request) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const user = await requireSupportUser(request);

      const params = new URL(request.url).searchParams;
      const query = querySchema.safeParse({ recent: params.get("recent") ?? undefined });
      if (!query.success) {
        return jsonError(
          400,
          "invalid_request",
          `recent must be a whole number from 1 to ${USAGE_RECENT_MAX}.`,
          { requestId },
        );
      }

      try {
        const usage = await loadDashboardUsage(user.userId, { recentLimit: query.data.recent });
        return apiJson({ usage }, { requestId });
      } catch (error) {
        if (!(error instanceof UsageUnavailableError)) throw error;
        log.error("dashboard.usage.failed", {
          requestId,
          source: error.source,
          ...errorFields(error.cause ?? error),
        });
        return jsonError(
          500,
          "usage_unavailable",
          "Usage data is unavailable right now. Try again in a moment.",
          { requestId },
        );
      }
    },
    {
      logEvent: "dashboard.usage.failed",
      internalMessage: "Usage data is unavailable right now. Try again in a moment.",
    },
  );
}
