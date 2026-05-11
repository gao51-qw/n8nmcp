import { createFileRoute } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";

export const Route = createFileRoute("/imprint")({
  head: () => {
    const TITLE = "Imprint — n8n-mcp";
    const DESC =
      "Legal disclosure and operator information for the n8n-mcp hosted gateway.";
    const URL = "https://n8nmcp.lovable.app/imprint";
    return {
      meta: [
        { title: TITLE },
        { name: "description", content: DESC },
        { property: "og:title", content: TITLE },
        { property: "og:description", content: DESC },
        { property: "og:url", content: URL },
        { name: "robots", content: "index,follow" },
      ],
      links: [{ rel: "canonical", href: URL }],
    };
  },
  component: ImprintPage,
});

function ImprintPage() {
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight">Imprint</h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Information in accordance with applicable disclosure requirements.
        </p>

        <section className="prose prose-invert mt-10 max-w-none text-sm leading-relaxed text-muted-foreground">
          <h2 className="text-foreground">Operator</h2>
          <p>
            n8n-mcp is operated as an independent project. It is not affiliated
            with, endorsed by, or sponsored by n8n GmbH. "n8n" is a trademark of
            n8n GmbH.
          </p>

          <h2 className="mt-8 text-foreground">Contact</h2>
          <p>
            Email:{" "}
            <a
              href="mailto:hello@n8nmcp.app"
              className="text-primary hover:underline"
            >
              hello@n8nmcp.app
            </a>
          </p>

          <h2 className="mt-8 text-foreground">Responsible for content</h2>
          <p>
            The operator listed above is responsible for the content of this
            website. Specific legal contact details can be requested via the
            email address above.
          </p>

          <h2 className="mt-8 text-foreground">Disclaimer</h2>
          <p>
            All trademarks, logos and brand names referenced on this site are
            the property of their respective owners. References are made for
            identification purposes only.
          </p>
        </section>
      </main>
      <MarketingFooter />
    </div>
  );
}
