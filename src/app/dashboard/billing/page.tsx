import type { Metadata } from "next";
import { BillingPanel } from "./billing-panel";

export const metadata: Metadata = {
  title: "Billing",
  description: "Your n8n-mcp plan, daily MCP quota and Paddle subscription.",
  robots: { index: false, follow: false },
};

export default function BillingPage() {
  return (
    <main id="main" className="mx-auto max-w-4xl px-6 py-12">
      <h1 className="text-3xl font-bold tracking-tight">Billing</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Your plan, daily MCP quota and subscription.
      </p>
      <div className="mt-8">
        <BillingPanel />
      </div>
    </main>
  );
}
