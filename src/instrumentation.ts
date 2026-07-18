import * as Sentry from "@sentry/nextjs";

type CaptureRequestError = (
  error: unknown,
  request: Request,
  context: Record<string, unknown>,
) => void;

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = (
  Sentry as typeof Sentry & {
    captureRequestError: CaptureRequestError;
  }
).captureRequestError;
