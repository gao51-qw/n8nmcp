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
    "xapp-1-A0123456789-1234567890123-abcdefghijklmnopqrstuvwxyz1234567890",
    "xapp-2-A9876543210-9876543210987-ZYXWVUTSRQPONMLKJIHGFEDCBA",
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

  it.each([
    "xapp-placeholder-value",
    "xapp-development-config",
    "xapp-1-A0123456789-example",
    "XAPP-1-A0123456789-1234567890123-abcdefghijklmnopqrstuvwxyz1234567890",
  ])("allows non-token xapp placeholder %s", (placeholder) => {
    expect(() => assertTemplateContainsNoSecrets({ appToken: placeholder })).not.toThrow();
  });

  it.each([
    "credentials",
    "Credential",
    "authentication",
    "Authorization",
    "apiKey",
    "accessToken",
    "refreshToken",
    "clientSecret",
    "Password",
    "privateKey",
  ])("rejects sensitive key %s even when its value is innocuous", (key) => {
    expect(() => assertTemplateContainsNoSecrets({ nested: { [key]: "development-placeholder" } }))
      .toThrow(/sensitive|secret/i);
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

  it("keeps only connections between retained nodes without shifting output indices", () => {
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
      A: { main: [[], [], [{ node: "B", type: "main", index: 0 }]] },
    });
  });

  it("preserves IF and Switch output positions while trimming only trailing empty outputs", () => {
    const result = normalizeAndSanitizeTemplate({
      id: 10,
      name: "Branches",
      workflow: {
        nodes: [
          { id: "if", name: "IF", type: "n8n-nodes-base.if", parameters: {}, position: [0, 0] },
          { id: "switch", name: "Switch", type: "n8n-nodes-base.switch", parameters: {}, position: [0, 200] },
          { id: "b", name: "B", type: "n8n-nodes-base.noOp", parameters: {}, position: [200, 0] },
          { id: "c", name: "C", type: "n8n-nodes-base.noOp", parameters: {}, position: [200, 200] },
        ],
        connections: {
          IF: {
            main: [
              [],
              [{ node: "B", type: "main", index: 0, metadata: { safe: true } }],
              [{ node: "Removed", type: "main", index: 0 }],
            ],
          },
          Switch: {
            main: [
              [{ node: "B", type: "main", index: 0 }],
              [],
              [{ node: "C", type: "main", index: 0 }],
            ],
          },
        },
      },
    });

    expect(result.workflow.workflow.connections).toEqual({
      IF: {
        main: [
          [],
          [{ node: "B", type: "main", index: 0, metadata: { safe: true } }],
        ],
      },
      Switch: {
        main: [
          [{ node: "B", type: "main", index: 0 }],
          [],
          [{ node: "C", type: "main", index: 0 }],
        ],
      },
    });
  });

  it("scans object property names for secrets and allows safe near-misses", () => {
    expect(() => assertTemplateContainsNoSecrets({
      headers: { "Bearer abcdefghijklmnopqrstuvwxyz123456": "redacted" },
    })).toThrow(/secret/i);
    expect(() => assertTemplateContainsNoSecrets({
      headers: {
        "Bearer short": "safe",
        "xapp-short": "safe",
        "not-a-jwt.header.payload": "safe",
      },
    })).not.toThrow();
  });

  it("rejects empty retained node types", () => {
    expect(() => normalizeAndSanitizeTemplate({
      id: 11,
      name: "Empty type",
      workflow: {
        nodes: [{ id: "n1", name: "Node", type: "   ", parameters: {}, position: [0, 0] }],
        connections: {},
      },
    })).toThrow(/nodes/i);
  });

  it.each([
    { node: "B", index: 0 },
    { node: "B", type: 1, index: 0 },
    { node: "B", type: "main" },
    { node: "B", type: "main", index: "0" },
    { node: "B", type: "main", index: -1 },
    { node: "B", type: "main", index: 0.5 },
    { node: "", type: "main", index: 0 },
  ])("rejects malformed connection descriptor %j", (descriptor) => {
    expect(() => normalizeAndSanitizeTemplate({
      id: 12,
      name: "Malformed connection",
      workflow: {
        nodes: [
          { id: "a", name: "A", type: "n8n-nodes-base.manualTrigger", parameters: {}, position: [0, 0] },
          { id: "b", name: "B", type: "n8n-nodes-base.noOp", parameters: {}, position: [200, 0] },
        ],
        connections: { A: { main: [[descriptor]] } },
      },
    })).toThrow(/connection/i);
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
