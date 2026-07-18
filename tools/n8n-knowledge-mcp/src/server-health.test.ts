import type { Server } from "node:http";
import { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createKnowledgeMcpApp } from "./server-app.js";

const authToken = "test-health-token";

let server: Server | undefined;

afterEach(() => {
  server?.close();
  server = undefined;
});

describe("knowledge MCP health endpoint", () => {
  it("keeps anonymous health checks free of knowledge-base inventory while preserving authenticated stats", async () => {
    const app = createKnowledgeMcpApp({
      authToken,
      statsCount: () => ({
        total: 2,
        ai_tools: 1,
        triggers: 1,
        webhooks: 1,
        templates: 12,
        external_candidates: 3,
        external_community_candidates: 2,
        external_tool_variant_candidates: 1,
        verified_external_nodes: 1,
        verified_external_community_nodes: 1,
        verified_external_tool_variant_nodes: 0,
      }),
      buildServer: () => {
        throw new Error("MCP server should not be constructed for /health");
      },
    });

    const baseUrl = await listen(app);
    const anonymousResponse = await fetch(`${baseUrl}/health`);
    const anonymousBody = await anonymousResponse.json();

    expect(anonymousResponse.status).toBe(200);
    expect(anonymousBody).toEqual({ ok: true });
    expect(anonymousBody).not.toHaveProperty("total");
    expect(anonymousBody).not.toHaveProperty("ai_tools");
    expect(anonymousBody).not.toHaveProperty("triggers");
    expect(anonymousBody).not.toHaveProperty("webhooks");
    expect(anonymousBody).not.toHaveProperty("templates");
    expect(anonymousBody).not.toHaveProperty("external_candidates");

    const authenticatedResponse = await fetch(`${baseUrl}/health`, {
      headers: { Authorization: `Bearer ${authToken}` },
    });
    const authenticatedBody = await authenticatedResponse.json();

    expect(authenticatedResponse.status).toBe(200);
    expect(authenticatedBody).toMatchObject({
      ok: true,
      total: 2,
      ai_tools: 1,
      triggers: 1,
      webhooks: 1,
      templates: 12,
      external_candidates: 3,
      version: "0.1.0",
    });
  });
});

function listen(app: ReturnType<typeof createKnowledgeMcpApp>): Promise<string> {
  return new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const address = server?.address() as AddressInfo;
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}
