# n8n-mcp Agent Guide

## Active architecture

This repository has one application: the Root Next.js application.

- `src/app/` contains pages, route handlers, and the public MCP endpoint.
- `src/lib/` contains application, MCP, billing, support, audit, and workflow-agent logic.
- `tools/n8n-knowledge-mcp/` is the only separately built package/runtime.
- `deploy/` and the root `Dockerfile` define the VPS Docker deployment.
- `supabase/` contains database configuration, migrations, and database tests.

The retired Express/dashboard workspace architecture must not be recreated.

## Package management

Use npm only. The root package manager is npm 11.6.2.

```powershell
npm ci
npm run dev
npm run lint
npm run type-check
npm test
npm run build
```

Verify the Knowledge MCP package independently:

```powershell
Set-Location tools/n8n-knowledge-mcp
npm ci
npx.cmd --yes node@20 ./node_modules/vitest/vitest.mjs run --maxWorkers=1
npx.cmd --yes node@20 ./node_modules/typescript/bin/tsc -p tsconfig.json
```

## Code boundaries

- Pages and HTTP route handlers belong under `src/app/`.
- Shared server behavior belongs under `src/lib/`.
- Shared React components belong under `src/components/`.
- Database changes require a migration under `supabase/migrations/` and relevant tests.
- Knowledge acquisition, parsing, validation, and serving code stays under `tools/n8n-knowledge-mcp/`.

## Workflow Agent Mode

Production n8n workflow creation or mutation is not ordinary repository CRUD. Use the workflow-agent safety sequence: template and node knowledge lookup, node validation, workflow validation, diff preview, partial update, deployment/test gates, audit snapshots, and rollback metadata. Validation errors block deployment; warnings block automatic activation.

Repository code, tests, documentation, and Dashboard changes use Code Agent Mode.

## Security requirements

- Never store API keys or service credentials in plaintext.
- Validate inputs with the existing schemas and fail closed.
- Route user-controlled outbound URLs through the SSRF protections in `src/lib/ssrf-guard.server.ts`.
- Preserve audit logging for mutating workflow operations.
- Official GitHub node source is parsed statically and must remain contained within its package root.
- Community package tarballs require trusted-host and SRI verification before extraction.

## Working-tree safety

- Preserve unrelated staged, modified, deleted, and untracked user paths.
- Do not use `git clean`, `git reset --hard`, or broad wildcard deletion.
- Use `apply_patch` for source edits.
- Use Node 20 and `--maxWorkers=1` for Knowledge MCP verification.
- Run focused tests while iterating and the complete relevant suite before completion.

## Deployment

The production authority is the root Next.js standalone image deployed through VPS Docker Compose and Caddy. Do not add active Vercel, Cloudflare Worker, legacy Express, or split-domain deployment instructions without an approved architecture change.
