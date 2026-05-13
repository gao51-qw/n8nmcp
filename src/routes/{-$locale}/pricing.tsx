import { createFileRoute } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";
import { useT } from "@/i18n/context";
import { Link } from "@/i18n/link";

const TITLE = "Pricing — n8n-mcp";
const DESC =
  "Simple per-month pricing for the n8n-mcp gateway. Free tier with 100 MCP calls/day, paid plans from $19/mo. No seats, cancel anytime.";
const URL = "https://n8nmcp.lovable.app/pricing";

export const Route = createFileRoute("/{-$locale}/pricing")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: URL },
      { property: "og:type", content: "website" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
    ],
    links: [{ rel: "canonical", href: URL }],
  }),
  component: Pricing,
});

function Pricing() {
  const t = useT();
  const p = t.pricingPage;
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <h1 className="text-4xl font-bold md:text-5xl">{p.title}</h1>
          <p className="mt-3 text-muted-foreground">{p.subtitle}</p>
        </div>
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {p.tiers.map((tier, i) => {
            const highlight = i === 1;
            const cadence =
              tier.cadenceKey === "forever" ? p.cadenceForever : p.cadenceMonth;
            return (
              <div
                key={tier.name}
                className={`rounded-2xl border p-8 ${
                  highlight ? "border-primary bg-card" : "border-border bg-card/50"
                }`}
                style={highlight ? { boxShadow: "var(--shadow-glow)" } : undefined}
              >
                <h3 className="text-lg font-semibold">{tier.name}</h3>
                <div className="mt-4 flex items-baseline gap-1">
                  <span className="text-4xl font-bold">{tier.price}</span>
                  <span className="text-sm text-muted-foreground">/{cadence}</span>
                </div>
                <ul className="mt-6 space-y-2 text-sm">
                  {tier.features.map((f) => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="mt-0.5 h-4 w-4 text-primary" />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Button asChild className="mt-8 w-full" variant={highlight ? "default" : "outline"}>
                  <Link to="/signup">{tier.cta}</Link>
                </Button>
              </div>
            );
          })}
        </div>
      </section>
      <MarketingFooter />
    </div>
  );
}
