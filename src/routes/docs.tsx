import { createFileRoute } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";

export const Route = createFileRoute("/docs")({
  head: () => ({
    meta: [
      { title: "Docs — n8n-mcp" },
      { name: "description", content: "Connect any MCP client to your n8n instance." },
    ],
  }),
  component: Docs,
});

function Docs() {
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <article className="mx-auto max-w-3xl px-6 py-16 prose prose-invert">
        <h1 className="text-4xl font-bold">Getting started</h1>
        <p className="mt-4 text-muted-foreground">
          n8n-mcp exposes your n8n instance over the Model Context Protocol (MCP) Streamable
          HTTP transport. Any MCP-compatible client can list and call your workflows as tools.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">1. Add a platform API key</h2>
        <p className="mt-2 text-muted-foreground">
          From the dashboard, go to <strong>API Keys → New key</strong>. Copy the
          <code className="mx-1 rounded bg-muted px-1.5 py-0.5">nmcp_…</code> token — you can
          only see it once.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">2. Connect an n8n instance</h2>
        <p className="mt-2 text-muted-foreground">
          Open <strong>n8n Instances → Add</strong>. Provide your n8n base URL and an n8n API
          key (Settings → n8n API in your n8n instance). We encrypt it before storing.
        </p>

        <h2 className="mt-10 text-2xl font-semibold">3. Configure your MCP client</h2>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-card p-4 text-xs">
{`{
  "mcpServers": {
    "n8n-mcp": {
      "url": "https://your-app.lovable.app/api/public/mcp",
      "headers": { "Authorization": "Bearer nmcp_..." }
    }
  }
}`}
        </pre>

        <h2 className="mt-10 text-2xl font-semibold">Available tools</h2>
        <p className="mt-2 text-muted-foreground">
          The gateway exposes <strong>4 runtime tools</strong> against your own n8n instance
          (<code>list_workflows</code>, <code>get_workflow</code>, <code>execute_workflow</code>,
          <code>list_executions</code>) <strong>plus the full czlonkowski/n8n-mcp toolbelt</strong> when
          an upstream knowledge base is configured — covering ~1,650 nodes (820 core + 830 community).
        </p>
        <p className="mt-2 text-muted-foreground">
          That includes knowledge tools (<code>search_nodes</code>, <code>get_node_essentials</code>,
          <code>get_node_documentation</code>, <code>validate_workflow</code>,
          <code>list_ai_tools</code>, <code>search_templates</code>, …) and management tools
          (<code>n8n_create_workflow</code>, <code>n8n_update_partial_workflow</code>,
          <code>n8n_trigger_webhook_workflow</code>, …). Management tools automatically use your stored
          n8n credentials; knowledge tools work without an instance.
        </p>
      </article>
      <MarketingFooter />
    </div>
  );
}
