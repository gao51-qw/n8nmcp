import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/api-keys")({
  head: () => ({ meta: [{ title: "API Keys — n8n-mcp" }] }),
  component: () => (
    <div>
      <h1 className="text-3xl font-bold">Platform API Keys</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming in stage 2 — generate and manage your nmcp_ keys.</p>
    </div>
  ),
});
