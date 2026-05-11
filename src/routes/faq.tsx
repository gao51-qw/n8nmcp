import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { FAQ, buildFaqJsonLd } from "@/lib/faq-data";

export const Route = createFileRoute("/faq")({
  head: () => {
    const TITLE = "FAQ — n8n-mcp";
    const DESC =
      "Common questions about n8n-mcp: supported AI clients, security, pricing, self-hosting and the MCP protocol.";
    const URL = "https://n8nmcp.lovable.app/faq";
    return {
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
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify(buildFaqJsonLd()),
        },
      ],
    };
  },
  component: FaqPage,
});

function FaqPage() {
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-primary">FAQ</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            Frequently asked questions
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Real questions from real users. Still stuck?{" "}
            <a
              href="mailto:hello@n8nmcp.app"
              className="text-primary hover:underline"
            >
              email us
            </a>
            .
          </p>
        </div>

        <Accordion type="single" collapsible className="mt-10">
          {FAQ.map((f) => (
            <AccordionItem key={f.q} value={f.q}>
              <AccordionTrigger className="text-left">{f.q}</AccordionTrigger>
              <AccordionContent className="text-muted-foreground">
                {f.a}
              </AccordionContent>
            </AccordionItem>
          ))}
        </Accordion>

        <div className="mt-16 rounded-2xl border border-border bg-card p-8 text-center">
          <h2 className="text-xl font-semibold">Ready to try it?</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            Free tier with 100 MCP calls/day. No credit card required.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-3">
            <Button asChild>
              <Link to="/signup">Start for free</Link>
            </Button>
            <Button asChild variant="outline">
              <Link to="/docs">Read the docs</Link>
            </Button>
          </div>
        </div>
      </main>
      <MarketingFooter />
    </div>
  );
}
