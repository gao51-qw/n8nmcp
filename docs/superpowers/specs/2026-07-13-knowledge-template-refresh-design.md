# Knowledge Template Import and Scheduled Rebuild Design

**Date:** 2026-07-13

## Goal

Populate the Knowledge MCP template index from the public n8n workflow template library, retain a small repository-curated fallback set, rebuild the knowledge database weekly or on demand, publish only verified images, and deploy successful immutable images to the production VPS with automatic rollback.

## Scope

This design covers:

- fetching public workflow templates from `n8n.io`;
- normalizing, sanitizing, merging, and indexing templates in SQLite/FTS5;
- maintaining a curated fallback set in the repository;
- weekly and manually triggered knowledge rebuilds;
- quality gates, image smoke tests, immutable publishing, VPS deployment, and rollback.

It does not add a new template authoring UI, import paid or inaccessible workflows, execute downloaded workflows, install community node packages, or change the public MCP gateway contract.

## Current State

The Knowledge MCP already:

- builds official node knowledge from `n8n-io/n8n` and documentation from `n8n-io/n8n-docs`;
- stores nodes, templates, and full-text indexes in `data/nodes.db`;
- exposes `search_templates` and `get_workflow_template`;
- has a local-folder template importer;
- runs a weekly GitHub Actions workflow and supports `workflow_dispatch`;
- publishes a Knowledge MCP image to GHCR.

The current database contains no templates. `build:db` recreates the `templates` table but never fetches or imports templates. The workflow also builds the database before the Docker build, while the Dockerfile independently rebuilds it over the network, so the reported statistics and the published image can represent different source snapshots. Publishing `latest` does not update the running VPS container.

## Authoritative Sources

The official template source is the public n8n API used by n8n's own documentation:

- search: `https://api.n8n.io/api/templates/search`;
- detail: `https://api.n8n.io/workflows/templates/{id}`.

Only templates with a publicly retrievable workflow body are eligible. Search results are requested in deterministic `views:desc` order. The importer follows pagination until the public result set is exhausted or 5,000 unique template IDs have been collected.

The fallback source is `tools/n8n-knowledge-mcp/data/curated-templates/`. It contains approximately twelve reviewed, free, official n8n templates covering Webhook, schedules, HTTP, email, AI, Slack, Google Sheets, and error handling. Curated snapshots retain their official template IDs and source URLs. They contain no credentials.

## Architecture

Template ingestion is split into isolated stages:

```text
n8n template search API
  -> deterministic paginated ID collection (maximum 5,000)
  -> bounded detail fetches
  -> .tmp/templates/official
  -> schema validation and normalization
  -> secret and dangerous-content sanitization
  -> merge with data/curated-templates
  -> local template importer
  -> templates + templates_fts
  -> knowledge quality gate
  -> verified nodes.db + report
```

### Official template client

The client owns HTTP behavior only. It accepts an injected `fetch` implementation for tests and returns validated search or detail records.

- Only `https://api.n8n.io` is allowed.
- Redirect destinations must remain on the allowed origin.
- Each request times out after 15 seconds.
- Transient failures receive at most three attempts with bounded exponential backoff.
- `429` responses honor `Retry-After` within a safe maximum delay.
- Detail concurrency is limited to four requests.
- Response content type and byte size are checked before JSON parsing.
- Logs contain template IDs and status only, never raw workflow bodies.

### Fetch stage

The fetch stage deletes its own temporary output before starting. It requests pages in `views:desc` order, deduplicates IDs, stops at 5,000, and records source totals, successful details, failed details, source URLs, and timestamps in a manifest. It writes one normalized envelope per successfully retrieved template to `.tmp/templates/official/`.

Network fetching never writes SQLite directly.

### Normalization and sanitization

Every template must have:

- a positive official ID;
- a non-empty name;
- a workflow object;
- a non-empty nodes array;
- a connections object.

Sanitization removes credential bindings, authentication configuration, secret-bearing headers and parameters, and other persisted authentication material. It removes prohibited executable node types already defined by the project. When a node is removed, connections to or from that node are also removed. Templates with malformed graph structure, obvious embedded tokens, API keys, private keys, or unresolved connections fail validation instead of being partially trusted.

The process never executes a template or any node code.

### Source merge

Official normalized templates are the primary source. Curated templates fill missing IDs. If both sources contain the same ID, the successfully fetched official version wins. Every curated ID is retained in the final set. If adding a curated template would take the merged set above 5,000 records, the lowest-view non-curated official record is removed. The merge output is therefore capped at 5,000 and deterministic by source priority, views, and numeric template ID.

When the official source is unavailable, the same pipeline can build a curated-only fallback database and diagnostic report. That fallback is an inspection and recovery artifact, not an automatically deployable production replacement.

### SQLite import and search

The existing local importer remains network-free. It ingests only the merged staging directory and writes `templates` and `templates_fts`. Search metadata includes name, description, categories, node types, author, views, source URL, and sanitized workflow JSON.

