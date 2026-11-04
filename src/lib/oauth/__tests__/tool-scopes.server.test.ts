import { describe, expect, it } from "vitest";
import { TOOLS } from "@/lib/mcp-tool-definitions";
import { MCP_SCOPES, missingScopes } from "../scopes";
import { requiredScopesForTool } from "../tool-scopes.server";

describe("requiredScopesForTool", () => {
  it("lets read-only tools run with the read scope", () => {
    for (const name of ["list_workflows", "get_workflow", "search_nodes", "validate_workflow"]) {
      expect(requiredScopesForTool(name)).toEqual(["mcp:tools:read"]);
    }
  });

  it("requires write for tools that change workflows", () => {
    for (const name of [
      "create_workflow",
      "update_workflow",
      "delete_workflow",
      "rollback_workflow",
    ]) {
      expect(requiredScopesForTool(name)).toEqual(["mcp:workflows:write"]);
    }
  });

  it("requires execute to run workflows, and write too when deploying", () => {
    expect(requiredScopesForTool("execute_workflow")).toEqual(["mcp:tools:execute"]);
    expect(requiredScopesForTool("deploy_and_test_workflow")).toEqual([
      "mcp:tools:execute",
      "mcp:workflows:write",
    ]);
  });

  it("classifies upstream tools as read unless they are management tools", () => {
    expect(requiredScopesForTool("get_node_essentials")).toEqual(["mcp:tools:read"]);
    expect(requiredScopesForTool("n8n_update_full_workflow", true)).toEqual([
      "mcp:workflows:write",
    ]);
  });

  it("never lets a non-read-only local tool through on the read scope alone", () => {
    for (const tool of TOOLS) {
      const readOnly =
        (tool as { annotations?: { readOnlyHint?: boolean } }).annotations?.readOnlyHint === true;
      const required = requiredScopesForTool(tool.name);
      expect(required.every((scope) => (MCP_SCOPES as readonly string[]).includes(scope))).toBe(
        true,
      );
      if (!readOnly) {
        expect(missingScopes(["mcp:tools:read"], required).length, tool.name).toBeGreaterThan(0);
      }
    }
  });
});
