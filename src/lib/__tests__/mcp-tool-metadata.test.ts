import { describe, expect, it } from "vitest";
import { TOOLS } from "../mcp-tool-definitions";

type ToolDescriptor = (typeof TOOLS)[number] & {
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    openWorldHint?: boolean;
    idempotentHint?: boolean;
  };
  inputSchema: {
    properties?: Record<string, unknown>;
  };
};

function tool(name: string): ToolDescriptor {
  const match = TOOLS.find((candidate) => candidate.name === name) as ToolDescriptor | undefined;
  if (!match) throw new Error(`Missing tool ${name}`);
  return match;
}

describe("MCP tool metadata", () => {
  it("advertises standard MCP annotations for every local tool", () => {
    for (const descriptor of TOOLS as readonly ToolDescriptor[]) {
      expect(descriptor.annotations, `${descriptor.name} missing annotations`).toMatchObject({
        readOnlyHint: expect.any(Boolean),
        destructiveHint: expect.any(Boolean),
        openWorldHint: expect.any(Boolean),
      });
    }
  });

  it("marks high-risk workflow mutations with approval-oriented hints", () => {
    expect(tool("delete_workflow").annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
    expect(tool("execute_workflow").annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: true,
    });
    expect(tool("apply_workflow_patch").annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
    expect(tool("safe_apply_workflow_patch").annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: true,
      openWorldHint: true,
    });
  });

  it("requires explicit confirm parameters for local execution and patching side effects", () => {
    for (const name of [
      "execute_workflow",
      "apply_workflow_patch",
      "safe_apply_workflow_patch",
      "rollback_workflow",
      "deploy_and_test_workflow",
    ]) {
      expect(tool(name).inputSchema.properties).toHaveProperty("confirm");
    }
  });

  it("advertises confirmationToken for token-gated destructive mutations", () => {
    for (const name of [
      "delete_workflow",
      "apply_workflow_patch",
      "safe_apply_workflow_patch",
      "rollback_workflow",
      "deploy_and_test_workflow",
    ]) {
      expect(tool(name).inputSchema.properties).toHaveProperty("confirmationToken");
    }
  });

  it("keeps partial-update confirmation fields off the read-only preview", () => {
    expect(tool("preview_workflow_diff").inputSchema.properties).not.toHaveProperty("confirm");
    expect(tool("preview_workflow_diff").inputSchema.properties).not.toHaveProperty(
      "confirmationToken",
    );
    expect(tool("update_partial_workflow").inputSchema.properties).toHaveProperty("confirm");
    expect(tool("update_partial_workflow").inputSchema.properties).toHaveProperty(
      "confirmationToken",
    );
  });
});
