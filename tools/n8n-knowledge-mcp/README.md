# n8n-knowledge-mcp

Self-built MCP server exposing n8n node knowledge over Streamable HTTP.

Official node knowledge is sourced from published n8n packages. Community registry packages remain optional enrichment.

## Architecture

```txt
published n8n packages + optional community packages
  -> package metadata and source excerpts
  -> SQLite + FTS5
  -> MCP HTTP server
```

Official n8n packages are parsed from their published `dist/known/nodes.json` and
`dist/types/nodes.json` metadata without executing node JavaScript. Source excerpts
are read only after real-path containment inside the unpacked package root. The
generic community-enrichment path remains optional and may dynamically import
community node modules; production `build:knowledge` never selects that path.

- Run time: Express + `@modelcontextprotocol/sdk` Streamable HTTP, Bearer auth, knowledge tools backed by `better-sqlite3`.

## Quick Start

```bash
npm install
npm run build:db
AUTH_TOKEN=$(openssl rand -hex 32) npm run dev
curl -H "Authorization: Bearer $AUTH_TOKEN" \
     -H "Content-Type: application/json" \
     -H "Accept: application/json, text/event-stream" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' \
     http://localhost:3000/mcp
```

Production builds use `npm run build:knowledge`, which selects the official-only node build. Use `npm run build:nodes` when optional community enrichment is desired. The environment selector remains compatible for an official-only fetch:

```bash
N8N_KNOWLEDGE_SKIP_COMMUNITY=1 npm run fetch
npm run parse:nodes
npm run parse:docs
npm run build:sqlite
npm run emit:stats
```

## Official Registry Count — 2026-06-10 Generated Snapshot

The following values are the generated 2026-06-10 snapshot of the GitHub `package.json -> n8n.nodes` registry:

```txt
n8n-nodes-base: 439
@n8n/n8n-nodes-langchain: 122
total official nodes: 561
```

For current verified values, rebuild and verify the knowledge artifact, then read `data/stats.json` (or the authenticated `/health` inventory) rather than relying on this historical label.

Do not use `.node.ts` file count as the production recommendation count. Some files are version implementations or internal helpers and are not registered as loadable nodes.

## Tools

Discovery: `list_nodes`, `search_nodes`, `list_ai_tools`, `search_node_properties`

Info: `get_node_info`, `get_node_essentials`, `get_node_documentation`, `get_node_as_tool_info`, `get_property_dependencies`

Tasks: `list_tasks`, `get_node_for_task`

Templates: `list_node_templates`, `search_workflow_templates`, `search_templates`, `get_workflow_template`, `get_template`, `list_template_categories`, `get_templates_for_task`

Validation: `validate_node_minimal`, `validate_node_operation`, `validate_workflow`, `validate_workflow_connections`, `validate_workflow_expressions`

Meta: `tools_documentation`, `n8n_diagnostic`

External discovery: `list_external_node_candidates`, `search_external_node_candidates`, `get_external_node_candidate`

Verified external discovery: `list_verified_external_nodes`, `search_verified_external_nodes`, `get_verified_external_node`

External node candidates are imported into `external_node_candidates`, not into the official `nodes` table. `verified_external_nodes` contains only candidates that passed this project's local static metadata checks. This validation is intentionally fast: it does not install npm packages, execute node code, make network calls, or prove package safety/runtime compatibility.

## Importing External Candidate Nodes

If `czlonkowski/n8n-mcp` has been unpacked at `../../n8n-mcp-main`, import its node metadata as a candidate pool:

```bash
npm run build:sqlite
npm run import:external-candidates
npm run verify:external-nodes
npm run emit:stats
```

Or rebuild everything in one step:

```bash
npm run build:db:with-external
```

Current local candidate import:

```txt
external candidates: 1296
community candidates: 1029
verified community candidates: 911
AI tool variant candidates: 267
locally verified external nodes: 1296
locally verified community nodes: 1029
locally verified tool variant nodes: 267
```

## Loading Workflow Templates

### Official source, limits, and curated fallback

The production refresh reads only these official API endpoints:

- `GET https://api.n8n.io/api/templates/search?rows=100&page=<page>&sort=views%3Adesc`
- `GET https://api.n8n.io/workflows/templates/<id>`

The fetcher deduplicates IDs, stages no more than 5,000 official candidates, and sorts accepted templates by numeric ID before the deterministic official/curated merge. The merged database is capped at 5,000 templates. The official quality gate requires at least 95% of `min(totalWorkflows, 5000)` to be accepted. Therefore, when the API advertises at least 5,000 workflows, both the accepted-official count and final database count must be at least 4,750. All curated IDs must also be present, and the `templates` and `templates_fts` tables must have identical IDs and row counts.

