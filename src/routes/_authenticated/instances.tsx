import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/instances")({
  head: () => ({ meta: [{ title: "n8n Instances — n8n-mcp" }] }),
  component: () => (
    <div>
      <h1 className="text-3xl font-bold">n8n Instances</h1>
      <p className="mt-2 text-sm text-muted-foreground">Coming in stage 2 — connect, edit, test your n8n instances.</p>
    </div>
  ),
});
