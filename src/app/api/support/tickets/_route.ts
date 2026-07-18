import * as Sentry from "@sentry/nextjs";
import { ZodError } from "zod";
import { createSafeErrorDto, getRequestId, log } from "@/lib/logger.server";
import { SupportHttpError } from "@/lib/support/tickets.server";

export function supportJson(body: unknown, requestId: string, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "x-request-id": requestId },
  });
}

export function supportRouteError(error: unknown, requestId: string): Response {
  if (error instanceof ZodError) {
    return supportJson(
      {
        ...createSafeErrorDto("Invalid request", requestId),
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      requestId,
      400,
    );
  }
  if (
    (error instanceof Response || error instanceof SupportHttpError) &&
    error.status >= 400 &&
    error.status < 500
  ) {
    const message =
      error.status === 401
        ? "Authentication required"
        : error.status === 403
          ? "Forbidden"
          : error.status === 404
            ? "Not found"
            : error.status === 409
              ? "Conflict"
              : "Invalid request";
    return supportJson(createSafeErrorDto(message, requestId), requestId, error.status);
  }

  const sentryEventId = Sentry.captureException(error, {
    tags: { requestId, domain: "support" },
  });
  log.error("support.route.failed", {
    requestId,
    sentryEventId,
    errorType: error instanceof Error ? error.name : typeof error,
  });
  return supportJson(
    createSafeErrorDto("Support request failed", requestId, sentryEventId),
    requestId,
    500,
  );
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ZodError([
      {
        code: "custom",
        path: [],
        message: "Request body must be valid JSON",
      },
    ]);
  }
}
