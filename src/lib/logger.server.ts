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

import { redactSensitiveData, sanitizeSentryEvent } from "@/lib/sentry-sanitize";

// The redaction lives in src/lib/sentry-sanitize.ts (shared with the browser
// and edge Sentry inits); re-exported here for existing imports.
export { redactSensitiveData, sanitizeSentryEvent };

type Level = "debug" | "info" | "warn" | "error";

const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MIN = LEVELS[(process.env.LOG_LEVEL as Level) ?? "info"] ?? 20;
const FORMAT =
  process.env.LOG_FORMAT ?? (process.env.NODE_ENV === "production" ? "json" : "pretty");

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
