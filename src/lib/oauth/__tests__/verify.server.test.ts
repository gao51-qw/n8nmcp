import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  SignJWT,
  type CryptoKey,
  type JWK,
  type JWTPayload,
} from "jose";

const grantQuery = vi.hoisted(() => ({
  maybeSingle: vi.fn(),
  update: vi.fn(),
  touched: vi.fn(),
}));

vi.mock("@/integrations/supabase/client.server", () => {
  const selectChain = {
    eq: vi.fn(() => selectChain),
    maybeSingle: grantQuery.maybeSingle,
  };
  return {
    supabaseAdmin: {
      from: vi.fn(() => ({
        select: vi.fn(() => selectChain),
        update: (values: unknown) => {
          grantQuery.update(values);
          return {
            eq: () => ({
              then: (resolve?: (value: unknown) => unknown) => {
                grantQuery.touched();
                return Promise.resolve({ error: null }).then(resolve);
              },
            }),
          };
        },
      })),
    },
  };
});

vi.mock("@/lib/logger.server", () => ({ log: { warn: vi.fn(), info: vi.fn() } }));

import { setJwksForTests, verifyOAuthAccessToken } from "../verify.server";

const ISSUER = "https://proj.supabase.co/auth/v1";
let privateKey: CryptoKey;
let otherPrivateKey: CryptoKey;

async function token(
  claims: JWTPayload = {},
  options: { key?: CryptoKey; issuer?: string; expiresIn?: string; alg?: string } = {},
) {
  return new SignJWT({ client_id: "client-1", session_id: "s-1", role: "authenticated", ...claims })
    .setProtectedHeader({ alg: options.alg ?? "ES256", kid: "key-1" })
    .setSubject(typeof claims.sub === "string" ? claims.sub : "user-1")
    .setIssuer(options.issuer ?? ISSUER)
    .setAudience("authenticated")
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? "1h")
    .sign(options.key ?? privateKey);
}

beforeAll(async () => {
  const pair = await generateKeyPair("ES256");
  privateKey = pair.privateKey;
  otherPrivateKey = (await generateKeyPair("ES256")).privateKey;
  const jwk: JWK = { ...(await exportJWK(pair.publicKey)), kid: "key-1", alg: "ES256" };
  setJwksForTests(createLocalJWKSet({ keys: [jwk] }));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MCP_OAUTH_ENABLED", "1");
  vi.stubEnv("SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("MCP_OAUTH_ISSUER", "");
  vi.stubEnv("MCP_OAUTH_AUDIENCE", "");
  grantQuery.maybeSingle.mockResolvedValue({
    data: {
      id: "grant-1",
      client_name: "Claude",
      scopes: ["mcp:tools:read", "mcp:admin"],
      revoked_at: null,
    },
    error: null,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("verifyOAuthAccessToken", () => {
  it("accepts a signed token backed by an active grant", async () => {
    await expect(verifyOAuthAccessToken(await token())).resolves.toEqual({
      userId: "user-1",
      clientId: "client-1",
      clientName: "Claude",
      sessionId: "s-1",
      scopes: ["mcp:tools:read"],
    });
    expect(grantQuery.update).toHaveBeenCalledWith({ last_used_at: expect.any(String) });
    expect(grantQuery.touched).toHaveBeenCalled();
  });

  it("is off unless MCP_OAUTH_ENABLED=1", async () => {
    vi.stubEnv("MCP_OAUTH_ENABLED", "0");
    await expect(verifyOAuthAccessToken(await token())).resolves.toBeNull();
    expect(grantQuery.maybeSingle).not.toHaveBeenCalled();
  });

  it("rejects tokens that are not JWTs", async () => {
    await expect(verifyOAuthAccessToken("nmcp_abc")).resolves.toBeNull();
  });

  it("rejects a token from another issuer", async () => {
    await expect(
      verifyOAuthAccessToken(await token({}, { issuer: "https://evil.example/auth/v1" })),
    ).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const expired = await new SignJWT({ client_id: "client-1" })
      .setProtectedHeader({ alg: "ES256", kid: "key-1" })
      .setSubject("user-1")
      .setIssuer(ISSUER)
      .setIssuedAt(Math.floor(Date.now() / 1000) - 7200)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey);
    await expect(verifyOAuthAccessToken(expired)).resolves.toBeNull();
  });

  it("rejects a token signed by a key outside the JWKS", async () => {
    await expect(
      verifyOAuthAccessToken(await token({}, { key: otherPrivateKey })),
    ).resolves.toBeNull();
  });

  it("rejects an HS256 token even if it names a known kid", async () => {
    const hs = await new SignJWT({ client_id: "client-1" })
      .setProtectedHeader({ alg: "HS256", kid: "key-1" })
      .setSubject("user-1")
      .setIssuer(ISSUER)
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode("x".repeat(32)));
    await expect(verifyOAuthAccessToken(hs)).resolves.toBeNull();
  });

  it("does not treat a dashboard session token (no client_id) as an MCP credential", async () => {
    await expect(verifyOAuthAccessToken(await token({ client_id: undefined }))).resolves.toBeNull();
    expect(grantQuery.maybeSingle).not.toHaveBeenCalled();
  });

  it("rejects a token whose grant is missing or revoked", async () => {
    grantQuery.maybeSingle.mockResolvedValueOnce({ data: null, error: null });
    await expect(verifyOAuthAccessToken(await token())).resolves.toBeNull();

    grantQuery.maybeSingle.mockResolvedValueOnce({
      data: { id: "g", client_name: "", scopes: [], revoked_at: "2026-11-04T00:00:00Z" },
      error: null,
    });
    await expect(verifyOAuthAccessToken(await token())).resolves.toBeNull();
  });

  it("fails closed when the grant lookup errors", async () => {
    grantQuery.maybeSingle.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    await expect(verifyOAuthAccessToken(await token())).resolves.toBeNull();
  });

  it("enforces MCP_OAUTH_AUDIENCE when set", async () => {
    vi.stubEnv("MCP_OAUTH_AUDIENCE", "https://mcp.example.com/mcp");
    await expect(verifyOAuthAccessToken(await token())).resolves.toBeNull();
  });
});
