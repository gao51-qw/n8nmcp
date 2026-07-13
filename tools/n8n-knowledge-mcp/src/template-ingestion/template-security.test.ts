import { describe, expect, it } from "vitest";
import {
  assertTemplateContainsNoSecrets,
  normalizeAndSanitizeTemplate,
  PROHIBITED_TEMPLATE_NODE_TYPES,
} from "./template-security.js";

describe("template security", () => {
  it("removes credentials, authentication fields, prohibited nodes, and stale connections", () => {
    const result = normalizeAndSanitizeTemplate({
      id: 1750,
      name: "Webhook API",
      description: "Example",
      totalViews: 100,
      workflow: {
        nodes: [
          { id: "safe", name: "Webhook", type: "n8n-nodes-base.webhook", credentials: { httpBasicAuth: { id: "secret" } }, parameters: { authentication: "basicAuth", path: "demo" }, position: [0, 0] },
          { id: "danger", name: "Shell", type: "n8n-nodes-base.executeCommand", parameters: { command: "whoami" }, position: [200, 0] },
        ],
        connections: {
          Webhook: { main: [[{ node: "Shell", type: "main", index: 0 }]] },
          Shell: { main: [[]] },
        },
      },
    });

    const workflow = result.workflow.workflow;
    expect(workflow.nodes).toHaveLength(1);
    expect(workflow.nodes[0]).not.toHaveProperty("credentials");
    expect(workflow.nodes[0].parameters).not.toHaveProperty("authentication");
    expect(workflow.connections).toEqual({});
  });

  it.each([
    "sk-abcdefghijklmnopqrstuvwxyz123456",
    "Bearer abcdefghijklmnopqrstuvwxyz123456",
    "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
    "xox" + "b-123456789012-abcdefghijklmnopqrstuvwxyz",
    "AIzaSyDUMMYDUMMYDUMMYDUMMYDUMMYDUMMYDUM",
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnopqrstuvwxyz1234567890",
  ])("rejects embedded secret %s", (secret) => {
    expect(() => normalizeAndSanitizeTemplate({
      id: 1,
      name: "Unsafe",
      workflow: {
        nodes: [{ id: "n1", name: "HTTP", type: "n8n-nodes-base.httpRequest", parameters: { body: secret }, position: [0, 0] }],
        connections: {},
      },
    })).toThrow(/secret/i);
  });

  it("rejects empty and malformed workflows", () => {
    expect(() => normalizeAndSanitizeTemplate({ id: 1, name: "Empty", workflow: { nodes: [], connections: {} } })).toThrow(/nodes/i);
  });

  it("normalizes official metadata using summary fallbacks", () => {
    const result = normalizeAndSanitizeTemplate(
      {
        id: 42,
        name: "Safe template",
        workflow: {
          nodes: [{ id: "n1", name: "Start", type: "n8n-nodes-base.manualTrigger", parameters: {}, position: [0, 0] }],
          connections: {},
        },
      },
      {
        id: 42,
        name: "Summary name",
        description: "Summary description",
        totalViews: 321,
        price: 0,
        purchaseUrl: null,
        user: { name: "n8n", avatar: null },
        createdAt: "2024-01-01T00:00:00.000Z",
        nodes: [],
      },
    );

    expect(result).toMatchObject({
      source: "official",
      curated: false,
      views: 321,
      sourceUrl: "https://n8n.io/workflows/42",
      workflow: {
        id: 42,
        name: "Safe template",
        description: "Summary description",
        totalViews: 321,
        createdAt: "2024-01-01T00:00:00.000Z",
        user: { name: "n8n", avatar: null },
      },
    });
  });

  it("recursively removes secret-bearing keys without mutating the input", () => {
    const detail = {
      id: 7,
      name: "Nested",
      workflow: {
        nodes: [{
          id: "n1",
          name: "HTTP",
          type: "n8n-nodes-base.httpRequest",
          parameters: {
            headers: [{ Authorization: "Bearer abcdefghijklmnopqrstuvwxyz123456" }],
            nested: { CLIENTSECRET: "hidden", safe: "visible" },
          },
          position: [0, 0],
        }],
        connections: {},
      },
    };

    const result = normalizeAndSanitizeTemplate(detail);

    expect(result.workflow.workflow.nodes[0]).toMatchObject({
      parameters: { headers: [{}], nested: { safe: "visible" } },
    });
    expect(detail.workflow.nodes[0].parameters.headers[0]).toHaveProperty("Authorization");
  });

  it("keeps only connections between retained nodes and compacts empty branches", () => {
    const result = normalizeAndSanitizeTemplate({
      id: 8,
      name: "Connected",
      workflow: {
        nodes: [
          { id: "a", name: "A", type: "n8n-nodes-base.manualTrigger", parameters: {}, position: [0, 0] },
          { id: "b", name: "B", type: "n8n-nodes-base.noOp", parameters: {}, position: [200, 0] },
        ],
        connections: {
          A: { main: [[], [{ node: "Removed", type: "main", index: 0 }], [{ node: "B", type: "main", index: 0 }]] },
          Removed: { main: [[{ node: "B", type: "main", index: 0 }]] },
        },
      },
    });

    expect(result.workflow.workflow.connections).toEqual({
      A: { main: [[{ node: "B", type: "main", index: 0 }]] },
    });
  });

  it("exports exactly the prohibited node type set and rejects direct secret scans", () => {
    expect([...PROHIBITED_TEMPLATE_NODE_TYPES]).toEqual([
      "n8n-nodes-base.executeCommand",
      "n8n-nodes-base.executeWorkflow",
      "n8n-nodes-base.function",
      "n8n-nodes-base.functionItem",
    ]);
    expect(() => assertTemplateContainsNoSecrets({ nested: ["safe", "Bearer abcdefghijklmnopqrstuvwxyz123456"] })).toThrow(/secret/i);
    expect(() => assertTemplateContainsNoSecrets({ nested: ["safe"] })).not.toThrow();
  });

  it("fails when prohibited-node removal leaves no nodes", () => {
    expect(() => normalizeAndSanitizeTemplate({
      id: 9,
      name: "Only prohibited",
      workflow: {
        nodes: [{ id: "n1", name: "Function", type: "n8n-nodes-base.function", parameters: {}, position: [0, 0] }],
        connections: {},
      },
    })).toThrow(/nodes/i);
  });
});
