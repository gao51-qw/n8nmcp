import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getAccessToken: vi.fn() }));

vi.mock("@/lib/auth/browser-session.client", () => ({ getAccessToken: mocks.getAccessToken }));
vi.mock("@/integrations/supabase/client", () => ({
  browserSupabaseConfig: () => ({ url: "https://abcdefgh.supabase.co", key: "pk" }),
}));

import {
  approveAuthorization,
  denyAuthorization,
  getAuthorizationDetails,
  revokeOAuthGrant,
} from "../oauth-server.client";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  mocks.getAccessToken.mockResolvedValue("at-1");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function call() {
  const [url, init] = fetchMock.mock.calls.at(-1)! as [string, RequestInit];
  return { url, init, headers: new Headers(init.headers) };
}

describe("OAuth server helpers", () => {
  it("loads authorization details with the in-memory token", async () => {
    fetchMock.mockResolvedValue(
      Response.json({
        authorization_id: "auth-1",
        redirect_uri: "https://client.example/cb",
        client: { id: "c1", name: "Claude", uri: "https://claude.ai" },
      }),
    );

    const { data, error } = await getAuthorizationDetails("auth-1");

    expect(error).toBeNull();
    expect(data).toMatchObject({ authorization_id: "auth-1", client: { name: "Claude" } });
    const { url, init, headers } = call();
    expect(url).toBe("https://abcdefgh.supabase.co/auth/v1/oauth/authorizations/auth-1");
    expect(init.method).toBe("GET");
    expect(init.credentials).toBe("omit");
    expect(headers.get("authorization")).toBe("Bearer at-1");
    expect(headers.get("apikey")).toBe("pk");
  });

  it("returns the redirect when consent was already given", async () => {
    fetchMock.mockResolvedValue(
      Response.json({ redirect_url: "https://client.example/cb?code=x" }),
    );
    const { data } = await getAuthorizationDetails("auth-1");
    expect(data).toEqual({ redirect_url: "https://client.example/cb?code=x" });
  });

  it("approves and denies through the consent endpoint", async () => {
    fetchMock.mockResolvedValue(Response.json({ redirect_url: "https://client.example/cb" }));
    await approveAuthorization("auth-1");
    expect(JSON.parse(String(call().init.body))).toEqual({ action: "approve" });
    await denyAuthorization("auth-1");
    expect(call().url).toBe(
      "https://abcdefgh.supabase.co/auth/v1/oauth/authorizations/auth-1/consent",
    );
    expect(JSON.parse(String(call().init.body))).toEqual({ action: "deny" });
  });

  it("revokes a grant", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    expect(await revokeOAuthGrant("client.1")).toEqual({ data: {}, error: null });
    expect(call().url).toBe(
      "https://abcdefgh.supabase.co/auth/v1/user/oauth/grants?client_id=client.1",
    );
    expect(call().init.method).toBe("DELETE");
  });

  it("fails closed without a session, on bad ids and on server errors", async () => {
    mocks.getAccessToken.mockResolvedValue(null);
    expect((await getAuthorizationDetails("auth-1")).error?.status).toBe(401);
    mocks.getAccessToken.mockResolvedValue("at-1");
    expect((await getAuthorizationDetails("../user")).error?.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock.mockResolvedValue(Response.json({ msg: "not found" }, { status: 404 }));
    expect((await approveAuthorization("auth-1")).error).toEqual({
      message: "not found",
      status: 404,
    });
  });
});
