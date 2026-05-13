import { createFileRoute } from "@tanstack/react-router";
import { buildBreadcrumbJsonLd, buildDocsTechArticleJsonLd } from "@/lib/seo-jsonld";
import { Link } from "@/i18n/link";
import { buildAlternateLinks, resolveLocale } from "@/lib/seo-i18n";

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
  return (
    <>
      <h1>Platform API keys</h1>
      <p className="text-muted-foreground">
        Platform API keys (prefix <code>nmcp_</code>) authenticate your MCP client to the
        gateway. They are <em>not</em> your n8n API key &mdash; that one stays server-side.
      </p>

      <h2>Create a key</h2>
      <ol className="text-muted-foreground">
        <li>Open <Link to="/api-keys">API Keys</Link>.</li>
        <li>Click <strong>New key</strong> and give it a label (e.g. <code>cursor-work</code>).</li>
        <li>Copy the displayed token immediately. After you close the dialog, only the prefix
          and a hash remain in our database.</li>
      </ol>

      <h2>Best practices</h2>
      <ul className="text-muted-foreground">
        <li>One key per device or workspace, so you can revoke them individually.</li>
        <li>Never commit keys to git or share them in chat. Treat them like passwords.</li>
        <li>Rotate keys quarterly or when a teammate leaves.</li>
      </ul>

      <h2>Rotate a key</h2>
      <p className="text-muted-foreground">
        We do not currently support in-place rotation. Mint a new key, update the client
        config, then revoke the old key from the same page.
      </p>

      <h2>Revoke a key</h2>
      <p className="text-muted-foreground">
        Click the trash icon next to the key. Revocation is immediate &mdash; the next call from
        a client using that token will return <code>401</code>.
      </p>

      <h2>Quotas</h2>
      <p className="text-muted-foreground">
        Quota is per-account, not per-key. Splitting keys does not multiply your daily limit.
        See <Link to="/docs/quotas">Quotas &amp; billing</Link>.
      </p>
    </>
  );
}