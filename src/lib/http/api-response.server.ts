// Shared JSON response contract for the dashboard and OAuth-grant APIs.
//
// Every error is `{ error: { code, message, requestId? } }` with
// `Cache-Control: no-store`, so browser code can always read
// `payload.error.message` (see ApiError in `src/lib/support/http.client.ts`).
//
// Only messages that are meant for the user are passed through: HttpError,
// ZodError (fixed text) and the domain error classes a route lists in
// `expose`. Anything else becomes a generic 500 and is logged and reported.
import * as Sentry from "@sentry/nextjs";
import { ZodError } from "zod";
import { getRequestId, log } from "@/lib/logger.server";

export const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex,nofollow",
} as const;

export type ApiErrorPayload = { code: string; message: string; requestId?: string };
export type ApiErrorBody = { error: ApiErrorPayload };

/** An error whose status, code and message are safe to return as-is. */
export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/** A domain error class (e.g. ApiKeyError) whose message is written for users. */
export type ExposedErrorClass = abstract new (...args: never[]) => Error & { status: number };

export type ApiErrorOptions = {
  /** Domain error classes whose `message` and `status` may be returned. */
  expose?: readonly ExposedErrorClass[];
  /** Message for a ZodError (default "Invalid request"). */
  invalidRequestMessage?: string;
  /** Message for unexpected errors (default "Request failed"). */
  internalMessage?: string;
  /** Log event name for unexpected errors (default "api.request_failed"). */
  logEvent?: string;
};

export type ApiContext = { requestId: string };

const STATUS_CODES: Record<number, string> = {
  400: "invalid_request",
  401: "authentication_required",
  403: "forbidden",
  404: "not_found",
  405: "method_not_allowed",
  409: "conflict",
  410: "gone",
  413: "payload_too_large",
  415: "unsupported_media_type",
  422: "unprocessable_entity",
  429: "rate_limited",
  502: "upstream_error",
  503: "service_unavailable",
  504: "upstream_timeout",
};

const STATUS_MESSAGES: Record<number, string> = {
  400: "Invalid request",
  401: "Authentication required",
  403: "Forbidden",
  404: "Not found",
  405: "Method not allowed",
  409: "Conflict",
  413: "Request too large",
  415: "Unsupported media type",
  422: "Invalid request",
  429: "Too many requests",
};

/** Stable machine-readable code for an HTTP status. */
export function errorCodeForStatus(status: number): string {
  return STATUS_CODES[status] ?? (status >= 500 ? "internal_error" : "request_failed");
}

function isErrorStatus(status: unknown): status is number {
  return typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599;
}

function buildHeaders(requestId: string | undefined, extra?: HeadersInit): Headers {
  const headers = new Headers(NO_STORE_HEADERS);
  if (requestId) headers.set("x-request-id", requestId);
  if (extra) new Headers(extra).forEach((value, key) => headers.set(key, value));
  return headers;
}

/** A no-store JSON response; adds `x-request-id` when one is given. */
export function apiJson(
  body: unknown,
  init: { status?: number; requestId?: string; headers?: HeadersInit } = {},
): Response {
  return Response.json(body, {
    status: init.status ?? 200,
    headers: buildHeaders(init.requestId, init.headers),
  });
}

/**
 * A no-store JSON error in the shared shape. `extra` adds top-level fields
 * next to `error` (e.g. the agent-console `confirmation` challenge).
 */
export function jsonError(
  status: number,
  code: string,
  message: string,
  options: { requestId?: string; headers?: HeadersInit; extra?: Record<string, unknown> } = {},
): Response {
  const body = {
    ...options.extra,
    error: {
      code,
      message,
      ...(options.requestId ? { requestId: options.requestId } : {}),
    },
  } satisfies ApiErrorBody;
  return apiJson(body, { status, requestId: options.requestId, headers: options.headers });
}

/** Maps a thrown value to the shared JSON error response. */
export function apiErrorResponse(
  error: unknown,
  requestId: string,
  options: ApiErrorOptions = {},
): Response {
  if (error instanceof HttpError && isErrorStatus(error.status)) {
    return jsonError(error.status, error.code, error.message, { requestId });
  }

  const exposed = options.expose?.some((ErrorClass) => error instanceof ErrorClass);
  if (exposed && error instanceof Error) {
    const status = (error as Error & { status: unknown }).status;
    if (isErrorStatus(status)) {
      return jsonError(status, errorCodeForStatus(status), error.message, { requestId });
    }
  }

  if (error instanceof ZodError) {
    return jsonError(400, "invalid_request", options.invalidRequestMessage ?? "Invalid request", {
      requestId,
    });
  }

  // requireSupportUser / requireSupportAdmin throw a Response. Its body is
  // not reused; the status picks a fixed message.
  if (error instanceof Response && error.status >= 400 && error.status < 500) {
    return jsonError(
      error.status,
      errorCodeForStatus(error.status),
      STATUS_MESSAGES[error.status] ?? "Request failed",
      { requestId },
    );
  }

  const sentryEventId = Sentry.captureException(error, { tags: { requestId, domain: "api" } });
  log.error(options.logEvent ?? "api.request_failed", {
    requestId,
    sentryEventId,
    errorType: error instanceof Error ? error.name : typeof error,
  });
  return jsonError(500, "internal_error", options.internalMessage ?? "Request failed", {
    requestId,
  });
}

/**
 * Runs a route handler with the shared error mapping. The handler gets the
 * request id; its response gets `x-request-id` unless it already has one.
 *
 *   export async function GET(request: Request) {
 *     return withApiErrors(request, async ({ requestId }) => {
 *       const user = await requireSupportUser(request);
 *       return apiJson({ keys: await listApiKeys(user.userId) }, { requestId });
 *     }, { expose: [ApiKeyError] });
 *   }
 */
export async function withApiErrors(
  request: Request,
  handler: (context: ApiContext) => Promise<Response>,
  options: ApiErrorOptions = {},
): Promise<Response> {
  const requestId = getRequestId(request);
  try {
    const response = await handler({ requestId });
    if (!response.headers.has("x-request-id")) {
      try {
        response.headers.set("x-request-id", requestId);
      } catch {
        // Immutable headers (e.g. a proxied fetch response): leave as-is.
      }
    }
    return response;
  } catch (error) {
    return apiErrorResponse(error, requestId, options);
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A UUID route parameter, or a 404 HttpError (an invalid id names no resource). */
export function parseUuidParam(value: unknown, notFoundMessage = "Not found"): string {
  if (typeof value !== "string" || !UUID.test(value)) {
    throw new HttpError(404, "not_found", notFoundMessage);
  }
  return value;
}

/** The JSON body if it is an object, otherwise null (missing or invalid JSON). */
export async function readJsonObject(request: Request): Promise<Record<string, unknown> | null> {
  const body: unknown = await request.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
}

/** The parsed JSON body, or a 400 HttpError when it is not valid JSON. */
export async function readJsonBody(request: Request): Promise<unknown> {
  try {
    return (await request.json()) as unknown;
  } catch {
    throw new HttpError(400, "invalid_json", "Request body must be valid JSON");
  }
}
