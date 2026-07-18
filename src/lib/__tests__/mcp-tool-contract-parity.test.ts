import { describe, expect, it } from "vitest";
import { LOCAL_TOOLS, TOOLS } from "../mcp-tool-definitions";
import { orchestratedTools } from "../orchestrated-tools";

type JsonSchema = {
  required?: readonly string[];
  properties?: Record<string, unknown>;
};

type ToolDescriptor = {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
};

function tool(name: string): ToolDescriptor {
  const match = TOOLS.find((candidate) => candidate.name === name);
  if (!match) throw new Error(`Missing tool ${name}`);
  return match as ToolDescriptor;
}

function property(toolName: string, propertyName: string): Record<string, unknown> {
  const value = tool(toolName).inputSchema.properties?.[propertyName];
  if (!value || typeof value !== "object") {
    throw new Error(`Missing ${toolName}.${propertyName}`);
  }
  return value as Record<string, unknown>;
}

describe("canonical MCP tool contracts", () => {
  it("advertises preview and partial-update fields where the runtime accepts them", () => {
    expect(tool("preview_workflow_diff").inputSchema.required).toEqual([
      "workflowId",
      "operations",
    ]);
    expect(tool("preview_workflow_diff").inputSchema.properties).not.toHaveProperty(
      "sourcePreviewCallId",
    );
    expect(tool("preview_workflow_diff").inputSchema.properties).not.toHaveProperty(
      "sourcePreviewOperationIndexes",
    );
    expect(tool("preview_workflow_diff").inputSchema.properties).not.toHaveProperty("confirm");
    expect(tool("preview_workflow_diff").inputSchema.properties).not.toHaveProperty(
      "confirmationToken",
    );

    expect(tool("update_partial_workflow").inputSchema.required).toEqual([
      "workflowId",
      "operations",
      "sourcePreviewCallId",
    ]);
    expect(tool("update_partial_workflow").inputSchema.properties).toHaveProperty(
      "sourcePreviewOperationIndexes",
    );
    expect(tool("update_partial_workflow").inputSchema.properties).toHaveProperty("confirm");
    expect(tool("update_partial_workflow").inputSchema.properties).toHaveProperty(
      "confirmationToken",
    );
  });

  it("requires smoke-test data and advertises only implemented creation enum values", () => {
    expect(tool("deploy_and_test_workflow").inputSchema.required).toEqual([
      "workflowId",
      "testData",
    ]);
    expect(property("create_scheduled_workflow", "action").enum).toEqual([
      "send_email",
      "http_request",
      "slack_message",
    ]);
    expect(
      (
        (property("create_webhook_workflow", "processing").items as Record<string, unknown>)
          .properties as Record<string, Record<string, unknown>>
      ).action.enum,
    ).toEqual(["transform", "validate"]);
    expect(property("create_ai_chatbot_workflow", "interface").enum).toEqual(["webhook", "slack"]);
    expect(property("create_ai_chatbot_workflow", "aiProvider").enum).toEqual(["openai"]);
    expect(property("create_email_workflow", "trigger").enum).toEqual([
      "webhook",
      "schedule",
      "manual",
    ]);
  });

  it("advertises the canonical executable chatbot configuration", () => {
    const chatbot = tool("create_ai_chatbot_workflow");
    expect(chatbot.inputSchema.required).toEqual(["name", "interface", "aiConfig"]);
    expect(chatbot.inputSchema.properties).not.toHaveProperty("platform");
    expect(chatbot.inputSchema.properties).not.toHaveProperty("systemPrompt");
    expect(chatbot.inputSchema.properties).not.toHaveProperty("escalationRules");
    expect(chatbot.inputSchema.properties).not.toHaveProperty("humanNotification");

    const aiConfig = property("create_ai_chatbot_workflow", "aiConfig");
    expect(aiConfig.required).toEqual(["model"]);
    expect(aiConfig.properties).toMatchObject({
      model: { type: "string" },
      credentialId: { type: "string" },
      credentialName: { type: "string" },
      systemPrompt: { type: "string" },
    });
    expect(property("create_ai_chatbot_workflow", "interfaceConfig").properties).toMatchObject({
      humanEmail: { type: "string" },
      humanEmailCredentials: {
        type: "object",
        required: ["smtp"],
        additionalProperties: false,
        properties: {
          smtp: {
            type: "object",
            required: ["id", "name"],
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1 },
              name: { type: "string", minLength: 1 },
            },
          },
        },
      },
    });
    expect(property("create_ai_chatbot_workflow", "features").properties).toEqual({
      humanHandoff: { type: "boolean" },
      sentimentAnalysis: { type: "boolean" },
    });
    expect(chatbot.inputSchema).toMatchObject({
      allOf: [
        {
          then: {
            properties: {
              aiConfig: {
                required: ["model", "credentialId", "credentialName"],
              },
            },
          },
        },
        {
          then: {
            required: ["interfaceConfig"],
            properties: {
              interfaceConfig: {
                required: ["humanEmail", "humanEmailCredentials"],
              },
            },
          },
        },
      ],
    });
  });

  it("requires the fields consumed by every deployment validation rule", () => {
    const rules = property("deploy_and_test_workflow", "validationRules");
    expect((rules.items as Record<string, unknown>).required).toEqual(["field", "condition"]);
  });

  it("describes create-time activate flags as deployment intent", () => {
    for (const name of [
      "create_scheduled_workflow",
      "create_webhook_workflow",
      "create_ai_chatbot_workflow",
      "create_email_workflow",
      "create_workflow_from_blueprint",
    ]) {
      expect(String(property(name, "activate").description)).toMatch(/deployment intent/i);
    }
  });

  it("has one canonical public descriptor for each tool name", () => {
    const sourceNames = [
      ...LOCAL_TOOLS.map((candidate) => candidate.name),
      ...orchestratedTools.map((candidate) => candidate.name),
    ];
    expect(new Set(sourceNames).size).toBe(sourceNames.length);
    expect(TOOLS.filter((candidate) => candidate.name === "fix_workflow_errors")).toHaveLength(1);
    expect(Object.keys(tool("fix_workflow_errors").inputSchema.properties ?? {})).toEqual([
      "workflowId",
    ]);
  });
});
