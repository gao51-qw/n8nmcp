import { describe, it, expect } from "vitest";
import { LOCAL_TOOLS, TOOLS } from "../mcp-tool-definitions";
import { readFileSync } from "node:fs";

// The five orchestrated tools have working implementations in
// OrchestratedToolsService but are NOT in LOCAL_TOOLS. They reach the gateway
// only through TOOLS (= LOCAL_TOOLS + orchestrated schemas). mcp.server builds
// both its tools/list seed (getMergedTools) and its dispatch allow-list
// (LOCAL_NAMES) from TOOLS, so if TOOLS ever reverts to LOCAL_TOOLS these tools
// would silently drop off the wire: not advertised, and not callable.
const ORCHESTRATED_ONLY = [
  "create_scheduled_workflow",
  "create_webhook_workflow",
  "create_ai_chatbot_workflow",
  "create_email_workflow",
  "deploy_and_test_workflow",
] as const;

describe("orchestrated tool wiring", () => {
  const toolNames = new Set<string>(TOOLS.map((t) => t.name));
  const localNames = new Set<string>(LOCAL_TOOLS.map((t) => t.name));

  it("advertises every orchestrated-only tool through TOOLS", () => {
    for (const name of ORCHESTRATED_ONLY) {
      expect(toolNames.has(name), `${name} missing from TOOLS`).toBe(true);
      // These are deliberately not basic CRUD tools.
      expect(localNames.has(name), `${name} unexpectedly in LOCAL_TOOLS`).toBe(false);
    }
  });

  it("keeps one canonical orchestrated fix_workflow_errors entry", () => {
    const matches = TOOLS.filter((t) => t.name === "fix_workflow_errors");
    expect(matches).toHaveLength(1);
    const props = (matches[0].inputSchema as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(props)).toEqual(["workflowId"]);
    expect(props).not.toHaveProperty("autoApply");
    expect(props).not.toHaveProperty("useAI");
    expect(props).not.toHaveProperty("retryAfterFix");
  });

  it("has no duplicate tool names in TOOLS", () => {
    const names = TOOLS.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("wires the production Knowledge client into one orchestrated creation pipeline", () => {
    const source = readFileSync(new URL("../mcp.server.ts", import.meta.url), "utf8");
    expect(source).toContain("createKnowledgeClient");
    expect(source).toContain("new WorkflowCreationPipeline");
    expect(source).toContain("creationPipeline");
  });
});
