import { createFileRoute } from "@tanstack/react-router";
import { buildBreadcrumbJsonLd, buildDocsTechArticleJsonLd } from "@/lib/seo-jsonld";
import { buildAlternateLinks, resolveLocale } from "@/lib/seo-i18n";

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

const ENDPOINT = "https://n8nmcp.lovable.app/api/public/mcp";

function Page() {
  return (
    <>
      <h1>Connect a client</h1>
      <p className="text-muted-foreground">
        Every MCP-compatible client uses the same gateway URL and the same bearer token.
        Only the config file location changes.
      </p>
      <p className="text-muted-foreground">
        Endpoint: <code>{ENDPOINT}</code>
      </p>

      <h2 id="claude-desktop">Claude Desktop</h2>
      <p className="text-muted-foreground">
        Edit <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> on
        macOS or <code>%APPDATA%\Claude\claude_desktop_config.json</code> on Windows:
      </p>
      <pre>{`{
  "mcpServers": {
    "n8n-mcp": {
      "url": "${ENDPOINT}",
      "headers": { "Authorization": "Bearer nmcp_..." }
    }
  }
}`}</pre>
      <p className="text-muted-foreground">Quit and reopen Claude. The hammer icon should show n8n-mcp tools.</p>

      <h2 id="claude-code">Claude Code</h2>
      <pre>{`claude mcp add --transport http n8n-mcp ${ENDPOINT} \\
  --header "Authorization: Bearer nmcp_..."`}</pre>

      <h2 id="chatgpt">ChatGPT (custom connectors)</h2>
      <p className="text-muted-foreground">
        In ChatGPT settings → Connectors → <strong>Add custom connector</strong>:
      </p>
      <ul className="text-muted-foreground">
        <li>URL: <code>{ENDPOINT}</code></li>
        <li>Auth header: <code>Authorization: Bearer nmcp_...</code></li>
      </ul>

      <h2 id="cursor">Cursor</h2>
      <p className="text-muted-foreground">
        Cursor settings → MCP → <strong>Add new MCP server</strong>, paste the same JSON
        block as Claude Desktop.
      </p>

      <h2 id="windsurf">Windsurf</h2>
      <p className="text-muted-foreground">
        Settings → MCP servers → edit <code>mcp_config.json</code> with the standard
        <code>mcpServers</code> block above.
      </p>

      <h2 id="vscode">VS Code (Copilot Chat) & Continue</h2>
      <p className="text-muted-foreground">
        Both expose an MCP servers list in their settings UI. Use the gateway URL with the
        bearer header.
      </p>

      <h2 id="zed">Zed</h2>
      <pre>{`// ~/.config/zed/settings.json
{
  "context_servers": {
    "n8n-mcp": {
      "command": { "transport": "http", "url": "${ENDPOINT}",
        "headers": { "Authorization": "Bearer nmcp_..." } }
    }
  }
}`}</pre>

      <h2 id="gemini-cli">Gemini CLI / Codex CLI / LM Studio</h2>
      <p className="text-muted-foreground">
        All three use a JSON config with the same URL + header pair. Refer to each tool&rsquo;s
        MCP docs for the exact filename.
      </p>

      <h2 id="verifying">Verifying the connection</h2>
      <p className="text-muted-foreground">
        Once configured, ask: <em>&ldquo;What n8n tools do you have?&rdquo;</em> The client should
        list <code>list_workflows</code>, <code>execute_workflow</code>, knowledge tools and any
        management tools you have access to.
      </p>
    </>
  );
}