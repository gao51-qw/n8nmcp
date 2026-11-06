import type { Metadata } from "next";
import { CheckCircle2 } from "lucide-react";
import { SITE_CONTACT_MAILTO } from "@/lib/site-contact";
import { signupHref, surfaceHref } from "@/lib/site-navigation";
import {
  FEATURE_LABELS,
  formatDailyCalls,
  TIER_LABELS,
  TIER_LIMITS,
  TIER_ORDER,
  TIER_PRICE_PERIODS,
  TIER_PRICES,
  TIER_SUMMARIES,
  type Tier,
} from "@/lib/tiers";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "n8n-mcp pricing: a free plan, Pro at $19 for 100,000 MCP calls a day, and Enterprise with unlimited calls.",
  alternates: { canonical: "/pricing" },
};

type PlanAction = { label: string; href: string; primary: boolean };

function planAction(tier: Tier): PlanAction {
  if (tier === "free") return { label: "Start free", href: signupHref(), primary: false };
  if (tier === "pro") {
    return {
      label: `Upgrade to ${TIER_LABELS.pro}`,
      href: surfaceHref("dashboard", "/billing"),
      primary: true,
    };
  }
  return {
    label: "Contact sales",
    href: `${SITE_CONTACT_MAILTO}?subject=${encodeURIComponent("n8n-mcp Enterprise")}`,
    primary: false,
  };
}

function planFeatures(tier: Tier): string[] {
  const limits = TIER_LIMITS[tier];
  return [
    formatDailyCalls(tier),
    `${limits.rpm.toLocaleString("en-US")} requests / minute`,
    ...limits.features.map((feature) => FEATURE_LABELS[feature]),
  ];
}

export default function PricingPage() {
  return (
    <main id="main" className="mx-auto max-w-6xl px-6 py-16">
      <h1 className="text-4xl font-bold">n8n-mcp pricing</h1>
      <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
        n8n-mcp pricing is based on daily MCP call volume. Start free to confirm that an AI client
        can safely inspect and build n8n workflows, upgrade to Pro when you run workflow operations
        every day, and talk to us about Enterprise for unlimited calls and priority support.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-3">
        {TIER_ORDER.map((tier) => {
          const action = planAction(tier);
          const period = TIER_PRICE_PERIODS[tier];
          return (
            <section
              key={tier}
              aria-labelledby={`plan-${tier}`}
              data-plan={tier}
              className={`flex flex-col rounded-lg border bg-card p-6 ${
                action.primary ? "border-primary shadow-[var(--shadow-glow)]" : "border-border"
              }`}
            >
              <h2 id={`plan-${tier}`} className="text-xl font-semibold">
                {TIER_LABELS[tier]}
              </h2>
              <div className="mt-3 flex items-baseline gap-1">
                <span className="text-3xl font-bold">{TIER_PRICES[tier]}</span>
                {period ? <span className="text-sm text-muted-foreground">{period}</span> : null}
              </div>
              <p className="mt-3 text-sm leading-6 text-muted-foreground">{TIER_SUMMARIES[tier]}</p>
              <ul className="mt-5 flex-1 space-y-2 text-sm">
                {planFeatures(tier).map((feature) => (
                  <li key={feature} className="flex items-start gap-2">
                    <CheckCircle2
                      className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    {feature}
                  </li>
                ))}
              </ul>
              <a
                href={action.href}
                className={`mt-6 inline-flex h-11 items-center justify-center rounded-md px-5 text-sm font-semibold transition-colors ${
                  action.primary
                    ? "bg-primary text-primary-foreground hover:opacity-90"
                    : "border border-border hover:border-primary hover:text-primary"
                }`}
              >
                {action.label}
              </a>
            </section>
          );
        })}
      </div>
      <p className="mt-8 text-sm text-muted-foreground">
        Paid plans are billed through Paddle, our merchant of record. Every plan includes the hosted
        MCP endpoint and encrypted n8n credential storage.
      </p>
    </main>
  );
}
