import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getSession: vi.fn() }));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { auth: { getSession: mocks.getSession } },
}));

import { ApiError, apiErrorFromResponse, supportFetch } from "../http.client";

const fetchMock = vi.fn<typeof fetch>();

describe("supportFetch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    mocks.getSession.mockResolvedValue({
      data: { session: { access_token: "session-token" } },
      error: null,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends the bearer token and returns the JSON body", async () => {
    fetchMock.mockResolvedValue(Response.json({ keys: [] }));

    await expect(supportFetch("/api/dashboard/api-keys")).resolves.toEqual({ keys: [] });
    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("authorization")).toBe("Bearer session-token");
    expect(headers.get("content-type")).toBe("application/json");
  });

  it("throws ApiError without calling fetch when there is no session", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });

    const error = await supportFetch("/api/x").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 401, code: "authentication_required" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("parses the structured error shape", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "conflict", message: "Too many active keys", requestId: "req-1" } },
        { status: 409 },
      ),
    );

    const error = await supportFetch("/api/x").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      message: "Too many active keys",
      status: 409,
      code: "conflict",
      requestId: "req-1",
    });
  });
});

describe("apiErrorFromResponse", () => {
  it("parses the legacy { error: string } shape used by support routes", async () => {
    const error = await apiErrorFromResponse(
      Response.json({ error: "Authentication required", requestId: "req-2" }, { status: 401 }),
    );
    expect(error).toMatchObject({
      message: "Authentication required",
      status: 401,
      code: "request_failed",
      requestId: "req-2",
    });
  });

  it("keeps the parsed body for callers that need extra fields", async () => {
    const body = {
      error: { code: "confirmation_required", message: "Confirm" },
      confirmation: { token: "t" },
    };
    const error = await apiErrorFromResponse(Response.json(body, { status: 409 }));
    expect(error.body).toEqual(body);
  });

  it("uses short plain-text bodies and the x-request-id header", async () => {
    const error = await apiErrorFromResponse(
      new Response("Unauthorized", { status: 401, headers: { "x-request-id": "req-3" } }),
    );
    expect(error).toMatchObject({ message: "Unauthorized", status: 401, requestId: "req-3" });
  });

  it("falls back to a generic message for empty, HTML or unusable bodies", async () => {
    await expect(apiErrorFromResponse(new Response(null, { status: 502 }))).resolves.toMatchObject({
      message: "Request failed (502)",
      status: 502,
    });
    await expect(
      apiErrorFromResponse(new Response("<html>Bad gateway</html>", { status: 502 })),
    ).resolves.toMatchObject({ message: "Request failed (502)" });
    await expect(
      apiErrorFromResponse(Response.json({ error: { code: "x" } }, { status: 500 })),
    ).resolves.toMatchObject({ message: "Request failed (500)", code: "x" });
    await expect(
      apiErrorFromResponse(new Response("x".repeat(301), { status: 500 })),
    ).resolves.toMatchObject({ message: "Request failed (500)" });
  });
});
