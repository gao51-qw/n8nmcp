// W3C trace context (traceparent / tracestate) for one MCP request.
//
// Clients send it as HTTP headers or, under MCP 2026-07-28, in the request's
// `_meta`. It is kept for the duration of the request and forwarded on
// outbound calls to n8n, so a trace started in the AI client continues into
// the user's n8n instance. Logs and Sentry events carry the trace id.
import { AsyncLocalStorage } from "node:async_hooks";

export type TraceContext = { traceparent: string; tracestate?: string };

const TRACEPARENT = /^[0-9a-f]{2}-([0-9a-f]{32})-[0-9a-f]{16}-[0-9a-f]{2}$/;
const ZERO_TRACE = /^0+$/;
const MAX_TRACESTATE = 512;

const storage = new AsyncLocalStorage<TraceContext | null>();

function valid(traceparent: unknown): traceparent is string {
  if (typeof traceparent !== "string") return false;
  const match = TRACEPARENT.exec(traceparent.trim().toLowerCase());
  return !!match && !ZERO_TRACE.test(match[1]!) && !traceparent.startsWith("ff");
}

/** Reads trace context from `_meta` (preferred) or the request headers. */
export function traceContextFrom(
  headers: Headers,
  meta?: Record<string, unknown> | null,
): TraceContext | null {
  const source =
    meta && valid(meta.traceparent)
      ? { traceparent: meta.traceparent, tracestate: meta.tracestate }
      : { traceparent: headers.get("traceparent"), tracestate: headers.get("tracestate") };
  if (!valid(source.traceparent)) return null;
  const tracestate =
    typeof source.tracestate === "string" && source.tracestate.length <= MAX_TRACESTATE
      ? source.tracestate.replace(/[\r\n]/g, "")
      : undefined;
  return {
    traceparent: source.traceparent.trim().toLowerCase(),
    ...(tracestate ? { tracestate } : {}),
  };
}

export function runWithTrace<T>(context: TraceContext | null, run: () => T): T {
  return storage.run(context, run);
}

export function currentTrace(): TraceContext | null {
  return storage.getStore() ?? null;
}

/** The 32-hex trace id of the current request, if any. */
export function currentTraceId(): string | undefined {
  return currentTrace()?.traceparent.split("-")[1];
}

/** Headers to add to outbound requests made on behalf of this request. */
export function traceHeaders(): Record<string, string> {
  const trace = currentTrace();
  if (!trace) return {};
  return {
    traceparent: trace.traceparent,
    ...(trace.tracestate ? { tracestate: trace.tracestate } : {}),
  };
}
