import { createFileRoute } from "@tanstack/react-router";
import { buildBreadcrumbJsonLd, buildDocsTechArticleJsonLd } from "@/lib/seo-jsonld";
import { Link } from "@/i18n/link";
import { buildAlternateLinks, resolveLocale } from "@/lib/seo-i18n";

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

const CARDS: { to: string; title: string; desc: string }[] = [
  { to: "/docs/getting-started", title: "Getting started", desc: "Sign up, mint a key, connect your first client in 5 minutes." },
  { to: "/docs/concepts", title: "Concepts", desc: "How the MCP gateway, API keys and n8n instances fit together." },
  { to: "/docs/clients", title: "Connect a client", desc: "Config snippets for Claude, ChatGPT, Cursor, VS Code and more." },
  { to: "/docs/api-keys", title: "API keys", desc: "Create, rotate and revoke platform tokens." },
  { to: "/docs/n8n-instances", title: "n8n instances", desc: "Add your self-hosted or cloud n8n with encrypted credentials." },
  { to: "/docs/tools", title: "MCP tools reference", desc: "All runtime, knowledge and management tools the gateway exposes." },
  { to: "/docs/quotas", title: "Quotas & billing", desc: "Tier limits, usage tracking and upgrades." },
  { to: "/docs/security", title: "Security", desc: "Encryption at rest, SSRF protections, RLS and audit." },
  { to: "/docs/admin", title: "Admin guide", desc: "Manage users, announcements, deployment and roles." },
  { to: "/docs/self-hosting", title: "Self-hosting", desc: "Run the gateway in Docker on your own VPS." },
  { to: "/docs/troubleshooting", title: "Troubleshooting", desc: "Common errors and how to fix them." },
];

function DocsIndex() {
  return (
    <>
      <h1>Documentation</h1>
      <p className="lead text-muted-foreground">
        n8n-mcp is a hosted Model Context Protocol gateway in front of your n8n instance.
        Any MCP-capable client can list and call your workflows as typed tools, and use the
        bundled knowledge base of ~1,650 n8n nodes to author new ones.
      </p>
      <p className="text-muted-foreground">
        Pick a topic below, or jump straight to{" "}
        <Link to="/docs/getting-started">Getting started</Link>.
      </p>

      <div className="not-prose mt-8 grid gap-3 sm:grid-cols-2">
        {CARDS.map((c) => (
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