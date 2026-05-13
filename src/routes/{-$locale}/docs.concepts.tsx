import { createFileRoute } from "@tanstack/react-router";
import { buildBreadcrumbJsonLd, buildDocsTechArticleJsonLd } from "@/lib/seo-jsonld";
import { buildAlternateLinks, resolveLocale } from "@/lib/seo-i18n";
import { useDocsT } from "@/i18n/docs-dict";

const TITLE = "Concepts — n8n-mcp docs";
const DESC = "How the n8n-mcp gateway, platform API keys, n8n instances and MCP tools fit together.";
const URL = "https://n8nmcp.lovable.app/docs/concepts";

export const Route = createFileRoute("/{-$locale}/docs/concepts")({
  head: ({ params }) => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: URL },
      { property: "og:type", content: "article" },
    ],
    links: buildAlternateLinks("/docs/concepts", resolveLocale(params.locale)),
    scripts: [
      {
        type: "application/ld+json",
        children: buildDocsTechArticleJsonLd({ title: TITLE, description: DESC, path: '/docs/concepts' }),
      },
      {
        type: "application/ld+json",
        children: buildBreadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Docs", path: "/docs" }, { name: 'Concepts', path: '/docs/concepts' }]),
      },
    ],
  }),
  component: Page,
});

function Page() {
  const t = useDocsT().concepts;
  return (
    <>
      <h1>{t.h1}</h1>
      <div dangerouslySetInnerHTML={{ __html: t.body }} />
    </>
  );
}