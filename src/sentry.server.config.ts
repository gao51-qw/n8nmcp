import * as Sentry from "@sentry/nextjs";
import type { Event as SentryEvent } from "@sentry/core";
import { sanitizeSentryEvent } from "@/lib/logger.server";

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
