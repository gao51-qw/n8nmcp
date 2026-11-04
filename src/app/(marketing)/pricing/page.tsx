import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple n8n-mcp pricing for teams connecting n8n workflows to AI clients.",
  alternates: { canonical: "/pricing" },
};

const plans = [
  {
    name: "Free",
    price: "$0",
    text: "For testing MCP client setup and low-volume workflow exploration.",
    features: ["Hosted MCP endpoint", "Basic workflow tools", "Starter daily quota"],
  },
  {
    name: "Team",
    price: "Contact",
    text: "For teams that need higher quotas, shared operations and production support.",
    features: ["Higher request limits", "Multiple operators", "Security and quota controls"],
  },
];

export default function PricingPage() {
  return (
    <main id="main" className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="text-4xl font-bold">n8n-mcp pricing</h1>
      <p className="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
        n8n-mcp pricing is designed around MCP request volume and team operating needs. Start with a
        free setup to validate that an AI client can safely inspect n8n workflows, then move to a
        team plan when production usage requires higher quotas and support.
      </p>
      <div className="mt-10 grid gap-4 md:grid-cols-2">
        {plans.map((plan) => (
          <section key={plan.name} className="rounded-lg border border-border bg-card p-6">
            <h2 className="text-xl font-semibold">{plan.name}</h2>
            <div className="mt-3 text-3xl font-bold">{plan.price}</div>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{plan.text}</p>
            <ul className="mt-5 space-y-2 text-sm">
              {plan.features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
