# Agent Consolidation and Lovable Removal Design

## Objective

Remove Lovable completely, delete unreachable legacy application and Agent implementations, and make the current Next.js `/mcp` endpoint plus `src/lib/*` the only production Agent path. The remaining path must never represent unavailable, skipped, placeholder, or failed work as real data or success.

## Scope

### Remove Lovable completely

- Delete `supabase/functions/chat-agent` and its Lovable AI Gateway integration.
- Delete `.lovable/` and `src/integrations/lovable/`.
- Remove `@lovable.dev/cloud-auth-js` from package manifests and lockfiles.
- Remove Lovable OAuth entry points, environment-variable guidance, domains, status links, deployment labels, and active documentation references.
- Remove the `chat-agent` plan feature and related product copy.
- Do not introduce a replacement chat service in this change.

Historical reports may remain only when they are clearly archival and are not imported, deployed, linked as current documentation, or used by tests. Active configuration and runtime code must contain no Lovable dependency or endpoint.

### Remove old application and Agent implementations

- Delete all of `src/legacy-routes/`.
- Delete the unmounted MCP and workflow-Agent implementation under `apps/api/src/services/`, including old MCP dispatch, orchestrated tools, template and node knowledge, workflow validation/diff/policy, and Agent-specific audit helpers.
- Preserve services that are still imported by the active Express authentication, API-key, instance, billing, health, monitoring, or security routes.
- Keep the Express API application for its active non-MCP responsibilities.
- Add architecture guards so the legacy routes and old MCP route cannot be restored accidentally.

## Production Architecture

The only supported Agent transport is the Next.js `/mcp` route implemented through `src/app/mcp/route.ts`, `src/app/api/public/mcp/route.ts` as a compatibility alias, `src/lib/mcp-route.server.ts`, and `src/lib/mcp.server.ts`.

`src/lib/*` owns:

- MCP authentication, quota checks, dispatch, and call logging;
- workflow validation, diff generation, policy enforcement, confirmation, and audit;
- the orchestrated workflow tools;
- Agent Console metadata and status projection.

The external n8n knowledge MCP remains a separate authenticated service. The Next.js gateway proxies authoritative knowledge operations to it and fails closed when it is unavailable.

## Knowledge and Template Data Contract

The gateway must not publish static subsets or empty arrays as if they were authoritative knowledge results.

- `search_nodes` delegates to the upstream `search_nodes` tool.
- `get_node` delegates to the appropriate upstream node-detail tool, preferring essentials-level output.
- `search_templates` delegates to upstream `search_templates`.
- `get_template` delegates to upstream `get_workflow_template` or its supported alias.
- Upstream absence, authentication failure, timeout, malformed output, or RPC failure returns a structured tool error. It does not return an empty success result.
- Local `NODE_REGISTRY` remains an internal deterministic workflow-construction registry. It is not advertised as the complete n8n knowledge base.
- `validate_node` accepts both `parameters` and `credentials`. Its validation result must reflect the complete candidate node rather than manufacturing missing-credential errors by dropping the credentials input.

## Workflow Mutation Contract

`preview_workflow_diff` remains read-only and stores sanitized, owner-scoped metadata containing:

- workflow ID;
- normalized operations;
- base version ID when available;
- base fingerprint;
- validation result;
- creation time and call ID.

`update_partial_workflow` requires a `sourcePreviewCallId`. Before writing, the server loads the corresponding successful `preview_workflow_diff` call for the authenticated user and verifies:

- the preview is recent enough for the existing 30-minute pending-preview window;
- the workflow ID matches;
- the operations match the stored sanitized operations;
- the current workflow version/fingerprint still matches the preview;
- policy and confirmation requirements still pass.

Caller-supplied fingerprints without a trusted preview log do not authorize a write. Any mismatch fails closed and leaves n8n unchanged.

## Result, Logging, and Audit Semantics

Transport completion and business success are separate concepts.

