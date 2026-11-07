import * as Sentry from "@sentry/nextjs";
import type { Event as SentryEvent } from "@sentry/core";
import { sanitizeSentryEvent } from "@/lib/sentry-sanitize";

// One redaction for the browser, edge and server inits (src/lib/sentry-sanitize.ts).
export { sanitizeSentryEvent };

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  sendDefaultPii: false,
  enableLogs: true,
  // Inlined at build time: next.config.ts fills it from SENTRY_TRACES_SAMPLE_RATE
  // when no NEXT_PUBLIC_ value is given, so the browser follows the server rate.
  tracesSampleRate: Number(process.env.NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE ?? "0.05"),
  beforeSend(event: SentryEvent) {
    return sanitizeSentryEvent(event);
  },
});

export const onRouterTransitionStart = (
  Sentry as typeof Sentry & {
    captureRouterTransitionStart: (href: string, navigationType: string) => void;
  }
).captureRouterTransitionStart;
