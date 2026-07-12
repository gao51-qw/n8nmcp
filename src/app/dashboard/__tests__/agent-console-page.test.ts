import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("agent console page wiring", () => {
  it("renders the live client instead of the fixture preview", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/dashboard/agent-console/page.tsx"),
      "utf8",
    );

    expect(source).toContain("AgentConsoleClient");
    expect(source).not.toContain("workflowAgentConsoleFixture");
    expect(source).not.toContain("Backend-free");
  });

  it("wires authenticated actions and Realtime invalidation through the client", () => {
    const source = readFileSync(
      resolve(process.cwd(), "src/app/dashboard/agent-console/agent-console-client.tsx"),
      "utf8",
    );

    expect(source).toContain("/api/dashboard/agent-console/actions");
    expect(source).toContain("subscribeToWorkflowAgentConsole");
    expect(source).toContain("confirmationToken");
  });
});
