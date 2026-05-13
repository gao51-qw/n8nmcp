import { createFileRoute } from "@tanstack/react-router";

const SITE = "https://n8nmcp.lovable.app";

// Long-form, plain-text knowledge dump for LLM ingestion. Curated rather than
// auto-extracted from JSX so that the wording is precise and the output stays
// well under the typical 200KB soft-limit consumers expect for llms-full.txt.
const BODY = `# n8n-mcp — full documentation

Source: ${SITE}
License: documentation may be redistributed with attribution.

================================================================================
## What is n8n-mcp

n8n-mcp is a hosted Model Context Protocol (MCP) gateway in front of your
self-hosted n8n instance. AI clients (Claude Desktop, Claude Code, ChatGPT,
Cursor, Windsurf, VS Code, Zed, Gemini CLI, Codex CLI, LM Studio, Continue,
Cline) connect to a stable per-user MCP URL using a platform API key. The
gateway authenticates the user, enforces quotas, and forwards tool calls to
the user's n8n REST API using credentials that never leave server memory.

Key properties:
- Stable URL per user, even after rotating n8n API keys.
- AES-256-GCM encrypted n8n API keys at rest in Postgres.
- Per-user quotas, audit log, and usage analytics.
- SSRF guard on every n8n instance URL — only public hostnames allowed.
- No vendor lock-in: every wire format is the official MCP spec.

================================================================================
## Getting started

1. Sign up at ${SITE}/signup with email + password or Google.
2. Open Dashboard → Instances and add your n8n instance:
   - Base URL, e.g. https://n8n.example.com
   - n8n API key (Settings → API in n8n)
3. Open Dashboard → API keys, click "Create key", copy the \`nmcp_...\` token.
4. Open Dashboard → Connect for ready-to-paste config snippets per client.
5. Restart your AI client. The MCP server should appear with all n8n tools.

The Free tier gives you 1 instance and 100 MCP calls/day. The Supporter tier
($19/mo) raises this to 50,000 calls/month and 5 instances.

================================================================================
## Concepts

- **MCP URL**: the stable HTTPS endpoint your AI client calls
  (\`${SITE}/api/public/mcp\`). Authentication uses
  \`Authorization: Bearer nmcp_<your-key>\`.
- **Platform API key**: identifies you to the gateway. Format \`nmcp_<32 chars>\`.
  Stored as SHA-256 hash; the plaintext is shown once at creation.
- **n8n instance**: the URL + n8n API key the gateway forwards tool calls to.
  Each user can register multiple instances; tool calls pick one explicitly or
  the default.
- **Tools**: MCP "tools" map 1:1 onto operations against n8n
  (list/get/execute workflows, search node knowledge, manage credentials,
  read audit logs).
- **Quotas**: MCP requests are counted per UTC day for Free, per calendar
  month for paid tiers. Failed auth and rate-limited requests don't count.

================================================================================
## Connect a client

### Claude Desktop / Claude Code

Add to \`claude_desktop_config.json\`:
\`\`\`json
{
  "mcpServers": {
    "n8n": {
      "type": "http",
      "url": "${SITE}/api/public/mcp",
      "headers": { "Authorization": "Bearer nmcp_YOUR_KEY" }
    }
  }
}
\`\`\`

### ChatGPT (custom GPT, MCP connector)

In the GPT builder, add an MCP connector with:
- URL: \`${SITE}/api/public/mcp\`
- Auth: Bearer token \`nmcp_YOUR_KEY\`

### Cursor / Windsurf / VS Code (Continue, Cline) / Zed

All accept the same JSON shape as Claude Desktop. Paste the snippet from
Dashboard → Connect into the IDE's MCP settings file.

================================================================================
## API keys

- Created from Dashboard → API keys.
- Format: \`nmcp_\` + 32 url-safe base64 characters.
- Stored as SHA-256 hash; full token shown once at creation.
- Rotating: create a new key, swap it into the client, then revoke the old key.
- Revoking is instant and irreversible. In-flight requests using the revoked
  key will receive 401 on their next call.

================================================================================
## n8n instances

- Add via Dashboard → Instances. Provide:
  - Base URL (HTTPS public hostname).
  - n8n API key (n8n → Settings → API).
- The URL is validated against an SSRF guard: private/loopback/link-local
  ranges, localhost, .local, and metadata IPs (169.254.169.254) are rejected.
- API key is encrypted with AES-256-GCM using a project-level master key.
  Decryption happens only when the gateway forwards a request.
- Instances can be edited or removed at any time. Deleting an instance
  immediately invalidates outstanding tool routing to it.

================================================================================
## MCP tools reference

### Runtime tools (operate on workflows)
- \`list_workflows\` — list all workflows in the user's n8n instance.
- \`get_workflow\` — fetch a workflow definition by ID.
- \`execute_workflow\` — run a workflow manually with optional input JSON.
- \`list_executions\` — recent executions with status filter.
- \`get_execution\` — full execution detail incl. node-level data.

### Knowledge tools (n8n node catalog)
- \`search_nodes\` — full-text + semantic search over 500+ n8n nodes.
- \`get_node_info\` — schema, parameters, examples for a node.
- \`list_node_categories\` — discover nodes by category.
- \`search_templates\` — community workflow templates relevant to a query.

### Management tools (admin)
- \`list_credentials\` — credential names + types (no secret values).
- \`list_users\` — n8n users (admin only).
- \`get_audit\` — n8n audit log entries.

Errors: 401 = bad / revoked key, 403 = quota exceeded, 404 = wrong workflow
ID, 502 = n8n instance unreachable. Error bodies are sanitized; raw n8n
stack traces are never returned to the client.

================================================================================
## Quotas & billing

| Plan       | MCP calls       | Instances | Window           |
|------------|-----------------|-----------|------------------|
| Free       | 100 / day       | 1         | UTC day          |
| Supporter  | 50,000 / month  | 5         | Calendar month   |
| Team       | Unlimited       | Unlimited | -                |

- Failed auth and rate-limited requests are not counted.
- Quota resets are observable via the \`X-RateLimit-Reset\` response header.
- Upgrades take effect immediately; downgrades at next renewal.
- Billing handled via Paddle (cards, PayPal, regional methods).

================================================================================
## Security

- **Auth**: platform API keys SHA-256 hashed (no plaintext in DB). n8n API
  keys AES-256-GCM encrypted with a project master key.
- **SSRF guard**: every user-provided URL passed to the gateway is validated
  against an allowlist of public hostnames before any fetch().
- **RLS**: every table is RLS-enabled; users can only read their own rows.
- **Roles**: admin/moderator/user roles stored in a separate \`user_roles\`
  table with \`SECURITY DEFINER\` \`has_role()\` to avoid recursive policies.
- **Error sanitization**: server-side exceptions are logged but never
  returned verbatim to clients.
- **Disclosure**: report vulnerabilities to security@n8nworkflow.com.

================================================================================
## Self-hosting (optional)

The gateway and the n8n knowledge MCP server are containerized. Deploy with
the Docker Compose file in the repo, behind Nginx with TLS via certbot. See
the in-app docs for the production-ready Nginx + compose stack.

================================================================================
## Links

- Pricing: ${SITE}/pricing
- FAQ: ${SITE}/faq
- Blog: ${SITE}/blog
- Sitemap: ${SITE}/sitemap.xml
- llms.txt index: ${SITE}/llms.txt
`;

export const Route = createFileRoute("/llms-full.txt")({
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