import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { refreshRequest, retryAfterMs } from "../auth-api.client";

const fetchMock = vi.fn<typeof fetch>();

function session(token: string) {
  return {
    access_token: token,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    user: { id: "user-1" },
  };
}

describe("refreshRequest", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("posts same-origin JSON and returns the session", async () => {
    fetchMock.mockResolvedValue(Response.json(session("fresh")));

    await expect(refreshRequest()).resolves.toMatchObject({
      kind: "session",
      session: { access_token: "fresh" },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/auth/refresh",
      expect.objectContaining({ method: "POST", credentials: "same-origin" }),
    );
  });

  it.each([204, 401])("treats %i as a definite sign-out", async (status) => {
    fetchMock.mockResolvedValue(new Response(null, { status }));
    await expect(refreshRequest()).resolves.toEqual({ kind: "signed_out" });
  });

  it("keeps the session on 5xx and passes the server's retry hint on", async () => {
    fetchMock.mockResolvedValue(
      Response.json(
        { error: { code: "upstream_error" } },
        { status: 502, headers: { "Retry-After": "2" } },
      ),
    );
    await expect(refreshRequest()).resolves.toEqual({ kind: "error", retryAfterMs: 2_000 });

    fetchMock.mockResolvedValue(Response.json({ error: { code: "x" } }, { status: 503 }));
    await expect(refreshRequest()).resolves.toEqual({ kind: "error", retryAfterMs: undefined });
  });

  it("treats a network failure as transient", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(refreshRequest()).resolves.toEqual({ kind: "error" });
  });
});

describe("retryAfterMs", () => {
  it.each([
    ["2", 2_000],
    ["0", 1_000],
    ["600", 60_000],
    ["Wed, 21 Oct 2026 07:28:00 GMT", undefined],
    [null, undefined],
  ])("maps Retry-After %j to %j", (header, expected) => {
    const response = new Response(null, {
      status: 503,
      headers: header === null ? {} : { "Retry-After": header },
    });
    expect(retryAfterMs(response)).toBe(expected);
  });
});
