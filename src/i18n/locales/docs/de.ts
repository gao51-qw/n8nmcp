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
      clients: "MCP clients",
      apiKeys: "API keys",
      n8nInstances: "n8n instances",
      tools: "MCP tools reference",
      quotas: "Quotas and billing",
      security: "Security",
      admin: "Admin guide",
      selfHosting: "Self-hosting",
      troubleshooting: "Troubleshooting",
    },
    mobileTitle: "Browse docs",
  },
  index: {
    title: "German edition: n8n-mcp documentation",
    description:
      "German edition: Documentation for connecting n8n workflows to AI clients through a hosted MCP gateway, including setup, tools, quotas and security.",
    h1: "German edition: n8n-mcp documentation",
    lead: "German edition: n8n-mcp gives MCP-compatible AI clients a controlled gateway to your n8n workflows. These docs cover the hosted endpoint, platform API keys, encrypted n8n instances, workflow tools, quotas and security boundaries.",
    pickPrefix: "Start with ",
    pickLink: "Getting started",
    pickSuffix: ", then review the tool reference and security model before production use.",
    cards: [
      {
        to: "/docs/getting-started",
        title: "German edition: Getting started",
        desc: "German edition: Set up n8n-mcp by creating a platform API key, connecting an n8n instance and configuring an MCP client with the hosted endpoint.",
      },
      {
        to: "/docs/concepts",
        title: "German edition: Concepts",
        desc: "German edition: Core concepts for the hosted n8n MCP gateway: endpoint, platform API keys, encrypted n8n instances, tools and request routing.",
      },
      {
        to: "/docs/clients",
        title: "German edition: Connect a client",
        desc: "German edition: Configure Claude, ChatGPT custom connectors, Cursor, Windsurf, VS Code, Zed and other MCP clients with the n8n-mcp endpoint.",
      },
      {
        to: "/docs/api-keys",
        title: "German edition: Platform API keys",
        desc: "German edition: How to create, label, rotate, revoke and protect nmcp_ platform API keys used by MCP clients.",
      },
      {
        to: "/docs/n8n-instances",
        title: "German edition: n8n instances",
        desc: "German edition: Connect n8n instances to the MCP gateway with encrypted API keys, SSRF checks and safe connection testing.",
      },
      {
        to: "/docs/tools",
        title: "German edition: MCP tools reference",
        desc: "German edition: Reference for MCP tools that list, inspect, create, update, delete, validate, activate and execute n8n workflows.",
      },
      {
        to: "/docs/quotas",
        title: "German edition: Quotas and billing",
        desc: "German edition: How n8n-mcp counts MCP requests, enforces short-window rate limits and applies daily or plan-based quotas.",
      },
      {
        to: "/docs/security",
        title: "German edition: Security model",
        desc: "German edition: Security model for n8n-mcp, including credential encryption, SSRF protection, API key authentication, quotas and tenant boundaries.",
      },
    ],
  },
  gettingStarted: {
    title: "German edition: Getting started with n8n-mcp",
    description:
      "German edition: Set up n8n-mcp by creating a platform API key, connecting an n8n instance and configuring an MCP client with the hosted endpoint.",
    h1: "German edition: Getting started",
    body: '<p><strong>German edition.</strong></p>\n<p>This guide connects one MCP-compatible client to one n8n instance through n8n-mcp. The client talks to the hosted endpoint, while n8n credentials stay encrypted inside the gateway.</p>\n<h2>1. Create a platform API key</h2>\n<p>Open the dashboard, create a platform key and copy the <code>nmcp_...</code> token immediately. The full token is shown once; after that only its hash and display metadata are stored.</p>\n<h2>2. Connect an n8n instance</h2>\n<p>Add your n8n base URL and n8n API key in the dashboard. The API key is encrypted at rest and is only decrypted server-side when the gateway calls n8n.</p>\n<h2>3. Configure your MCP client</h2>\n<pre>{\n  "mcpServers": {\n    "n8n-mcp": {\n      "url": "https://mcp.n8nworkflow.com/mcp",\n      "headers": { "Authorization": "Bearer nmcp_..." }\n    }\n  }\n}</pre>\n<h2>4. Test a read-only tool first</h2>\n<p>Restart the client and ask it to list your n8n workflows. A successful setup should call <code>list_workflows</code> and return workflow names, IDs and active status.</p>',
  },
  concepts: {
    title: "German edition: n8n-mcp concepts",
    description:
      "German edition: Core concepts for the hosted n8n MCP gateway: endpoint, platform API keys, encrypted n8n instances, tools and request routing.",
    h1: "German edition: Concepts",
    body: "<p><strong>German edition.</strong></p>\n<p>n8n-mcp has four core concepts: a hosted MCP endpoint, platform API keys, registered n8n instances and MCP tools.</p>\n<h2>Hosted endpoint</h2>\n<p>The public MCP endpoint is <code>https://mcp.n8nworkflow.com/mcp</code>. It speaks Streamable HTTP and JSON-RPC for MCP clients. Use this path for all new client configurations.</p>\n<h2>Platform API keys</h2>\n<p>AI clients authenticate with <code>Authorization: Bearer nmcp_...</code>. These keys identify the n8n-mcp user account, not the n8n instance directly.</p>\n<h2>n8n instances</h2>\n<p>An instance stores a base URL and encrypted n8n API key. The gateway resolves the authenticated user, picks the right instance and calls n8n from the server.</p>\n<h2>Tool routing</h2>\n<p>Every request passes through authentication, short-window limiting, daily quota checks and usage recording before tool dispatch.</p>",
  },
  clients: {
    title: "German edition: Connect MCP clients to n8n-mcp",
    description:
      "German edition: Configure Claude, ChatGPT custom connectors, Cursor, Windsurf, VS Code, Zed and other MCP clients with the n8n-mcp endpoint.",
    h1: "German edition: Connect a client",
    body: '<p><strong>German edition.</strong></p>\n<p>Every MCP client uses the same endpoint and bearer token. Only the settings screen or config file differs.</p>\n<h2>Endpoint</h2>\n<p>Use <code>https://mcp.n8nworkflow.com/mcp</code> for all new clients.</p>\n<h2>Claude Desktop and Cursor style config</h2>\n<pre>{\n  "mcpServers": {\n    "n8n-mcp": {\n      "url": "https://mcp.n8nworkflow.com/mcp",\n      "headers": { "Authorization": "Bearer nmcp_..." }\n    }\n  }\n}</pre>\n<h2>Claude Code</h2>\n<pre>claude mcp add --transport http n8n-mcp https://mcp.n8nworkflow.com/mcp   --header "Authorization: Bearer nmcp_..."</pre>\n<h2>ChatGPT custom connector</h2>\n<p>Create a custom connector, set the URL to <code>https://mcp.n8nworkflow.com/mcp</code>, and add the bearer authorization header.</p>',
  },
  apiKeys: {
    title: "German edition: Platform API keys for n8n-mcp",
    description:
      "German edition: How to create, label, rotate, revoke and protect nmcp_ platform API keys used by MCP clients.",
    h1: "German edition: Platform API keys",
    body: "<p><strong>German edition.</strong></p>\n<p>Platform API keys authenticate MCP clients to n8n-mcp. They are separate from n8n API keys and should be treated like passwords.</p>\n<h2>Create a key</h2>\n<p>Create one key per client, device or workspace. Use labels such as <code>claude-desktop-prod</code> or <code>cursor-staging</code> so revocation is easy.</p>\n<h2>Storage model</h2>\n<p>The gateway stores a hash of the platform key, not the plaintext token. The full token is shown only once.</p>\n<h2>Rotation</h2>\n<p>Create a new key, update the client config, verify the client works, then revoke the old key.</p>",
  },
  n8nInstances: {
    title: "German edition: n8n instances in n8n-mcp",
    description:
      "German edition: Connect n8n instances to the MCP gateway with encrypted API keys, SSRF checks and safe connection testing.",
    h1: "German edition: n8n instances",
    body: "<p><strong>German edition.</strong></p>\n<p>An n8n instance is the server that workflow tools operate against. Each instance belongs to a user account and stores an n8n base URL plus encrypted API key.</p>\n<h2>Base URL</h2>\n<p>Use the public base URL for n8n, such as <code>https://n8n.example.com</code>. Do not use localhost or private network addresses.</p>\n<h2>Credential storage</h2>\n<p>The n8n API key is encrypted before storage. It is never sent to MCP clients.</p>\n<h2>SSRF guard</h2>\n<p>Before outbound requests, the gateway checks the resolved URL and blocks localhost, private ranges, link-local addresses and cloud metadata targets.</p>",
  },
  tools: {
    title: "German edition: n8n-mcp tools reference",
    description:
      "German edition: Reference for MCP tools that list, inspect, create, update, delete, validate, activate and execute n8n workflows.",
    h1: "German edition: MCP tools reference",
    body: "<p><strong>German edition.</strong></p>\n<p>n8n-mcp exposes workflow operations as MCP tools. The tools are designed for AI clients that need structured access to n8n without receiving direct n8n credentials.</p>\n<h2>Workflow read tools</h2>\n<ul><li><code>list_workflows</code>: list workflow IDs, names and active status.</li><li><code>get_workflow</code>: inspect nodes, connections and workflow metadata.</li><li><code>list_executions</code>: review recent execution history.</li></ul>\n<h2>Workflow write tools</h2>\n<ul><li><code>create_workflow</code>: create a workflow from nodes and connections.</li><li><code>update_workflow</code>: patch workflow structure or metadata.</li><li><code>delete_workflow</code>: delete a workflow by ID.</li><li><code>activate_workflow</code>: activate or deactivate a workflow.</li></ul>\n<h2>Validation and templates</h2>\n<p><code>validate_workflow</code> checks structure before changes go live. <code>import_workflow_template</code> imports templates from the knowledge layer when available.</p>",
  },
  quotas: {
    title: "German edition: n8n-mcp quotas and billing",
    description:
      "German edition: How n8n-mcp counts MCP requests, enforces short-window rate limits and applies daily or plan-based quotas.",
    h1: "German edition: Quotas and billing",
    body: "<p><strong>German edition.</strong></p>\n<p>n8n-mcp uses quotas to keep hosted MCP access predictable and safe.</p>\n<h2>What counts</h2>\n<p>Tool calls count toward usage. The gateway may keep initialization and tool-list operations separate from billable workflow operations depending on the active plan policy.</p>\n<h2>Short-window rate limiting</h2>\n<p>Short bursts are limited before expensive n8n calls run. Production deployments should use database-backed or external rate limiting rather than relying only on process memory.</p>\n<h2>Daily quota</h2>\n<p>Daily quota checks happen after authentication and before tool dispatch. When a quota is exhausted, the client receives a structured MCP error and HTTP 429.</p>",
  },
  security: {
    title: "German edition: n8n-mcp security model",
    description:
      "German edition: Security model for n8n-mcp, including credential encryption, SSRF protection, API key authentication, quotas and tenant boundaries.",
    h1: "German edition: Security model",
    body: "<p><strong>German edition.</strong></p>\n<p>The gateway is the trust boundary between AI clients and n8n. Its job is to keep credentials server-side and make outbound workflow operations auditable and constrained.</p>\n<h2>Credentials</h2>\n<p>Platform keys are hashed. n8n API keys are encrypted at rest and only decrypted server-side during proxied requests.</p>\n<h2>Network protection</h2>\n<p>All user-controlled outbound URLs must pass SSRF protection. This includes connection tests and tool execution paths.</p>\n<h2>Tenant boundary</h2>\n<p>Requests are tied to the authenticated platform key and user. The gateway must only resolve n8n instances owned by that user.</p>\n<h2>Vulnerability reporting</h2>\n<p>Email <code>server@n8nworkflow.com</code> with reproduction steps. Do not publish security reports in public issues.</p>",
  },
};

export default docs;
