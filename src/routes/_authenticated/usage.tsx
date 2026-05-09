import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/usage")({
  head: () => ({ meta: [{ title: "Usage — n8n-mcp" }] }),
  component: () => (
    <div>
      <h1 className="text-3xl font-bold">Usage</h1>
      <p className="mt-2 text-sm text-muted-foreground">Daily MCP call counts and recent invocations will appear here.</p>
    </div>
  ),
});
