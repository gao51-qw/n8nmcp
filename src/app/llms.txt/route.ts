import { headers } from "next/headers";
import { getBlogPosts } from "@/lib/blog-content.server";
import { MCP_ENDPOINT_URL, canonicalUrl, siteUrl, surfaceFromHost } from "@/lib/site-domains";

function mcpBody() {
  return `# n8n-mcp

> Hosted Model Context Protocol (MCP) gateway for n8n workflows.

n8n-mcp connects self-hosted n8n instances to Claude, ChatGPT, Cursor, Windsurf,
VS Code, Zed and other MCP-compatible AI clients through one hosted gateway URL.

## Important URLs

- Homepage: ${siteUrl("mcp")}
- MCP endpoint: ${MCP_ENDPOINT_URL}
- Documentation: ${siteUrl("docs")}
- Tools reference: ${canonicalUrl("/tools", "docs")}
- FAQ: ${canonicalUrl("/faq", "docs")}
- Blog: ${siteUrl("blog")}
- Sitemap: ${canonicalUrl("/sitemap.xml", "mcp")}

## Product Summary

- Category: Developer tool, automation, Model Context Protocol gateway
- Primary users: automation teams, n8n operators, AI agent builders
- Supported clients: Claude, ChatGPT, Cursor, Windsurf, VS Code, Zed and MCP-compatible clients
- Security: encrypted n8n API keys, per-user platform keys, SSRF-protected outbound requests
`;
}

function docsBody() {
  return `# n8n-mcp documentation

> Documentation for operating the hosted n8n MCP gateway.

## Documentation URLs

- Docs home: ${siteUrl("docs")}
- Getting started: ${canonicalUrl("/getting-started", "docs")}
- Security model: ${canonicalUrl("/security", "docs")}
- MCP tools reference: ${canonicalUrl("/tools", "docs")}
- FAQ: ${canonicalUrl("/faq", "docs")}
- MCP endpoint: ${MCP_ENDPOINT_URL}
`;
}

function blogBody() {
  const posts = getBlogPosts()
    .map((post) => `- ${post.title}: ${canonicalUrl(`/${post.slug}`, "blog")}`)
    .join("\n");

  return `# n8n-mcp blog

> GEO and product engineering notes for n8n MCP automation teams.

## Posts

${posts || "- Blog posts are being prepared."}
`;
}

export async function GET() {
  const surface = surfaceFromHost((await headers()).get("host"));
  const body =
    surface === "docs"
      ? docsBody()
      : surface === "blog"
        ? blogBody()
        : surface === "dashboard"
          ? "# n8n-mcp dashboard\n\nUser dashboard content is not intended for indexing.\n"
          : mcpBody();

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      ...(surface === "dashboard" ? { "X-Robots-Tag": "noindex,nofollow" } : {}),
    },
  });
}
