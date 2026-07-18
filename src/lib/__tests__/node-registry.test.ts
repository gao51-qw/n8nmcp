import { describe, expect, it } from "vitest";
import { NODE_REGISTRY, getNodeTemplate, isNodeKind, type NodeTemplate } from "../node-registry";
import { OFFICIAL_NODE_RULES, validateNodeRegistry } from "../node-registry-validation";

describe("node registry official compatibility", () => {
  it("keeps the local blueprint registry compatible with official n8n node type rules", () => {
    const result = validateNodeRegistry(NODE_REGISTRY);

    expect(result).toEqual({
      valid: true,
      errors: [],
      warnings: [],
    });
  });

  it("uses official n8n node types and default versions for high-value nodes", () => {
    expect(getNodeTemplate("http")).toMatchObject({
      n8nType: "n8n-nodes-base.httpRequest",
      defaultTypeVersion: 4.4,
    });
    expect(getNodeTemplate("slack")).toMatchObject({
      n8nType: "n8n-nodes-base.slack",
      defaultTypeVersion: 2.5,
    });
    expect(getNodeTemplate("googleSheets")).toMatchObject({
      n8nType: "n8n-nodes-base.googleSheets",
      defaultTypeVersion: 4.7,
    });
    expect(getNodeTemplate("mcpClient")).toMatchObject({
      n8nType: "@n8n/n8n-nodes-langchain.mcpClient",
      defaultTypeVersion: 1.1,
      requiredParams: ["endpointUrl", "tool"],
    });
  });

  it("throws for unsupported node kinds at runtime", () => {
    expect(() => getNodeTemplate("customHttp" as never)).toThrow(
      'Unsupported node kind "customHttp".',
    );
  });

  it("does not treat object prototype properties as node kinds", () => {
    expect(isNodeKind("toString")).toBe(false);
  });

  it("records official MCP nodes that require non-linear AI-tool connections", () => {
    expect(OFFICIAL_NODE_RULES.mcpClientTool).toMatchObject({
      n8nType: "@n8n/n8n-nodes-langchain.mcpClientTool",
      connectionProfile: "aiTool",
      blueprintSupport: "requires-special-connections",
    });
    expect(OFFICIAL_NODE_RULES.mcpTrigger).toMatchObject({
      n8nType: "@n8n/n8n-nodes-langchain.mcpTrigger",
      connectionProfile: "mcpServerTrigger",
      blueprintSupport: "requires-special-connections",
    });
  });

  it("rejects future nodes with malformed official storage fields", () => {
    const badTemplate: NodeTemplate = {
      ...getNodeTemplate("http"),
      kind: "http",
      n8nType: "httpRequest",
      defaultTypeVersion: 0,
      requiredParams: ["url", ""],
    };

    const result = validateNodeRegistry({ http: badTemplate });

    expect(result.valid).toBe(false);
    expect(result.errors.map((error) => error.code)).toEqual(
      expect.arrayContaining([
        "INVALID_N8N_TYPE",
        "INVALID_VERSION",
        "INVALID_REQUIRED_PARAM",
        "OFFICIAL_TYPE_MISMATCH",
      ]),
    );
  });

  it("rejects registry entries whose key is not a supported node kind", () => {
    const customTemplate: NodeTemplate = {
      ...getNodeTemplate("http"),
      kind: "http",
    };

    const result = validateNodeRegistry({ customHttp: customTemplate });

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "UNKNOWN_KIND",
          path: "customHttp",
        }),
      ]),
    );
  });

  it("rejects registry entries that are not template objects", () => {
    const result = validateNodeRegistry({
      http: null,
    } as unknown as Record<string, NodeTemplate>);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "INVALID_TEMPLATE",
          path: "http",
        }),
      ]),
    );
  });
});
