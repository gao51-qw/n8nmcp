import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(() => "sentry-event-1"),
  logError: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({ captureException: mocks.captureException }));

vi.mock("@/lib/logger.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/logger.server")>();
  return {
    ...actual,
    getRequestId: () => "request-1",
    log: { ...actual.log, error: mocks.logError },
  };
});

import {
  apiErrorResponse,
  apiJson,
  errorCodeForStatus,
  HttpError,
  jsonError,
  parseUuidParam,
  readJsonBody,
  readJsonObject,
  withApiErrors,
} from "../api-response.server";

class DomainError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

class OtherStatusError extends Error {
  readonly status = 400;
}

const request = () => new Request("https://dashboard.example.test/api/dashboard/x");

async function expectError(response: Response, status: number, code: string, message: string) {
  expect(response.status).toBe(status);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(response.headers.get("content-type")).toContain("application/json");
  expect(response.headers.get("x-request-id")).toBe("request-1");
  await expect(response.json()).resolves.toEqual({
    error: { code, message, requestId: "request-1" },
  });
}

describe("api-response helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds no-store JSON success and error responses", async () => {
    const ok = apiJson({ ok: true }, { status: 201, requestId: "request-1" });
    expect(ok.status).toBe(201);
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect(ok.headers.get("x-robots-tag")).toBe("noindex,nofollow");
    expect(ok.headers.get("x-request-id")).toBe("request-1");
    await expect(ok.json()).resolves.toEqual({ ok: true });

    const error = jsonError(409, "confirmation_required", "Confirm", {
      requestId: "request-1",
      extra: { confirmation: { token: "t" } },
    });
    expect(error.status).toBe(409);
    expect(error.headers.get("cache-control")).toBe("no-store");
    await expect(error.json()).resolves.toEqual({
      confirmation: { token: "t" },
      error: { code: "confirmation_required", message: "Confirm", requestId: "request-1" },
    });

    const withoutId = jsonError(400, "invalid_request", "Bad");
    await expect(withoutId.json()).resolves.toEqual({
      error: { code: "invalid_request", message: "Bad" },
    });
  });

  it("maps a thrown auth Response to a fixed JSON message", async () => {
    await expectError(
      apiErrorResponse(new Response("Unauthorized", { status: 401 }), "request-1"),
      401,
      "authentication_required",
      "Authentication required",
    );
    await expectError(
      apiErrorResponse(new Response("secret detail", { status: 403 }), "request-1"),
      403,
      "forbidden",
      "Forbidden",
    );
  });

  it("passes through HttpError and listed domain errors only", async () => {
    await expectError(
      apiErrorResponse(new HttpError(404, "not_found", "API key not found"), "request-1"),
      404,
      "not_found",
      "API key not found",
    );
    await expectError(
      apiErrorResponse(new DomainError("Too many keys", 409), "request-1", {
        expose: [DomainError],
      }),
      409,
      "conflict",
      "Too many keys",
    );
    await expectError(
      apiErrorResponse(new DomainError("n8n unreachable", 502), "request-1", {
        expose: [DomainError],
      }),
      502,
      "upstream_error",
      "n8n unreachable",
    );
    // A status-carrying error that the route did not list is not trusted.
    await expectError(
      apiErrorResponse(new OtherStatusError("db detail"), "request-1", { expose: [DomainError] }),
      500,
      "internal_error",
      "Request failed",
    );
  });

  it("maps ZodError to a fixed invalid_request message", async () => {
    const zodError = z.object({ a: z.string() }).safeParse({}).error;
    await expectError(
      apiErrorResponse(zodError, "request-1", { invalidRequestMessage: "Invalid action request" }),
      400,
      "invalid_request",
      "Invalid action request",
    );
  });

  it("hides unexpected errors and reports them", async () => {
    await expectError(
      apiErrorResponse(new Error("connection string leaked"), "request-1", {
        internalMessage: "Workflow action failed",
        logEvent: "test.failed",
      }),
      500,
      "internal_error",
      "Workflow action failed",
    );
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
    expect(mocks.logError).toHaveBeenCalledWith(
      "test.failed",
      expect.objectContaining({ requestId: "request-1", errorType: "Error" }),
    );
    // A thrown 5xx Response is treated as unexpected too.
    await expectError(
      apiErrorResponse(new Response("boom", { status: 503 }), "request-1"),
      500,
      "internal_error",
      "Request failed",
    );
  });

  it("withApiErrors adds the request id and maps thrown errors", async () => {
    const ok = await withApiErrors(request(), async ({ requestId }) =>
      Response.json({ requestId }),
    );
    expect(ok.headers.get("x-request-id")).toBe("request-1");
    await expect(ok.json()).resolves.toEqual({ requestId: "request-1" });

    await expectError(
      await withApiErrors(request(), async () => {
        throw new Response("Unauthorized", { status: 401 });
      }),
      401,
      "authentication_required",
      "Authentication required",
    );
  });

  it("parses UUID params and rejects anything else as not found", () => {
    const id = "67f354e9-309d-4e1f-b81b-6d3d419aeb52";
    expect(parseUuidParam(id)).toBe(id);
    expect(() => parseUuidParam("1 OR 1=1", "Instance not found")).toThrow(
      expect.objectContaining({ status: 404, code: "not_found", message: "Instance not found" }),
    );
    expect(() => parseUuidParam(undefined)).toThrow(HttpError);
  });

  it("reads JSON bodies", async () => {
    const post = (body: string) =>
      new Request("https://dashboard.example.test/x", { method: "POST", body });
    await expect(readJsonObject(post('{"a":1}'))).resolves.toEqual({ a: 1 });
    await expect(readJsonObject(post("[1]"))).resolves.toBeNull();
    await expect(readJsonObject(post("not json"))).resolves.toBeNull();
    await expect(readJsonBody(post("[1]"))).resolves.toEqual([1]);
    await expect(readJsonBody(post("not json"))).rejects.toMatchObject({
      status: 400,
      code: "invalid_json",
    });
  });

  it("derives stable codes from statuses", () => {
    expect(errorCodeForStatus(401)).toBe("authentication_required");
    expect(errorCodeForStatus(418)).toBe("request_failed");
    expect(errorCodeForStatus(500)).toBe("internal_error");
  });
});
