import type { Metadata } from "next";
import { homepageFaq } from "@/lib/geo-content";
import { buildFaqPageJsonLd } from "@/lib/seo-jsonld";

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Answers to common questions about n8n-mcp, hosted MCP gateways, n8n API key safety and supported AI clients.",
  alternates: { canonical: "/faq" },
};

export default function FaqPage() {
  return (
    <main id="main" className="mx-auto max-w-4xl px-6 py-16">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: buildFaqPageJsonLd([...homepageFaq]) }}
      />
      <h1 className="text-4xl font-bold">n8n-mcp FAQ</h1>
      <p className="mt-5 text-lg leading-8 text-muted-foreground">
        These answers explain how the hosted n8n-mcp gateway connects AI clients to n8n workflows,
        how credentials are protected and when a gateway is useful compared with a local MCP server.
      </p>
      <div className="mt-10 grid gap-4">
        {homepageFaq.map((item) => (
          <section key={item.q} className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-lg font-semibold">{item.q}</h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.a}</p>
          </section>
        ))}
      </div>
    </main>
  );
}
