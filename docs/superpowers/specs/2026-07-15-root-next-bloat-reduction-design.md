# Root Next.js Bloat Reduction Design

**Date:** 2026-07-15

## Goal

Make the root Next.js application the repository's only application, remove the abandoned `apps/` monorepo architecture and pnpm/Turborepo residue, reduce rebuildable local disk usage, and prevent the same workspace bloat from returning without changing production behavior.

## Current State

- The production Docker and deployment documentation build the root Next.js application.
- `apps/api` is explicitly documented as a legacy Express service; the active MCP endpoint is the root Next.js `/mcp` route.
- `apps/dashboard` is incomplete and its documentation describes a deployment model that is no longer active.
- The root package declares `npm@11.6.2`, but pnpm workspace files, a pnpm lockfile, a Turborepo configuration, and a `.pnpm` install tree are also present.
- The workspace occupies approximately 2.82 GiB. Rebuildable dependencies, caches, and temporary knowledge-build data account for approximately 2.1 GiB.
- The working tree intentionally contains extensive user work. Unrelated staged, modified, deleted, and untracked paths must remain unchanged.

## Scope

### In scope

- Establish the root Next.js application as the sole application boundary.
- Remove `apps/` and the orphaned `packages/` workspace package after proving the root application has no live dependency on them.
- Remove `turbo.json`, `pnpm-lock.yaml`, and `pnpm-workspace.yaml`.
- Remove the root `workspaces` declaration and retain `npm@11.6.2` as the sole package manager.
- Regenerate npm lockfiles without weakening dependency or lifecycle-script controls.
- Update active documentation and deployment references that still describe pnpm, Turborepo, `apps/api`, or `apps/dashboard` as active architecture.
- Add ignore rules for reproducible local state.
- Remove reproducible dependency trees, build output, caches, and temporary knowledge acquisition data, then reinstall with npm and verify from a clean dependency state.
- Preserve the existing Knowledge MCP service under `tools/n8n-knowledge-mcp` as an independently verified npm package.
- Produce before/after disk, Git-status, dependency, and verification evidence.

### Out of scope

- Splitting large production source files.
- Changing API behavior, routes, authentication, billing, MCP tools, database schemas, or deployment topology.
- Deleting the active linked worktree before all verification passes.
- Rewriting Git history or force-cleaning the repository.
- Automatically committing unrelated user changes.

Large-file decomposition and root-document archival will be separate follow-up projects after this cleanup reaches a stable baseline.

## Target Architecture

```text
n8nmcp/
├── src/                         # sole Next.js application
├── public/                      # application assets
├── tools/n8n-knowledge-mcp/     # independently built Knowledge MCP package
├── deploy/                      # active VPS/Docker deployment
├── supabase/                    # database configuration and migrations
├── docs/                        # maintained documentation and plans
├── tests/                       # end-to-end tests
├── package.json                 # root Next.js npm package, no workspaces
├── package-lock.json            # root npm lockfile
└── Dockerfile                   # root Next.js production build
```

The following architecture is removed:

```text
apps/
packages/
turbo.json
pnpm-lock.yaml
pnpm-workspace.yaml
```

## Safety Boundaries

1. Capture `git status --porcelain=v2`, staged path identities, untracked path identities, and relevant hashes before any mutation.
2. Treat only the approved architecture paths, npm manifests, documentation references, and ignore file as mutable source paths.
3. Compare before and after Git state after excluding the approved paths. Any unrelated delta blocks continuation.
4. Before removing `apps/` or `packages/`, search source, configuration, deployment, tests, and documentation for `@n8nmcp/`, `apps/api`, `apps/dashboard`, and `packages/types` references.
5. Migrate any live type or runtime dependency into the root application before deleting its old source. Documentation-only and legacy references are updated or removed.
6. Never use `git clean`, `git reset --hard`, or wildcard deletion.
7. Resolve and verify every recursive deletion target as an exact absolute path under `D:\n8nmcp`.
8. Keep `.worktrees/` intact until implementation and post-cleanup verification pass.

## Package-Manager Convergence

