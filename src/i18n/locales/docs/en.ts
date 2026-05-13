const docs = {
  nav: {
    sections: {
      introduction: "Introduction",
      connectClient: "Connect a client",
      configuration: "Configuration",
      operations: "Operations",
    },
    items: {
      overview: "Overview",
      gettingStarted: "Getting started",
      concepts: "Concepts",
      clients: "All MCP clients",
      apiKeys: "API keys",
      n8nInstances: "n8n instances",
      tools: "MCP tools reference",
      quotas: "Quotas & billing",
      security: "Security",
      admin: "Admin guide",
      selfHosting: "Self-hosting",
      troubleshooting: "Troubleshooting",
    },
    mobileTitle: "Browse docs",
  },
  index: {
    title: "Documentation — n8n-mcp",
    description:
      "Complete operations manual for n8n-mcp: connect AI clients to n8n via the Model Context Protocol, manage API keys, n8n instances, quotas, security and admin tasks.",
    h1: "Documentation",
    lead: "n8n-mcp is a hosted Model Context Protocol gateway in front of your n8n instance. Any MCP-capable client can list and call your workflows as typed tools, and use the bundled knowledge base of ~1,650 n8n nodes to author new ones.",
    pickPrefix: "Pick a topic below, or jump straight to ",
    pickLink: "Getting started",
    pickSuffix: ".",
    cards: [
      { to: "/docs/getting-started", title: "Getting started", desc: "Sign up, mint a key, connect your first client in 5 minutes." },
      { to: "/docs/concepts", title: "Concepts", desc: "How the MCP gateway, API keys and n8n instances fit together." },
      { to: "/docs/clients", title: "Connect a client", desc: "Config snippets for Claude, ChatGPT, Cursor, VS Code and more." },
      { to: "/docs/api-keys", title: "API keys", desc: "Create, rotate and revoke platform tokens." },
      { to: "/docs/n8n-instances", title: "n8n instances", desc: "Add your self-hosted or cloud n8n with encrypted credentials." },
      { to: "/docs/tools", title: "MCP tools reference", desc: "All runtime, knowledge and management tools the gateway exposes." },
      { to: "/docs/quotas", title: "Quotas & billing", desc: "Tier limits, usage tracking and upgrades." },
      { to: "/docs/security", title: "Security", desc: "Encryption at rest, SSRF protections, RLS and audit." },
    ],
  },
  gettingStarted: {
    title: "Getting started — n8n-mcp docs",
    description: "Sign up, create a platform API key, connect your n8n instance and wire up your first MCP client in under five minutes.",
    h1: "Getting started",
    body: `<p>This walkthrough takes about five minutes. You will end with Claude (or any other MCP client) able to list and execute workflows on your own n8n instance.</p>
<h2>1. Create an account</h2>
<p>Sign up at <a href="/signup">/signup</a> with email + password or Google. New accounts start on the <strong>Free</strong> tier (100 MCP calls/day, 1 n8n instance).</p>
<h2>2. Mint a platform API key</h2>
<ol>
<li>Open <a href="/api-keys">API Keys</a> in the dashboard.</li>
<li>Click <strong>New key</strong>, give it a label (e.g. <code>claude-laptop</code>).</li>
<li>Copy the <code>nmcp_…</code> token immediately — it is shown only once.</li>
</ol>
<p>Treat the token like a password. Anyone holding it can call your gateway under your account&rsquo;s quota.</p>
<h2>3. Connect an n8n instance</h2>
<ol>
<li>Open <a href="/instances">n8n Instances</a> → <strong>Add</strong>.</li>
<li>Paste your n8n base URL (e.g. <code>https://n8n.example.com</code>).</li>
<li>Generate an n8n API key in your n8n UI under <em>Settings → n8n API</em> and paste it.</li>
<li>We encrypt the key with AES-256-GCM before it touches the database.</li>
</ol>
<h2>4. Wire up your MCP client</h2>
<p>Point any MCP client at the gateway URL with your token as a bearer header:</p>
<pre>{
  "mcpServers": {
    "n8n-mcp": {
      "url": "https://n8nmcp.lovable.app/api/public/mcp",
      "headers": { "Authorization": "Bearer nmcp_..." }
    }
  }
}</pre>
<p>See <a href="/docs/clients">Connect a client</a> for per-client snippets.</p>
<h2>5. Try it</h2>
<p>Restart your client. Ask: <em>&ldquo;List my n8n workflows.&rdquo;</em> The client should invoke <code>list_workflows</code> against your instance and return the response.</p>
<h2>What&rsquo;s next?</h2>
<ul>
<li><a href="/docs/tools">Browse the full tool catalog</a></li>
<li><a href="/docs/quotas">Understand quotas and how to upgrade</a></li>
<li><a href="/docs/security">Read the security model</a></li>
</ul>`,
  },
  concepts: {
    title: "Concepts — n8n-mcp docs",
    description: "How the n8n-mcp gateway, platform API keys, n8n instances and MCP tools fit together.",
    h1: "Concepts",
    body: `<p>Three primitives are enough to understand the entire system.</p>
<h2>The gateway</h2>
<p>A multi-tenant HTTPS endpoint at <code>/api/public/mcp</code> that speaks the Model Context Protocol over Streamable HTTP. It authenticates the caller with a platform API key, looks up which n8n instance to forward to, and translates each MCP tool call into the appropriate n8n REST request.</p>
<h2>Platform API keys</h2>
<p>Tokens prefixed with <code>nmcp_</code> that identify <em>your account</em> to the gateway. They are sent as <code>Authorization: Bearer …</code> by your MCP client. Multiple keys per account are supported — mint one per device or workspace so you can revoke them independently.</p>
<h2>n8n instances</h2>
<p>A pair of <code>(base URL, n8n API key)</code> stored on your account. The n8n API key is encrypted at rest with AES-256-GCM. The Free tier allows one instance; paid tiers raise the limit. The gateway never exposes the n8n key back to clients.</p>
<h2>Tool routing</h2>
<p>When your client calls a tool, the gateway:</p>
<ol>
<li>Validates the bearer token and resolves the owning account.</li>
<li>Checks daily quota; rejects with <code>429</code> if exhausted.</li>
<li>For runtime tools (<code>list_workflows</code>, <code>execute_workflow</code>, …), decrypts the n8n key in memory and proxies the call.</li>
<li>For knowledge tools (<code>search_nodes</code>, <code>get_node_essentials</code>, …), serves results from the bundled SQLite knowledge base — no n8n call needed.</li>
<li>Records usage for the dashboard and billing.</li>
</ol>
<h2>Why a gateway?</h2>
<ul>
<li>Your n8n API key never leaves the server.</li>
<li>Stable URL even if you redeploy n8n.</li>
<li>Per-tool quotas and observability across all clients.</li>
<li>Built-in knowledge of ~1,650 n8n nodes for AI authoring.</li>
</ul>`,
  },
  clients: {
    title: "Connect any MCP client — n8n-mcp docs",
    description: "Configuration snippets for Claude Desktop, Claude Code, ChatGPT, Cursor, Windsurf, VS Code, Continue, Cline, Zed, Gemini CLI and Codex CLI.",
    h1: "Connect a client",
    body: `<p>Every MCP-compatible client uses the same gateway URL and the same bearer token. Only the config file location changes.</p>
<p>Endpoint: <code>https://n8nmcp.lovable.app/api/public/mcp</code></p>
<h2 id="claude-desktop">Claude Desktop</h2>
<p>Edit <code>~/Library/Application Support/Claude/claude_desktop_config.json</code> on macOS or <code>%APPDATA%\\Claude\\claude_desktop_config.json</code> on Windows:</p>
<pre>{
  "mcpServers": {
    "n8n-mcp": {
      "url": "https://n8nmcp.lovable.app/api/public/mcp",
      "headers": { "Authorization": "Bearer nmcp_..." }
    }
  }
}</pre>
<p>Quit and reopen Claude. The hammer icon should show n8n-mcp tools.</p>
<h2 id="claude-code">Claude Code</h2>
<pre>claude mcp add --transport http n8n-mcp https://n8nmcp.lovable.app/api/public/mcp \\
  --header "Authorization: Bearer nmcp_..."</pre>
<h2 id="chatgpt">ChatGPT (custom connectors)</h2>
<p>In ChatGPT settings → Connectors → <strong>Add custom connector</strong>:</p>
<ul>
<li>URL: <code>https://n8nmcp.lovable.app/api/public/mcp</code></li>
<li>Auth header: <code>Authorization: Bearer nmcp_...</code></li>
</ul>
<h2 id="cursor">Cursor</h2>
<p>Cursor settings → MCP → <strong>Add new MCP server</strong>, paste the same JSON block as Claude Desktop.</p>
<h2 id="windsurf">Windsurf</h2>
<p>Settings → MCP servers → edit <code>mcp_config.json</code> with the standard <code>mcpServers</code> block above.</p>
<h2 id="vscode">VS Code (Copilot Chat) &amp; Continue</h2>
<p>Both expose an MCP servers list in their settings UI. Use the gateway URL with the bearer header.</p>
<h2 id="zed">Zed</h2>
<pre>// ~/.config/zed/settings.json
{
  "context_servers": {
    "n8n-mcp": {
      "command": { "transport": "http", "url": "https://n8nmcp.lovable.app/api/public/mcp",
        "headers": { "Authorization": "Bearer nmcp_..." } }
    }
  }
}</pre>
<h2 id="gemini-cli">Gemini CLI / Codex CLI / LM Studio</h2>
<p>All three use a JSON config with the same URL + header pair. Refer to each tool&rsquo;s MCP docs for the exact filename.</p>
<h2 id="verifying">Verifying the connection</h2>
<p>Once configured, ask: <em>&ldquo;What n8n tools do you have?&rdquo;</em> The client should list <code>list_workflows</code>, <code>execute_workflow</code>, knowledge tools and any management tools you have access to.</p>`,
  },
  apiKeys: {
    title: "Platform API keys — n8n-mcp docs",
    description: "Create, label, rotate and revoke nmcp_ platform API keys used by your MCP clients.",
    h1: "Platform API keys",
    body: `<p>Platform API keys (prefix <code>nmcp_</code>) authenticate your MCP client to the gateway. They are <em>not</em> your n8n API key — that one stays server-side.</p>
<h2>Create a key</h2>
<ol>
<li>Open <a href="/api-keys">API Keys</a>.</li>
<li>Click <strong>New key</strong> and give it a label (e.g. <code>cursor-work</code>).</li>
<li>Copy the displayed token immediately. After you close the dialog, only the prefix and a hash remain in our database.</li>
</ol>
<h2>Best practices</h2>
<ul>
<li>One key per device or workspace, so you can revoke them individually.</li>
<li>Never commit keys to git or share them in chat. Treat them like passwords.</li>
<li>Rotate keys quarterly or when a teammate leaves.</li>
</ul>
<h2>Rotate a key</h2>
<p>We do not currently support in-place rotation. Mint a new key, update the client config, then revoke the old key from the same page.</p>
<h2>Revoke a key</h2>
<p>Click the trash icon next to the key. Revocation is immediate — the next call from a client using that token will return <code>401</code>.</p>
<h2>Quotas</h2>
<p>Quota is per-account, not per-key. Splitting keys does not multiply your daily limit. See <a href="/docs/quotas">Quotas &amp; billing</a>.</p>`,
  },
  n8nInstances: {
    title: "n8n instances — n8n-mcp docs",
    description: "Connect your self-hosted or n8n.cloud instance, store API keys encrypted, and protect against SSRF.",
    h1: "n8n instances",
    body: `<p>An <strong>instance</strong> is a single n8n deployment the gateway can talk to. You can register one (n8n.cloud) or many (per-environment self-hosted).</p>
<h2 id="add">Add an instance</h2>
<ol>
<li>Open <code>Dashboard → n8n instances → New instance</code>.</li>
<li>Give it a label (e.g. <code>prod</code>, <code>staging</code>).</li>
<li>Paste the <strong>base URL</strong> of your n8n (no trailing <code>/rest</code>). Examples: <code>https://n8n.example.com</code>, <code>https://your-tenant.app.n8n.cloud</code>.</li>
<li>Paste an <strong>n8n API key</strong> created from <code>n8n → Settings → n8n API → Create API key</code>.</li>
</ol>
<h2 id="encryption">How keys are stored</h2>
<p>n8n API keys are encrypted at rest with a server-side key. They are decrypted in-memory only when the gateway proxies a request, and never returned to clients after the initial save.</p>
<h2 id="ssrf">SSRF protection</h2>
<p>The gateway runs <code>assertPublicUrl()</code> on every instance URL before any outbound request. URLs that resolve to private/loopback ranges (<code>127.0.0.0/8</code>, <code>10.0.0.0/8</code>, <code>172.16.0.0/12</code>, <code>192.168.0.0/16</code>, IPv6 link-local, etc.) are rejected. If you self-host n8n on a private network, expose it through a public hostname or reverse proxy.</p>
<h2 id="health">Health checks</h2>
<p>Each instance row shows the last successful contact and the most recent error. Click <strong>Test connection</strong> to re-run <code>GET /rest/login</code> without changing anything.</p>
<h2 id="multiple">Targeting a specific instance</h2>
<p>When more than one instance is registered, MCP tool calls accept an <code>instance</code> parameter (the label). Without it, the workspace default instance is used.</p>
<h2 id="rotate">Rotating an n8n key</h2>
<p>Generate a new key in n8n, paste it on the instance row, and save. The previous ciphertext is overwritten immediately.</p>`,
  },
  tools: {
    title: "MCP tools reference — n8n-mcp docs",
    description: "Complete reference of runtime, knowledge and management tools exposed by the n8n-mcp gateway.",
    h1: "MCP tools reference",
    body: `<p>Tools are grouped into three categories. All tools accept an optional <code>instance</code> argument to target a specific n8n instance.</p>
<h2 id="runtime">Runtime tools</h2>
<p>Direct interactions with workflows and executions on your n8n.</p>
<table>
<thead><tr><th>Tool</th><th>Description</th></tr></thead>
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
<p>Read-only lookups against the embedded n8n node catalog. They run against local data and do not call your n8n.</p>
<table>
<thead><tr><th>Tool</th><th>Description</th></tr></thead>
<tbody>
<tr><td><code>search_nodes</code></td><td>Full-text search across n8n core and community nodes.</td></tr>
<tr><td><code>get_node_info</code></td><td>Return parameters, credentials and operations for a node.</td></tr>
<tr><td><code>list_node_categories</code></td><td>Browse nodes grouped by category (AI, Data, Comms…).</td></tr>
<tr><td><code>get_node_examples</code></td><td>Return canonical example workflows for a given node.</td></tr>
</tbody>
</table>
<h2 id="management">Management tools</h2>
<p>Administrative operations against the n8n REST API. Only available to keys with the <code>management</code> scope.</p>
<table>
<thead><tr><th>Tool</th><th>Description</th></tr></thead>
<tbody>
<tr><td><code>list_credentials</code></td><td>List credentials (without secret values).</td></tr>
<tr><td><code>list_users</code></td><td>List users on your n8n instance.</td></tr>
<tr><td><code>list_projects</code></td><td>List n8n projects (Enterprise).</td></tr>
<tr><td><code>list_tags</code></td><td>List workflow tags.</td></tr>
<tr><td><code>get_audit</code></td><td>Run an n8n audit and return the security report.</td></tr>
</tbody>
</table>
<h2 id="errors">Error semantics</h2>
<p>Tool errors are returned as MCP <code>isError: true</code> results with a sanitized message. The gateway never forwards raw n8n stack traces to the client.</p>`,
  },
  quotas: {
    title: "Quotas & billing — n8n-mcp docs",
    description: "Per-key request quotas, plan limits, and how usage is metered across MCP tool calls.",
    h1: "Quotas & billing",
    body: `<p>The gateway meters usage per platform API key. Each MCP tool call counts as one request, regardless of payload size.</p>
<h2 id="plans">Plan limits</h2>
<table>
<thead><tr><th>Plan</th><th>Requests / month</th><th>n8n instances</th><th>API keys</th></tr></thead>
<tbody>
<tr><td>Free</td><td>1,000</td><td>1</td><td>2</td></tr>
<tr><td>Pro</td><td>50,000</td><td>5</td><td>20</td></tr>
<tr><td>Team</td><td>250,000</td><td>Unlimited</td><td>Unlimited</td></tr>
</tbody>
</table>
<p>Self-hosted deployments have no enforced quota; the same counters are recorded for observability.</p>
<h2 id="counting">What counts as a request</h2>
<ul>
<li>Each MCP <code>tools/call</code> = 1 request.</li>
<li><code>tools/list</code> and <code>initialize</code> handshakes are free.</li>
<li>Failed calls (4xx returned by the gateway) still count.</li>
<li>Retries triggered by the client count separately.</li>
</ul>
<h2 id="windows">Reset window</h2>
<p>Counters reset on the first day of each calendar month at <code>00:00 UTC</code>. The current usage is visible in the dashboard header and on each API key row.</p>
<h2 id="overages">When the quota is exceeded</h2>
<p>Calls return MCP error <code>QUOTA_EXCEEDED</code> with HTTP <code>429</code>. The gateway adds a <code>Retry-After</code> header pointing to the next reset.</p>
<h2 id="upgrading">Upgrading</h2>
<p>Open <code>Dashboard → Billing</code> to change plan. The new quota becomes effective immediately and is prorated for the current billing period.</p>`,
  },
  security: {
    title: "Security — n8n-mcp docs",
    description: "Encryption at rest, SSRF protection, RLS policies, and the gateway's threat model.",
    h1: "Security",
    body: `<p>The gateway brokers MCP traffic between AI clients and your n8n. It is designed so that a compromised platform key cannot reach private networks, exfiltrate other tenants&rsquo; data, or escalate to admin.</p>
<h2 id="key-storage">Credential storage</h2>
<ul>
<li><strong>Platform API keys</strong> (<code>nmcp_…</code>) are hashed with SHA-256 before storage. Only a <code>last4</code> hint is kept for display.</li>
<li><strong>n8n API keys</strong> are encrypted at rest with a server-side key (AES-GCM). Plaintext only exists in memory during a proxied request.</li>
<li>Service-role database access is server-only; the browser never sees it.</li>
</ul>
<h2 id="ssrf">SSRF guard</h2>
<p>Every user-controlled URL the server resolves passes through <code>assertPublicUrl()</code>. It rejects:</p>
<ul>
<li>Loopback addresses (<code>127.0.0.0/8</code>, <code>::1</code>).</li>
<li>RFC1918 private ranges and link-local IPv4/IPv6.</li>
<li>Cloud metadata endpoints (<code>169.254.169.254</code>, GCP/Azure equivalents).</li>
<li>Non-<code>http(s)</code> schemes (<code>file:</code>, <code>gopher:</code>…).</li>
<li>DNS rebinding — names are resolved and the resolved IP is re-checked.</li>
</ul>
<h2 id="rls">Row-level security</h2>
<p>Tenant data (workspaces, API keys, n8n instances, audit logs) is protected by Postgres RLS scoped to <code>auth.uid()</code>. Admin tables (roles, audit, secrets) are explicitly excluded from the realtime publication.</p>
<h2 id="roles">Roles &amp; admin</h2>
<p>Roles live in a dedicated <code>user_roles</code> table and are checked via the <code>has_role()</code> security-definer function. Admin role is never derived from client storage.</p>
<h2 id="errors">Error sanitization</h2>
<p>Server functions catch upstream errors and return generic, user-safe messages. Stack traces and edge-runtime exceptions are logged server-side only.</p>
<h2 id="reporting">Reporting a vulnerability</h2>
<p>Email <code>security@n8nmcp.lovable.app</code> with reproduction steps. Please do not open public issues for security reports.</p>`,
  },
};

export default docs;