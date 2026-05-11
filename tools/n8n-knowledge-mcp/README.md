# n8n-knowledge-mcp

Self-built MCP server exposing n8n node knowledge (official + community npm packages) over Streamable HTTP. Replacement for `czlonkowski/n8n-mcp`.

## Architecture

```
npm packages → ts-morph parse → SQLite + FTS5 → MCP HTTP server
```

- **Build time** (CI weekly): pull npm tarballs of `n8n-nodes-base`, `@n8n/n8n-nodes-langchain`, and ~200 vetted community `n8n-nodes-*` packages → AST-extract node descriptions → build `data/nodes.db`.
- **Run time** (VPS Docker): Express + `@modelcontextprotocol/sdk` Streamable HTTP, Bearer auth, 22 knowledge tools backed by `better-sqlite3`.

## Quick start

```bash
pnpm i
pnpm build:db        # 5-10 min, pulls npm packages, fills data/nodes.db
AUTH_TOKEN=$(openssl rand -hex 32) pnpm dev
curl -H "Authorization: Bearer $AUTH_TOKEN" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
     http://localhost:3000/mcp | jq
```

## Deploy

Pull the prebuilt image (CI publishes weekly):

```bash
docker run -d --name n8n-mcp \
  -p 127.0.0.1:3000:3000 \
  -e AUTH_TOKEN=$AUTH_TOKEN \
  ghcr.io/<you>/n8n-knowledge-mcp:latest
```

Point your nginx (e.g. `mcp.n8nworkflow.com`) at `127.0.0.1:3000` (`proxy_buffering off`, `proxy_read_timeout 3600s` for SSE).

## Tools (22, aligned with czlonkowski/n8n-mcp)

Discovery: `list_nodes`, `search_nodes`, `list_ai_tools`, `search_node_properties`
Info: `get_node_info`, `get_node_essentials`, `get_node_documentation`, `get_node_as_tool_info`, `get_property_dependencies`
Tasks: `list_tasks`, `get_node_for_task`
Templates: `list_node_templates`, `search_workflow_templates`, `search_templates`, `get_workflow_template`, `get_template`, `list_template_categories`, `get_templates_for_task`
Validation: `validate_node_minimal`, `validate_node_operation`, `validate_workflow`, `validate_workflow_connections`, `validate_workflow_expressions`
Meta: `tools_documentation`, `n8n_diagnostic`

## Loading workflow templates (8000+ JSONs)

The `templates` table is empty until you ingest your local template folder.
Each input file should match the n8n.io export envelope:
`{ workflow: { id, name, description, workflow: { nodes, connections, ... }, user, workflowInfo, ... } }`.

```bash
# 1) Build the nodes DB first (creates the templates table schema)
npm run build:db

# 2) Point at your local folder and ingest. Streams files; safe for 8000+ / 900MB.
TEMPLATES_DIR=/abs/path/to/templates npm run build:templates
```

The result `data/nodes.db` (~800MB unbundled) ships inside the Docker image.

The gateway's local tool `import_workflow_template` (in `src/lib/mcp.server.ts`)
calls `get_workflow_template` against this knowledge base, then POSTs the
workflow into the user's own n8n via `/api/v1/workflows`.
