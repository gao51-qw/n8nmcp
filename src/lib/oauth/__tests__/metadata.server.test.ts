import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("SUPABASE_URL", "https://proj.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_MCP_ENDPOINT_URL", "https://mcp.example.com/mcp");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

async function route() {
  return import("@/app/.well-known/oauth-protected-resource/[[...resource]]/route");
}

describe("protected resource metadata", () => {
  it("is not served while OAuth is disabled", async () => {
    vi.stubEnv("MCP_OAUTH_ENABLED", "0");
    const response = await (await route()).GET();
    expect(response.status).toBe(404);
  });

  it("names the MCP endpoint, the Supabase issuer and the MCP scopes", async () => {
    vi.stubEnv("MCP_OAUTH_ENABLED", "1");
    const response = await (await route()).GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    await expect(response.json()).resolves.toEqual({
      resource: "https://mcp.example.com/mcp",
      authorization_servers: ["https://proj.supabase.co/auth/v1"],
      scopes_supported: ["mcp:tools:read", "mcp:tools:execute", "mcp:workflows:write"],
      bearer_methods_supported: ["header"],
      resource_name: "n8n-mcp",
    });
  });

  it("builds the path-suffixed RFC 9728 URL for the endpoint", async () => {
    const { protectedResourceMetadataUrl } = await import("../config.server");
    expect(protectedResourceMetadataUrl()).toBe(
      "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
    );
  });

  it("prefers an explicit issuer", async () => {
    vi.stubEnv("MCP_OAUTH_ISSUER", "https://auth.example.com/auth/v1/");
    const { oauthIssuer } = await import("../config.server");
    expect(oauthIssuer()).toBe("https://auth.example.com/auth/v1");
  });
});
