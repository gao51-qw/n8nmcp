import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/billing")({
  head: () => ({ meta: [{ title: "Billing — n8n-mcp" }] }),
  component: () => (
    <div>
      <h1 className="text-3xl font-bold">Billing</h1>
      <p className="mt-2 text-sm text-muted-foreground">You're on the Free plan. Upgrades land in stage 4.</p>
    </div>
  ),
});
