// Log fields for a caught error (server-only). Route handlers answer 5xx with
// a fixed message, so the only place the cause survives is the log line; this
// keeps class, message, SQLSTATE/PostgREST code and a short stack together.
// Message text goes through the logger's key-based redaction like any other
// field; callers must not pass errors whose message is itself a secret.

const MAX_MESSAGE = 500;
const MAX_STACK_LINES = 8;

export type ErrorLogFields = {
  errorType: string;
  err?: string;
  code?: string | number;
  stack?: string;
  cause?: string;
};

function codeOf(value: unknown): string | number | undefined {
  return typeof value === "string" || typeof value === "number" ? value : undefined;
}

function describe(value: unknown): string {
  if (value instanceof Error) return `${value.name}: ${value.message}`.slice(0, MAX_MESSAGE);
  if (value && typeof value === "object" && "message" in value) {
    return String((value as { message: unknown }).message).slice(0, MAX_MESSAGE);
  }
  return String(value).slice(0, MAX_MESSAGE);
}

export function errorFields(error: unknown): ErrorLogFields {
  if (error instanceof Error) {
    const fields: ErrorLogFields = {
      errorType: error.name || "Error",
      err: error.message.slice(0, MAX_MESSAGE),
    };
    const code = codeOf((error as { code?: unknown }).code);
    if (code !== undefined) fields.code = code;
    if (error.stack) fields.stack = error.stack.split("\n").slice(0, MAX_STACK_LINES).join("\n");
    if (error.cause !== undefined) fields.cause = describe(error.cause);
    return fields;
  }
  if (error && typeof error === "object") {
    // PostgREST/Supabase errors are plain objects: { message, code, details, hint }.
    const record = error as { name?: unknown; message?: unknown; code?: unknown };
    const fields: ErrorLogFields = {
      errorType: typeof record.name === "string" && record.name ? record.name : "object",
    };
    if (typeof record.message === "string") fields.err = record.message.slice(0, MAX_MESSAGE);
    const code = codeOf(record.code);
    if (code !== undefined) fields.code = code;
    return fields;
  }
  return { errorType: typeof error, err: String(error).slice(0, MAX_MESSAGE) };
}

/**
 * Whether Sentry receives events in this process (sentry.*.config.ts enable
 * the SDK only with a DSN). captureException still returns an id when the SDK
 * is disabled; logging that id would point operators at an event that was
 * never sent.
 */
export function sentryEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return Boolean(env.NEXT_PUBLIC_SENTRY_DSN?.trim());
}
