import { createFileRoute, Link } from "@tanstack/react-router";
import { buildBreadcrumbJsonLd, buildDocsTechArticleJsonLd } from "@/lib/seo-jsonld";

const TITLE = "Getting started — n8n-mcp docs";
const DESC = "Sign up, create a platform API key, connect your n8n instance and wire up your first MCP client in under five minutes.";
const URL = "https://n8nmcp.lovable.app/docs/getting-started";

export const Route = createFileRoute("/{-$locale}/docs/getting-started")({
  head: () => ({
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
    links: [{ rel: "canonical", href: URL }],
    scripts: [
      {
        type: "application/ld+json",
        children: buildDocsTechArticleJsonLd({ title: TITLE, description: DESC, path: '/docs/getting-started' }),
      },
      {
        type: "application/ld+json",
        children: buildBreadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Docs", path: "/docs" }, { name: 'Getting started', path: '/docs/getting-started' }]),
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <h1>Getting started</h1>
      <p className="text-muted-foreground">
        This walkthrough takes about five minutes. You will end with Claude (or any other
        MCP client) able to list and execute workflows on your own n8n instance.
      </p>

      <h2>1. Create an account</h2>
      <p className="text-muted-foreground">
        Sign up at <Link to="/signup">/signup</Link> with email + password or Google. New
        accounts start on the <strong>Free</strong> tier (100 MCP calls/day, 1 n8n instance).
      </p>

      <h2>2. Mint a platform API key</h2>
      <ol className="text-muted-foreground">
        <li>Open <Link to="/api-keys">API Keys</Link> in the dashboard.</li>
        <li>Click <strong>New key</strong>, give it a label (e.g. <code>claude-laptop</code>).</li>
        <li>Copy the <code>nmcp_…</code> token immediately — it is shown only once.</li>
      </ol>
      <p className="text-muted-foreground">
        Treat the token like a password. Anyone holding it can call your gateway under
        your account&rsquo;s quota.
      </p>

      <h2>3. Connect an n8n instance</h2>
      <ol className="text-muted-foreground">
        <li>Open <Link to="/instances">n8n Instances</Link> → <strong>Add</strong>.</li>
        <li>Paste your n8n base URL (e.g. <code>https://n8n.example.com</code>).</li>
        <li>Generate an n8n API key in your n8n UI under <em>Settings → n8n API</em> and paste it.</li>
        <li>We encrypt the key with AES-256-GCM before it touches the database.</li>
      </ol>

      <h2>4. Wire up your MCP client</h2>
      <p className="text-muted-foreground">
        Point any MCP client at the gateway URL with your token as a bearer header:
      </p>
      <pre>{`{
  "mcpServers": {
    "n8n-mcp": {
      "url": "https://n8nmcp.lovable.app/api/public/mcp",
      "headers": { "Authorization": "Bearer nmcp_..." }
    }
  }
}`}</pre>
      <p className="text-muted-foreground">
        See <Link to="/docs/clients">Connect a client</Link> for per-client snippets.
      </p>

      <h2>5. Try it</h2>
      <p className="text-muted-foreground">
        Restart your client. Ask: <em>&ldquo;List my n8n workflows.&rdquo;</em> The client should
        invoke <code>list_workflows</code> against your instance and return the response.
      </p>

      <h2>What&rsquo;s next?</h2>
      <ul className="text-muted-foreground">
        <li><Link to="/docs/tools">Browse the full tool catalog</Link></li>
        <li><Link to="/docs/quotas">Understand quotas and how to upgrade</Link></li>
        <li><Link to="/docs/security">Read the security model</Link></li>
      </ul>
    </>
  );
}