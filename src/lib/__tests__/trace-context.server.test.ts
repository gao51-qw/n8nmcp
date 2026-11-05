import { describe, expect, it } from "vitest";
import {
  currentTraceId,
  runWithTrace,
  traceContextFrom,
  traceHeaders,
} from "../trace-context.server";

const TRACEPARENT = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01";

describe("traceContextFrom", () => {
  it("prefers _meta over headers", () => {
    const headers = new Headers({
      traceparent: "00-11111111111111111111111111111111-2222222222222222-01",
    });
    expect(traceContextFrom(headers, { traceparent: TRACEPARENT, tracestate: "vendor=1" })).toEqual(
      {
        traceparent: TRACEPARENT,
        tracestate: "vendor=1",
      },
    );
  });

  it("falls back to headers and drops invalid values", () => {
    expect(traceContextFrom(new Headers({ traceparent: TRACEPARENT }))).toEqual({
      traceparent: TRACEPARENT,
    });
    for (const bad of [
      "garbage",
      "00-00000000000000000000000000000000-00f067aa0ba902b7-01",
      "ff-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01",
    ]) {
      expect(traceContextFrom(new Headers({ traceparent: bad }))).toBeNull();
    }
  });

  it("strips line breaks from tracestate", () => {
    expect(
      traceContextFrom(new Headers({ traceparent: TRACEPARENT }), {
        traceparent: TRACEPARENT,
        tracestate: "a=1\r\nx: y",
      }),
    ).toEqual({ traceparent: TRACEPARENT, tracestate: "a=1x: y" });
  });
});

describe("runWithTrace", () => {
  it("exposes the trace for outbound headers inside the request only", async () => {
    expect(traceHeaders()).toEqual({});
    await runWithTrace({ traceparent: TRACEPARENT }, async () => {
      await Promise.resolve();
      expect(currentTraceId()).toBe("4bf92f3577b34da6a3ce929d0e0e4736");
      expect(traceHeaders()).toEqual({ traceparent: TRACEPARENT });
    });
    expect(currentTraceId()).toBeUndefined();
  });
});
