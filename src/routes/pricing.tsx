import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing-header";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

export const Route = createFileRoute("/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing — n8n-mcp" },
      { name: "description", content: "Simple per-month pricing. Free tier with 100 MCP calls/day." },
    ],
  }),
  component: Pricing,
});

const TIERS = [
  {
    name: "Free",
    price: "$0",
    cadence: "forever",
    features: ["100 MCP calls / day", "1 n8n instance", "1 platform API key", "Community support"],
    cta: "Start free",
  },
  {
    name: "Supporter",
    price: "$19",
    cadence: "per month",
    features: ["10,000 MCP calls / day", "5 n8n instances", "Unlimited API keys", "Priority email support"],
    cta: "Upgrade",
    highlight: true,
  },
  {
    name: "Pro",
    price: "$49",
    cadence: "per month",
    features: ["100,000 MCP calls / day", "Unlimited instances", "Audit logs", "SLA & private support"],
    cta: "Go Pro",
  },
];

function Pricing() {
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <h1 className="text-4xl font-bold md:text-5xl">Simple pricing</h1>
          <p className="mt-3 text-muted-foreground">No seats, no surprises. Cancel any time.</p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`rounded-2xl border p-8 ${
                t.highlight ? "border-primary bg-card" : "border-border bg-card/50"
              }`}
              style={t.highlight ? { boxShadow: "var(--shadow-glow)" } : undefined}
            >
              <h3 className="text-lg font-semibold">{t.name}</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold">{t.price}</span>
                <span className="text-sm text-muted-foreground">/{t.cadence}</span>
              </div>
              <ul className="mt-6 space-y-2 text-sm">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="mt-0.5 h-4 w-4 text-primary" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              <Button asChild className="mt-8 w-full" variant={t.highlight ? "default" : "outline"}>
                <Link to="/signup">{t.cta}</Link>
              </Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
