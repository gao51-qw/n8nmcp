import * as Sentry from "@sentry/nextjs";
import type { Event as SentryEvent } from "@sentry/core";

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

function scrub(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_KEYS.has(key.replace(/[_-]/g, "").toLowerCase()) ? "[REDACTED]" : scrub(item),
    ]),
  );
}

export function sanitizeSentryEvent<T>(event: T): T {
  const sanitized = scrub(event) as T;
  if (!sanitized || typeof sanitized !== "object") return sanitized;

  const request = (sanitized as { request?: unknown }).request;
  if (request && typeof request === "object" && !Array.isArray(request)) {
    delete (request as Record<string, unknown>).data;
  }

  return sanitized;
}

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  sendDefaultPii: false,
  enableLogs: true,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.05"),
  beforeSend(event: SentryEvent) {
    return sanitizeSentryEvent(event);
  },
});
