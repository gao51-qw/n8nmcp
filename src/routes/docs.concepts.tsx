import { createFileRoute } from "@tanstack/react-router";

const TITLE = "Concepts — n8n-mcp docs";
const DESC = "How the n8n-mcp gateway, platform API keys, n8n instances and MCP tools fit together.";
const URL = "https://n8nmcp.lovable.app/docs/concepts";

export const Route = createFileRoute("/docs/concepts")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: URL },
      { property: "og:type", content: "article" },
    ],
    links: [{ rel: "canonical", href: URL }],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <h1>Concepts</h1>
      <p className="text-muted-foreground">
        Three primitives are enough to understand the entire system.
      </p>

      <h2>The gateway</h2>
      <p className="text-muted-foreground">
        A multi-tenant HTTPS endpoint at <code>/api/public/mcp</code> that speaks the
        Model Context Protocol over Streamable HTTP. It authenticates the caller with a
        platform API key, looks up which n8n instance to forward to, and translates each
        MCP tool call into the appropriate n8n REST request.
      </p>

      <h2>Platform API keys</h2>
      <p className="text-muted-foreground">
        Tokens prefixed with <code>nmcp_</code> that identify <em>your account</em> to the
        gateway. They are sent as <code>Authorization: Bearer …</code> by your MCP client.
        Multiple keys per account are supported &mdash; mint one per device or workspace so you
        can revoke them independently.
      </p>

      <h2>n8n instances</h2>
      <p className="text-muted-foreground">
        A pair of <code>(base URL, n8n API key)</code> stored on your account. The n8n API
        key is encrypted at rest with AES-256-GCM. The Free tier allows one instance; paid
        tiers raise the limit. The gateway never exposes the n8n key back to clients.
      </p>

      <h2>Tool routing</h2>
      <p className="text-muted-foreground">
        When your client calls a tool, the gateway:
      </p>
      <ol className="text-muted-foreground">
        <li>Validates the bearer token and resolves the owning account.</li>
        <li>Checks daily quota; rejects with <code>429</code> if exhausted.</li>
        <li>For runtime tools (<code>list_workflows</code>, <code>execute_workflow</code>, …),
        decrypts the n8n key in memory and proxies the call.</li>
        <li>For knowledge tools (<code>search_nodes</code>, <code>get_node_essentials</code>, …),
        serves results from the bundled SQLite knowledge base &mdash; no n8n call needed.</li>
        <li>Records usage for the dashboard and billing.</li>
      </ol>

      <h2>Why a gateway?</h2>
      <ul className="text-muted-foreground">
        <li>Your n8n API key never leaves the server.</li>
        <li>Stable URL even if you redeploy n8n.</li>
        <li>Per-tool quotas and observability across all clients.</li>
        <li>Built-in knowledge of ~1,650 n8n nodes for AI authoring.</li>
      </ul>
    </>
  );
}