import { createFileRoute } from "@tanstack/react-router";
import { buildBreadcrumbJsonLd, buildDocsTechArticleJsonLd } from "@/lib/seo-jsonld";
import { buildAlternateLinks, resolveLocale } from "@/lib/seo-i18n";
import { useDocsT } from "@/i18n/docs-dict";

const TITLE = "Platform API keys — n8n-mcp docs";
const DESC = "Create, label, rotate and revoke nmcp_ platform API keys used by your MCP clients.";
const URL = "https://n8nmcp.lovable.app/docs/api-keys";

export const Route = createFileRoute("/{-$locale}/docs/api-keys")({
  head: ({ params }) => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: URL },
      { property: "og:type", content: "article" },
    ],
    links: buildAlternateLinks("/docs/api-keys", resolveLocale(params.locale)),
    scripts: [
      {
        type: "application/ld+json",
        children: buildDocsTechArticleJsonLd({ title: TITLE, description: DESC, path: '/docs/api-keys' }),
      },
      {
        type: "application/ld+json",
        children: buildBreadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Docs", path: "/docs" }, { name: 'API keys', path: '/docs/api-keys' }]),
      },
    ],
  }),
  component: Page,
});

function Page() {
  const t = useDocsT().apiKeys;
  return (
    <>
      <h1>{t.h1}</h1>
      <div dangerouslySetInnerHTML={{ __html: t.body }} />
    </>
  );
}