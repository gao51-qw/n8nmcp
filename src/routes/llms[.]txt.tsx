import { createFileRoute } from "@tanstack/react-router";

const SITE = "https://n8nmcp.lovable.app";

// llmstxt.org spec: a Markdown index that lets LLMs ingest the most
// important parts of the site without crawling JS-rendered HTML.
const BODY = `# n8n-mcp

> Hosted Model Context Protocol (MCP) gateway for n8n. Connect Claude, ChatGPT,
> Cursor, Windsurf, VS Code, Zed and any MCP-compatible AI client to your
> self-hosted n8n instance in seconds. Free tier with 100 calls/day, no credit
> card required.

n8n-mcp is a multi-tenant MCP gateway. Users connect their self-hosted n8n
instance, get a stable per-user MCP URL plus an API key, and can then expose
their workflows, credentials and node knowledge to any AI client that speaks
MCP over Streamable HTTP. n8n API keys are AES-256-GCM encrypted at rest and
never leave the gateway.

## Documentation

- [Overview](${SITE}/docs): What n8n-mcp is and how the gateway fits between AI clients and your n8n.
- [Getting started](${SITE}/docs/getting-started): Sign up, add an n8n instance, create an API key, connect a client.
- [Concepts](${SITE}/docs/concepts): Per-user MCP URL, platform API key, n8n instance, tool routing.
- [MCP clients](${SITE}/docs/clients): Claude Desktop / Claude Code, ChatGPT, Cursor, Windsurf, VS Code, Zed setup.
- [API keys](${SITE}/docs/api-keys): Create, rotate and revoke platform API keys (\`nmcp_...\`).
- [n8n instances](${SITE}/docs/n8n-instances): Add an instance URL, store an n8n API key, SSRF protection.
- [MCP tools reference](${SITE}/docs/tools): Runtime, Knowledge and Management tool catalogs.
- [Quotas & billing](${SITE}/docs/quotas): Free / Supporter / Team plan limits and quota windows.
- [Security](${SITE}/docs/security): Encryption at rest, RLS, SSRF guard, error sanitization.

## Product

- [Pricing](${SITE}/pricing)
- [FAQ](${SITE}/faq)
- [Blog](${SITE}/blog)

## Optional

- [Sitemap](${SITE}/sitemap.xml)
- [Full documentation as plain text](${SITE}/llms-full.txt)
`;

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET: () =>
        new Response(BODY, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});