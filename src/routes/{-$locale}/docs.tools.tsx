import { createFileRoute } from "@tanstack/react-router";
import { buildBreadcrumbJsonLd, buildDocsTechArticleJsonLd } from "@/lib/seo-jsonld";
import { buildAlternateLinks, resolveLocale } from "@/lib/seo-i18n";

const TITLE = "MCP tools reference — n8n-mcp docs";
const DESC = "Complete reference of runtime, knowledge and management tools exposed by the n8n-mcp gateway.";
const URL = "https://n8nmcp.lovable.app/docs/tools";

export const Route = createFileRoute("/{-$locale}/docs/tools")({
  head: ({ params }) => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: URL },
      { property: "og:type", content: "article" },
    ],
    links: buildAlternateLinks("/docs/tools", resolveLocale(params.locale)),
    scripts: [
      {
        type: "application/ld+json",
        children: buildDocsTechArticleJsonLd({ title: TITLE, description: DESC, path: '/docs/tools' }),
      },
      {
        type: "application/ld+json",
        children: buildBreadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Docs", path: "/docs" }, { name: 'MCP tools reference', path: '/docs/tools' }]),
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <h1>MCP tools reference</h1>
      <p className="text-muted-foreground">
        Tools are grouped into three categories. All tools accept an optional
        <code>instance</code> argument to target a specific n8n instance.
      </p>

      <h2 id="runtime">Runtime tools</h2>
      <p className="text-muted-foreground">
        Direct interactions with workflows and executions on your n8n.
      </p>
      <table>
        <thead>
          <tr><th>Tool</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>list_workflows</code></td><td>List workflows with filters (active, tags, project).</td></tr>
          <tr><td><code>get_workflow</code></td><td>Fetch a workflow by id, including nodes and connections.</td></tr>
          <tr><td><code>create_workflow</code></td><td>Create a new workflow from a JSON definition.</td></tr>
          <tr><td><code>update_workflow</code></td><td>Patch nodes, settings or activation state.</td></tr>
          <tr><td><code>delete_workflow</code></td><td>Delete a workflow by id.</td></tr>
          <tr><td><code>execute_workflow</code></td><td>Trigger a manual execution and stream the result.</td></tr>
          <tr><td><code>list_executions</code></td><td>List recent executions with status filters.</td></tr>
          <tr><td><code>get_execution</code></td><td>Inspect a single execution&rsquo;s data and errors.</td></tr>
        </tbody>
      </table>

      <h2 id="knowledge">Knowledge tools</h2>
      <p className="text-muted-foreground">
        Read-only lookups against the embedded n8n node catalog. They run against
        local data and do not call your n8n.
      </p>
      <table>
        <thead>
          <tr><th>Tool</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>search_nodes</code></td><td>Full-text search across n8n core and community nodes.</td></tr>
          <tr><td><code>get_node_info</code></td><td>Return parameters, credentials and operations for a node.</td></tr>
          <tr><td><code>list_node_categories</code></td><td>Browse nodes grouped by category (AI, Data, Comms&hellip;).</td></tr>
          <tr><td><code>get_node_examples</code></td><td>Return canonical example workflows for a given node.</td></tr>
        </tbody>
      </table>

      <h2 id="management">Management tools</h2>
      <p className="text-muted-foreground">
        Administrative operations against the n8n REST API. Only available to keys with
        the <code>management</code> scope.
      </p>
      <table>
        <thead>
          <tr><th>Tool</th><th>Description</th></tr>
        </thead>
        <tbody>
          <tr><td><code>list_credentials</code></td><td>List credentials (without secret values).</td></tr>
          <tr><td><code>list_users</code></td><td>List users on your n8n instance.</td></tr>
          <tr><td><code>list_projects</code></td><td>List n8n projects (Enterprise).</td></tr>
          <tr><td><code>list_tags</code></td><td>List workflow tags.</td></tr>
          <tr><td><code>get_audit</code></td><td>Run an n8n audit and return the security report.</td></tr>
        </tbody>
      </table>

      <h2 id="errors">Error semantics</h2>
      <p className="text-muted-foreground">
        Tool errors are returned as MCP <code>isError: true</code> results with a sanitized
        message. The gateway never forwards raw n8n stack traces to the client.
      </p>
    </>
  );
}