- A returned object with `success: false` is recorded as an error/blocked tool call, not `ok`.
- Agent plan and tool-call UI status uses business success when present.
- Validation failures, skipped tests, rejected confirmations, and no-op repair suggestions cannot appear as completed mutations.
- Workflow mutation audit rows are written only after a mutation actually occurred.
- Deployment and test results, including validation errors, warnings, skip state, output summary, and failure reason, are stored in sanitized call metadata and audit metadata when an actual deployment mutation occurs.
- The Agent Console must show failed, blocked, skipped, passed, and not-run as distinct states.

## Placeholder and Default Removal

- Scheduled workflow responses calculate `nextRun` as a real ISO-8601 timestamp from the accepted cron expression.
- Invalid or unsupported cron expressions fail validation before workflow creation; no explanatory placeholder is returned in a data field.
- Human handoff requires an explicit recipient and credential reference. Missing either blocks workflow creation.
- `support@example.com` is never injected into a generated workflow.
- General-purpose AI prompt defaults may remain only where the field is optional and the returned workflow clearly contains the actual prompt value. They are not treated as external factual data.

## Error Handling

- Knowledge failures are explicit and actionable, with secret-safe messages.
- Destructive operations fail closed on missing preview evidence, stale workflow state, missing confirmation, validation errors, or validation warnings that prohibit activation.
- Audit and call-log persistence failures remain observable. A workflow mutation must not be reported as fully audited when its required audit record could not be written.
- Errors must not expose API keys, authorization headers, credentials, session tokens, raw upstream bodies containing secrets, or internal database details.

## Testing Strategy

All behavior changes use red-green-refactor cycles.

Required regression coverage:

1. Active source and configuration contain no Lovable runtime dependency, endpoint, Edge Function, OAuth integration, or current product feature.
2. `src/legacy-routes` and the old Express MCP/Agent implementation are absent and guarded against reintroduction.
3. Knowledge and template calls reach the real upstream mappings and fail explicitly when upstream is unavailable.
4. `validate_node` preserves credentials supplied by the caller.
5. `update_partial_workflow` rejects missing, foreign, expired, mismatched, or stale previews and accepts a valid owner-scoped preview.
6. `{ success: false }` produces a blocked/error call log and Agent Console status.
7. Failed or no-op operations do not create mutation audit rows.
8. Deploy/test metadata preserves passed, failed, blocked, and skipped distinctions.
9. Scheduled workflows return a real future ISO timestamp and reject invalid cron expressions.
10. Human handoff without recipient or credentials is rejected and no example address is generated.

Final verification runs the focused regression tests first, then the full test suite, TypeScript checks for the root and `apps/api`, lint, and the production build.

## Migration and Compatibility

- Removing Lovable OAuth can affect users who previously authenticated exclusively through that provider. Existing Supabase sessions and non-Lovable authentication remain outside this change.
- The Supabase `chat-agent` function endpoint is removed without a replacement; callers receive an endpoint-not-found response after deployment.
- MCP clients that call `update_partial_workflow` directly must first call `preview_workflow_diff` and pass `sourcePreviewCallId`.
- Knowledge requests require the authenticated upstream knowledge MCP. Deployments must configure `UPSTREAM_N8N_MCP_URL` and `UPSTREAM_N8N_MCP_TOKEN`.
- No database migration is required unless inspection shows the existing call-log status constraint cannot represent business failure using its current `error` value.

## Completion Criteria

- Only the current Next.js `/mcp` plus `src/lib/*` Agent implementation remains reachable and maintained.
- No active Lovable code, dependency, endpoint, configuration, product feature, or deployment reference remains.
- Knowledge tools return authoritative upstream data or an explicit error.
- Partial updates cannot bypass a trusted diff preview.
- Agent Console, call logs, and workflow audits reflect real outcomes.
- Generated workflows contain neither placeholder next-run data nor example handoff recipients.
- All required verification commands complete successfully.