`search_templates` continues to use FTS5. `get_workflow_template` returns the sanitized importable workflow and source metadata.

## Quality Gates

For a successful official run:

- `target = min(totalWorkflows, 5000)`;
- successfully retrieved and accepted official details must be at least 95% of `target`;
- when the official total is at least 5,000, at least 4,750 official templates must pass;
- final merged template count must not exceed 5,000, and every curated ID must be present;
- template IDs must be unique;
- every curated template must import successfully;
- every stored workflow must have nodes and connections;
- no credential bindings, recognized secrets, or prohibited nodes may remain;
- no connection may reference a missing node;
- `templates` and `templates_fts` counts must agree;
- sampled records must be retrievable through both template tools.

The gate emits a machine-readable report containing source counts, accepted and rejected totals, rejection categories, source timestamps, and database counts. It does not include raw workflow bodies or secrets.

## Build and Publication

The database is built exactly once per workflow run:

```text
fetch -> normalize -> sanitize -> merge -> SQLite -> gate
  -> build image from the verified database
  -> run a local container smoke test
  -> push immutable tag and latest
```

The Docker build copies the already verified `nodes.db` and statistics into the image instead of fetching data again. The local image is started before publication. Its `/health` response and template count must match the quality report.

Successful images receive an immutable tag such as `20260713-<run-id>`. Only after the smoke test passes is the immutable tag pushed and `latest` advanced to the same image digest.

Statistics updates and build reports are produced from the same verified database that enters the image.

## Failure Behavior

If official search, detail retrieval, validation, or the 95% completeness gate fails:

1. build the curated-only fallback database and report;
2. upload them as GitHub Actions artifacts;
3. do not push a new production image tag;
4. do not update `latest`;
5. do not deploy the VPS;
6. fail the workflow so the failure is visible.

The previously published and running production image remains unchanged.

## Scheduled and Manual Rebuilds

The Knowledge MCP workflow runs:

- every Monday at 02:00 UTC;
- on `workflow_dispatch`;
- on relevant source changes, using the same verification path.

Scheduled and manual runs use the live official source. Pull-request tests use frozen fixtures and never depend on live n8n availability.

## VPS Deployment and Rollback

After a successful image publication, GitHub Actions connects to the VPS over SSH using:

- `VPS_HOST`;
- `VPS_PORT`;
- `VPS_USER`;
- `VPS_SSH_KEY`;
- `VPS_KNOWN_HOSTS`;
- `DEPLOY_PATH`.

Strict host-key checking is mandatory. The deployment script accepts the immutable image tag, reads and preserves the currently configured `MCP_IMAGE_TAG`, pulls the new image, and recreates only the `mcp` service.

The script waits up to a bounded deadline for container health and verifies the Knowledge MCP reports the expected template count. On failure it restores the prior tag, recreates the prior `mcp` container, verifies rollback health, and exits non-zero. On success it atomically persists the new immutable tag for later Compose operations.

Application and Caddy services are not restarted.

## Testing Strategy

### Unit tests

Frozen fixtures cover:

- pagination, deterministic ordering, deduplication, and the 5,000 limit;
- concurrency limits;
- timeouts, `429`, transient retries, and permanent errors;
- origin and redirect restrictions;
- response size, content type, and schema validation;
- normalization and secret removal;
- prohibited-node and stale-connection cleanup;
- official-over-curated merge behavior;
- curated-only fallback generation;
- every quality-gate failure category.

### SQLite integration tests

A small official fixture set and curated set build a temporary database. Tests call the real `search_templates` and `get_workflow_template` registrations, verify FTS behavior, deserialize stored workflow JSON, and assert table/index count parity.

### Workflow and deployment contract tests

Repository tests verify:

- weekly schedule and manual dispatch remain configured;
- publication and deployment depend on the quality and smoke-test jobs;
- failure paths upload fallback artifacts but cannot update `latest`;
- immutable tags are used for deployment;
- known-host verification is enabled;
- the remote deployment script preserves the old tag and contains a health-checked rollback path.

### Live scheduled verification

The scheduled job verifies the live source completeness threshold, builds the exact production database, smoke-tests the image, deploys it, and verifies the deployed template count. A failed live run leaves production unchanged.

## Success Criteria

- The production Knowledge MCP contains at least 4,750 official templates whenever the official result set contains at least 5,000 accessible templates.
- No more than 5,000 official templates are imported.
- All curated templates are valid, sanitized, and searchable.
- `search_templates` returns real template matches.
- `get_workflow_template` returns parseable workflows without credentials or prohibited nodes.
- The published image contains the same database described by the quality report.
- Weekly and manual rebuilds use the same path.
- Official-source failures cannot replace `latest` or production.
- Failed deployments automatically restore the previous healthy immutable image.

## Required Operational Configuration

The repository must configure the six VPS GitHub Secrets listed above. The production host must have Docker Compose access for `VPS_USER`, a deployment directory containing the Compose files and environment files, and permission to pull the GHCR image.
