// Structured JSON logger for production (server-only).
// In dev: pretty-prints. In prod: emits one JSON object per line so VPS log
// collectors (docker logs → loki/promtail/journald) can parse them directly.
//
// Usage:
//   import { log } from "@/lib/logger.server";
//   log.info("checkout.session.completed", { user_id, tier });
//   log.error("stripe.webhook.invalid_signature", { err });
//
// PII rule: never log raw API keys, ciphertext, email bodies, or full request
// bodies. Log identifiers (user_id, request_id, key_prefix) instead.

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;
const FORMAT =
  process.env.LOG_FORMAT ?? (process.env.NODE_ENV === "production" ? "json" : "pretty");
const REDACTED = "[REDACTED]";
const SENSITIVE_KEYS = new Set([
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

export function getRequestId(request: Request): string {
  const supplied = request.headers.get("x-request-id")?.trim().slice(0, 128);
  return supplied || crypto.randomUUID();
}

export function createSafeErrorDto(message: string, requestId: string, sentryEventId?: string) {
  return {
    error: message,
    requestId,
    ...(sentryEventId ? { sentryEventId } : {}),
  };
}

export function sanitizeSentryEvent<T>(event: T): T {
  const sanitized = redactSensitiveData(event) as T;
  if (!sanitized || typeof sanitized !== "object") return sanitized;

  const request = (sanitized as { request?: unknown }).request;
  if (request && typeof request === "object" && !Array.isArray(request)) {
    delete (request as Record<string, unknown>).data;
  }

  return sanitized;
}

function emit(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (LEVELS[level] < MIN) return;
  const ts = new Date().toISOString();
  const payload: Record<string, unknown> = { ts, level, msg };
  const safeFields = fields ? (redactSensitiveData(fields) as Record<string, unknown>) : undefined;
  if (fields) {
    Object.assign(payload, safeFields);
  }
  if (FORMAT === "json") {
    // Single line — write directly to stdout/stderr for log collectors.
    const line = JSON.stringify(payload);
    if (level === "error" || level === "warn") console.error(line);
    else console.log(line);
  } else {
    const tag = `[${level.toUpperCase()}]`;
    if (level === "error" || level === "warn") console.error(ts, tag, msg, safeFields ?? "");
    else console.log(ts, tag, msg, safeFields ?? "");
  }
}

export const log = {
  debug: (msg: string, fields?: Record<string, unknown>) => emit("debug", msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => emit("info", msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => emit("warn", msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => emit("error", msg, fields),
};
