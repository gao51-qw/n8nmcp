import { createFileRoute } from "@tanstack/react-router";
import { buildBreadcrumbJsonLd, buildDocsTechArticleJsonLd } from "@/lib/seo-jsonld";
import { buildAlternateLinks, resolveLocale } from "@/lib/seo-i18n";
import { useDocsT } from "@/i18n/docs-dict";

const TITLE = "Connect any MCP client — n8n-mcp docs";
const DESC = "Configuration snippets for Claude Desktop, Claude Code, ChatGPT, Cursor, Windsurf, VS Code, Continue, Cline, Zed, Gemini CLI and Codex CLI.";
const URL = "https://n8nmcp.lovable.app/docs/clients";

export const Route = createFileRoute("/{-$locale}/docs/clients")({
  head: ({ params }) => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: URL },
      { property: "og:type", content: "article" },
    ],
    links: buildAlternateLinks("/docs/clients", resolveLocale(params.locale)),
    scripts: [
      {
        type: "application/ld+json",
        children: buildDocsTechArticleJsonLd({ title: TITLE, description: DESC, path: '/docs/clients' }),
      },
      {
        type: "application/ld+json",
        children: buildBreadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Docs", path: "/docs" }, { name: 'Connect a client', path: '/docs/clients' }]),
      },
    ],
  }),
  component: Page,
});

function Page() {
  const t = useDocsT().clients;
  return (
    <>
      <h1>{t.h1}</h1>
      <div dangerouslySetInnerHTML={{ __html: t.body }} />
    </>
  );
}