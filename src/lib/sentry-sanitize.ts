// Redaction shared by the server logger and the three Sentry inits (server,
// edge, browser). Pure and dependency-free so the browser bundle can use it.
//
// PII rule: never log raw API keys, ciphertext, email bodies, or full request
// bodies. Keys are matched after dropping `_`/`-` and lower-casing, so
// `access_token`, `accessToken` and `ACCESS-TOKEN` are all redacted.

const REDACTED = "[REDACTED]";

export const SENSITIVE_KEYS: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "cookies",
  "apikey",
  "password",
  "token",
  "accesstoken",
  "refreshtoken",
  "secret",
  "session",
  "body",
  "attachments",
  "attachmentmetadata",
  "chattext",
  "chatmessage",
  "messagebody",
  "replybody",
]);

function normalizedKey(key: string): string {
  return key.replace(/[_-]/g, "").toLowerCase();
}

export function redactSensitiveData(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown {
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[CIRCULAR]";
  seen.add(value);

  if (value instanceof Error) {
    return redactSensitiveData(
      { name: value.name, message: value.message, stack: value.stack },
      seen,
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveData(item, seen));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.has(normalizedKey(key)) ? REDACTED : redactSensitiveData(item, seen),
    ]),
  );
}

/** Sentry `beforeSend`: redacts sensitive keys and drops the request body. */
export function sanitizeSentryEvent<T>(event: T): T {
  const sanitized = redactSensitiveData(event) as T;
  if (!sanitized || typeof sanitized !== "object") return sanitized;

  const request = (sanitized as { request?: unknown }).request;
  if (request && typeof request === "object" && !Array.isArray(request)) {
    delete (request as Record<string, unknown>).data;
  }

  return sanitized;
}