The reviewed offline fallback is defined by `data/curated-templates/manifest.json` and currently contains IDs `1750`, `2327`, `5171`, `584`, `1954`, `2397`, `2089`, `2732`, `2462`, `2859`, `3986`, and `1747`. Refresh these sanitized snapshots deliberately from the official API with:

```bash
npm run refresh:curated
```

External candidate nodes are unrelated to this template refresh. They remain opt-in through `npm run build:db:with-external` and are stored in `external_node_candidates` and `verified_external_nodes`; they are never merged into the official `nodes` table or treated as workflow templates.

### Staging and network-free import

`npm run fetch:templates` publishes a complete staging generation atomically under `.tmp/templates/`:

- `official/` contains accepted, normalized official templates.
- `merged/` contains the deterministic ID-sorted official/curated merge consumed by the importer.
- `official-manifest.json` records the advertised total, target, detail failures, and accepted/rejected counts.

Fetch and sanitization are the network boundary. `npm run build:templates` is network-free: it reads only normalized JSON from `.tmp/templates/merged`, replaces the SQLite `templates` and `templates_fts` rows in one transaction, and never executes workflow nodes, expressions, or downloaded code. To import a separately prepared local folder, set `TEMPLATES_DIR`:

```json
{
  "source": "curated",
  "curated": true,
  "views": 0,
  "sourceUrl": "https://example.invalid/custom-template/900001",
  "workflow": {
    "id": 900001,
    "name": "Template name",
    "description": "A locally reviewed workflow template.",
    "totalViews": 0,
    "createdAt": null,
    "user": null,
    "workflow": {
      "nodes": [
        {
          "id": "manual-trigger-1",
          "name": "Start",
          "type": "n8n-nodes-base.manualTrigger",
          "parameters": {},
          "position": [0, 0]
        }
      ],
      "connections": {}
    }
  }
}
```

```bash
npm run build:db
TEMPLATES_DIR=/abs/path/to/templates npm run build:templates
```

The gateway's local tool `import_workflow_template` calls `get_workflow_template` against this knowledge base, then posts the workflow into the user's own n8n instance via `/api/v1/workflows`.

### Build and quality reports

Run the complete official refresh and quality gate with:

```bash
npm run build:knowledge
```

This builds official-only node knowledge, fetches and stages official templates, imports the deterministic merge, emits `data/stats.json` and `../../src/data/n8n-stats.json`, then runs `npm run verify:knowledge`. The machine-readable result is `data/knowledge-quality-report.json`; production requires `ok: true`.

If the official API is unavailable, CI builds a diagnostic curated-only fallback after the node database exists:

```bash
rm -rf .tmp/templates/merged
mkdir -p .tmp/templates/merged
find data/curated-templates -maxdepth 1 -type f -name '*.json' ! -name 'manifest.json' -exec cp '{}' .tmp/templates/merged/ \;
npm run build:templates
npm run emit:stats
npm run verify:knowledge:fallback
```

Fallback mode still enforces non-empty templates, curated coverage, the 5,000 cap, FTS parity, sanitized workflow bodies, prohibited-node rejection, and valid connections. It does not claim official completeness. CI uploads the degraded database, stats, and quality report for diagnosis, then fails; it never publishes `latest` or deploys the fallback.

### Runtime health and release operations

Anonymous `GET /health` is a liveness probe and returns only `{ "ok": true }`. Supply the bearer token to verify inventory, including the production template count:

```bash
curl -fsS -H "Authorization: Bearer $AUTH_TOKEN" http://127.0.0.1:3000/health
```

The authenticated response includes `templates` alongside node and tool counts. CI compares this value with `templateCount` from `data/knowledge-quality-report.json` both in the local-image smoke test and after VPS deployment.

`.github/workflows/n8n-knowledge-mcp.yml` rebuilds every Monday at 02:00 UTC and also supports a manual `workflow_dispatch`. The verified SQLite database and reports are built once before Docker; the Dockerfile copies those exact artifacts and does not rebuild knowledge. CI smoke-tests that local image before publishing an immutable `YYYYMMDD-<run-id>` GHCR tag and then `latest`.

Production deployment uses only the immutable tag, strict SSH known-host verification, and an authenticated template-count health check. `deploy/update-knowledge.sh` preserves the running image identity before replacement and automatically recreates the previous image if pull, startup, container health, or count verification fails. An official fetch or quality-gate failure cannot reach image publication or VPS deployment.
