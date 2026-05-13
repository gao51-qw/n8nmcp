import { createFileRoute } from "@tanstack/react-router";
import { buildBreadcrumbJsonLd, buildDocsTechArticleJsonLd } from "@/lib/seo-jsonld";
import { Link } from "@/i18n/link";
import { buildAlternateLinks, resolveLocale } from "@/lib/seo-i18n";
import { useDocsT } from "@/i18n/docs-dict";

const TITLE = "Documentation — n8n-mcp";
const DESC =
  "Complete operations manual for n8n-mcp: connect AI clients to n8n via the Model Context Protocol, manage API keys, n8n instances, quotas, security and admin tasks.";
const URL = "https://n8nmcp.lovable.app/docs";

export const Route = createFileRoute("/{-$locale}/docs/")({
  head: ({ params }) => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: URL },
      { property: "og:type", content: "article" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
    ],
    links: buildAlternateLinks("/docs", resolveLocale(params.locale)),
    scripts: [
      {
        type: "application/ld+json",
        children: buildDocsTechArticleJsonLd({ title: TITLE, description: DESC, path: '/docs' }),
      },
      {
        type: "application/ld+json",
        children: buildBreadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Docs", path: "/docs" }]),
      },
    ],
  }),
  component: DocsIndex,
});

function DocsIndex() {
  const t = useDocsT().index;
  return (
    <>
      <h1>{t.h1}</h1>
      <p className="lead text-muted-foreground">{t.lead}</p>
      <p className="text-muted-foreground">
        {t.pickPrefix}
        <Link to="/docs/getting-started">{t.pickLink}</Link>
        {t.pickSuffix}
      </p>

      <div className="not-prose mt-8 grid gap-3 sm:grid-cols-2">
        {t.cards.map((c) => (
          <Link
            key={c.to}
            to={c.to}
            className="group rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/50 hover:bg-accent"
          >
            <div className="font-semibold text-foreground group-hover:text-primary">{c.title}</div>
            <div className="mt-1 text-sm text-muted-foreground">{c.desc}</div>
          </Link>
        ))}
      </div>
    </>
  );
}