- Root package manager: npm 11.6.2.
- Root installation: `npm ci` using the regenerated root `package-lock.json`.
- Knowledge MCP installation: `npm ci` in `tools/n8n-knowledge-mcp` using its own `package-lock.json`.
- Remove `workspaces` from the root manifest so npm does not install deleted legacy packages.
- Remove pnpm and Turbo configuration and ensure scripts and documentation no longer invoke either tool.
- Verify no `.pnpm` directory remains after the clean npm installation.
- Do not introduce a replacement task orchestrator; the root and Knowledge package are verified explicitly.

## Rebuildable-State Cleanup

After source convergence and before clean installation, remove only these exact rebuildable paths when present:

- `D:\n8nmcp\node_modules`
- `D:\n8nmcp\.next`
- `D:\n8nmcp\.tmp`
- `D:\n8nmcp\.npm-cache`
- `D:\n8nmcp\test-results`
- `D:\n8nmcp\tsconfig.tsbuildinfo`
- `D:\n8nmcp\tools\n8n-knowledge-mcp\node_modules`
- `D:\n8nmcp\tools\n8n-knowledge-mcp\.tmp`
- `D:\n8nmcp\tools\n8n-knowledge-mcp\dist`
- `D:\n8nmcp\tools\n8n-knowledge-mcp\data\nodes.db`

The cleanup must not delete `.worktrees`, `.git`, `.superpowers`, source files, environment files, user uploads, database migrations, or unrelated untracked content.

## Ignore Policy

The root `.gitignore` will ignore:

```gitignore
.tmp/
.npm-cache/
.worktrees/
test-results/
*.tsbuildinfo
.superpowers/sdd/
```

Existing package-specific rules continue to ignore Knowledge MCP dependencies, temporary acquisition data, build output, and generated databases.

## Documentation Convergence

Active documentation must describe:

- Root Next.js as the sole application.
- Root npm commands for development, test, build, and deployment.
- `tools/n8n-knowledge-mcp` as the only separate package/runtime.
- VPS Docker deployment as the production path.

Historical plans and reports are not rewritten merely because they mention the former architecture. Only active READMEs, deployment guides, package scripts, and operator instructions are updated.

## Verification

### Pre-cleanup baseline

- Root lint, type-check, unit tests, and production build.
- Knowledge MCP full tests and TypeScript check through Node 20 with `--maxWorkers=1`.
- Record disk usage, dependency tree shape, and Git state.

### Post-convergence clean install

- `npm ci --ignore-scripts` at the root, followed by explicitly required approved build steps.
- `npm ci --ignore-scripts` in `tools/n8n-knowledge-mcp`, followed by its required approved build steps.
- Confirm there is no pnpm lockfile, workspace file, Turbo configuration, `.pnpm` install tree, or live reference to deleted architecture.

### Final behavioral gates

- `npm run lint`
- `npm run type-check`
- `npm test`
- `npm run build`
- Knowledge MCP full Vitest suite with Node 20 and `--maxWorkers=1`
- Knowledge MCP TypeScript check with Node 20
- `git diff --check`
- Conflict-marker scan
- Before/after unrelated-state comparison
- Final disk-usage report

Any failing baseline is documented before cleanup. Any new failure after convergence blocks completion and must be fixed or rolled back within the approved paths.

## Rollback

- Source changes are isolated to explicit paths and committed in small steps.
- Before recursive cleanup, record package manifests, lockfile hashes, and exact cleanup targets.
- Rebuildable directories are restored with npm installs or project build commands rather than from ad hoc copies.
- If an active dependency on legacy code is discovered, stop before deletion and migrate that dependency with a focused test.
- The linked worktree remains available until final verification and review finish.

## Success Criteria

- Root Next.js is the only application described and built by active configuration.
- `apps/`, `packages/`, pnpm workspace/lock files, and Turbo configuration are absent.
- Root npm and Knowledge MCP npm installs are reproducible from their lockfiles.
- No `.pnpm` installation tree remains.
- All specified verification commands pass.
- Unrelated user Git state is byte-for-byte and status-for-status unchanged.
- Rebuildable local disk usage is materially reduced, with before/after measurements reported.
