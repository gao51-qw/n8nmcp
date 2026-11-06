import { supabase } from "@/integrations/supabase/client";

/**
 * A failed API request. `message` is already user-presentable, parsed from
 * the shared `{ error: { code, message, requestId } }` shape, the legacy
 * `{ error: string, requestId? }` shape (support routes), or a plain-text
 * body. Pages can show `error.message` directly.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  /** The parsed JSON body, when there was one (e.g. a 409 `confirmation`). */
  readonly body?: unknown;

  constructor(
    message: string,
    options: { status: number; code?: string; requestId?: string; body?: unknown },
  ) {
    super(message);
    this.name = "ApiError";
    this.status = options.status;
    this.code = options.code ?? "request_failed";
    this.requestId = options.requestId;
    this.body = options.body;
  }
}

const MAX_TEXT_MESSAGE = 300;

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/** Builds an ApiError from a non-OK response; never throws itself. */
export async function apiErrorFromResponse(response: Response): Promise<ApiError> {
  const fallback = `Request failed (${response.status})`;
  const headerRequestId = response.headers.get("x-request-id") ?? undefined;
  const text = await response.text().catch(() => "");

  let body: unknown;
  try {
    body = text ? (JSON.parse(text) as unknown) : undefined;
  } catch {
    body = undefined;
  }

  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const error = record.error;
    if (error && typeof error === "object") {
      const structured = error as Record<string, unknown>;
      return new ApiError(asString(structured.message) ?? fallback, {
        status: response.status,
        code: asString(structured.code),
        requestId: asString(structured.requestId) ?? headerRequestId,
        body,
      });
    }
    return new ApiError(asString(error) ?? asString(record.message) ?? fallback, {
      status: response.status,
      requestId: asString(record.requestId) ?? headerRequestId,
      body,
    });
  }

  // Plain text (or an HTML error page from a proxy): show short text only.
  const plain = text.trim();
  const message =
    plain && plain.length <= MAX_TEXT_MESSAGE && !plain.startsWith("<") ? plain : fallback;
  return new ApiError(message, { status: response.status, requestId: headerRequestId });
}

export async function supportFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (error || !token) {
    throw new ApiError("Authentication required", {
      status: 401,
      code: "authentication_required",
    });
  }

  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  headers.set("authorization", `Bearer ${token}`);

  const response = await fetch(url, {
    ...init,
    headers,
  });

  if (!response.ok) {
    throw await apiErrorFromResponse(response);
  }

  return response.json() as Promise<T>;
}
