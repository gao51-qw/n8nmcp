# Workflow Agent Console Live Actions Design

**Date:** 2026-07-10

**Status:** Approved for implementation planning

## Goal

Turn the Workflow Agent Console from a read-only view of recorded data into a live, production-safe control surface. The finished Console must receive workflow-agent events over WebSockets, apply only trusted previewed partial updates, execute confirmed rollbacks, derive agent metadata on the server, use generated Supabase types, and pass the complete test suite.

## Current State and Constraints

- The active Console is the root Next.js application under `src/`, not the legacy Express app under `apps/api/`.
- The production workflow tools already exist in `src/lib/mcp.server.ts`: `preview_workflow_diff`, `update_partial_workflow`, and `rollback_workflow`.
- `src/app/api/dashboard/agent-console/route.ts` only supports reads. The Console buttons currently mutate React state rather than n8n.
- `mcp_call_logs` records status and latency but not the trusted preview payload needed by Apply.
- `workflow_audit_log` contains mutation snapshots, but its generated Supabase type is missing.
- The current in-memory confirmation challenge map is not reliable across serverless instances.
- Rollback currently marks an audit row as rolled back before the n8n PATCH succeeds.
- The root test baseline is 483 passing and 18 failing tests; type-check passes.
- Git history has been restored from `gao51-qw/n8nmcp` without overwriting the working tree. The current Next.js migration remains a large uncommitted change set and must not be staged wholesale by this feature.

## Chosen Architecture

Use Supabase Postgres Changes for the live WebSocket invalidation channel and retain the existing authenticated HTTP route for snapshots and mutations. Realtime events are invalidations, not the source of truth: after an event, the client debounces and reloads the authoritative Console snapshot.

Apply and Rollback use a two-request confirmation protocol backed by durable, hashed database challenges. The client never sends an arbitrary workflow JSON. Apply identifies a server-recorded preview plus selected operation indexes; the server reloads and validates that preview before dispatching `update_partial_workflow`.

## Database Changes

Create one migration under `supabase/migrations/` with the following changes.

### `mcp_call_logs`

Add:

- `workflow_id text null`
- `session_id text null`
- `metadata jsonb not null default '{}'::jsonb`

Add an index on `(user_id, workflow_id, created_at desc)` for Console lookups. Metadata is an allowlisted, size-capped summary; it must never contain credentials, authorization headers, cookies, session tokens, passwords, or complete workflow snapshots.

### `workflow_confirmation_challenges`

Add a service-only table containing:

- `id uuid primary key`
- `user_id uuid not null`
- `action text not null`
- `scope_hash text not null`
- `token_hash text not null unique`
- `expires_at timestamptz not null`
- `consumed_at timestamptz null`
- `created_at timestamptz not null default now()`

Enable RLS and add no client policies. The service-role client creates and atomically consumes challenges. Raw tokens are returned once and never stored. Challenges expire after five minutes and are bound to the authenticated user, action, and canonical action scope.

### Realtime publication

Idempotently add `mcp_call_logs` and `workflow_audit_log` to `supabase_realtime`. Existing owner/admin SELECT policies remain the authorization boundary for Postgres Changes.

Add pgTAP coverage under `supabase/tests/` for columns, indexes, RLS, publication membership, and absence of client mutation policies on confirmation challenges.

## Trusted Tool Metadata

Create `src/lib/workflow-agent/call-metadata.server.ts` with an allowlist-based metadata builder.

It records only the fields the Console needs:

- template search/load: template ID, name, confidence, and source
- preview: workflow ID, sanitized operations, diff summary, validation result, base version ID or deterministic base fingerprint
- partial update: workflow ID, diff, validation, resolved policy decision, and source preview call ID
- deploy/test and rollback: workflow ID and safe status summaries

`src/lib/mcp-route.server.ts` passes the stable MCP session header into the caller context and supplies the tool arguments/output to the metadata builder when calling `recordCall`. `recordCall` writes the workflow ID, session ID, and sanitized metadata.

Agent plans are derived from the ordered tool-call sequence. Template hits are derived from actual `search_templates` and `get_template` results recorded for the same user/session. The system does not fabricate a template hit when no template tool ran. Mutation audit metadata is enriched from these server records, so callers no longer need to supply `template` or `plan` objects in mutation arguments.

## Durable Confirmation

Create `src/lib/workflow-agent/confirmation.server.ts` and replace the process-local confirmation map.

The service exposes:

- `createConfirmationChallenge(userId, action, scope)`
- `consumeConfirmationChallenge(userId, action, scope, rawToken)`

Scope serialization is deterministic before hashing. Consumption is a single conditional UPDATE requiring a matching token hash, unexpired row, and `consumed_at is null`. A consumed, expired, mismatched, or cross-user token fails closed.

MCP callers retain the current error-message compatibility. Dashboard routes receive a structured `409 confirmation_required` response with the raw token and a safe action summary.

## Apply Update Flow

Extend the Console snapshot type with:

```ts
type PendingWorkflowUpdate = {
  previewCallId: string;
  workflowId: string;
  createdAt: string;
  expiresAt: string;
  baseVersionId?: string;
  baseFingerprint: string;
  operations: Array<{
    index: number;
    operation: WorkflowOperation;
    summary: DiffEntry;
  }>;
};
```

The pending update is the newest successful, unexpired `preview_workflow_diff` call for the selected workflow that has not been superseded by a successful partial update from the same preview.

Add `POST src/app/api/dashboard/agent-console/actions/route.ts` with an Apply request containing:

```json
{
  "action": "apply",
  "previewCallId": "uuid",
  "selectedOperationIndexes": [0, 2],
  "confirmationToken": "optional-first-request"
}
```

The route:

1. authenticates the Supabase bearer token;
2. owner-scopes and reloads the preview call;
3. verifies tool name, success status, age, workflow ID, and metadata shape;
4. resolves selected operations by index and rejects duplicates or unknown indexes;
5. checks the preview base version/fingerprint against the current n8n workflow;
6. issues or consumes a durable confirmation challenge bound to the selection;
7. dispatches `update_partial_workflow` through the existing policy and validation path;
8. records the call, usage, audit metadata, and source preview ID;
9. returns the refreshed Console snapshot.

The client cannot substitute operations or a different workflow ID.

## Rollback Flow

The Console snapshot exposes the newest owner-scoped rollback candidate for the selected workflow:

```ts
type RollbackCandidate = {
  auditLogId: string;
  workflowId: string;
  createdAt: string;
  operation: string;
  summary: string;
};
```

Rollback status is computed from that candidate, not from whether any historical row was rolled back.

The Rollback action posts the audit ID, optional reason, and optional confirmation token. The server verifies ownership and snapshot availability, validates the snapshot, confirms policy, fetches the current n8n workflow, and only then performs the n8n PATCH. The original audit row is marked rolled back after the PATCH succeeds, followed by insertion of the rollback audit record.

If audit finalization fails after a successful PATCH, the route returns an explicit retryable reconciliation error. A retry remains safe because restoring the same snapshot is idempotent; the system must never claim the audit row was rolled back before n8n accepted the snapshot.

## Realtime Client

Create `src/lib/workflow-agent/realtime.client.ts`, following the existing support Realtime helper pattern.

Subscribe to:

- INSERT events on `mcp_call_logs` filtered by authenticated `user_id`
- INSERT and UPDATE events on `workflow_audit_log` filtered by authenticated `user_id`

`AgentConsoleClient` keeps one subscription per mounted Console, debounces bursts, and refetches `/api/dashboard/agent-console`. It shows connection state and retains the last successful snapshot while refreshing. Retry remains available for authentication, network, or subscription failures.

## Console Interaction Design

`WorkflowAgentConsole` receives action callbacks rather than mutating rollback state locally.

- Each pending operation has a checkbox.
- Apply is disabled for read-only mode, no trusted pending preview, no selected operations, stale preview, or validation errors.
- Rollback is disabled when there is no rollback candidate, the candidate is already rolled back, or write mode is unavailable.
- First click opens an AlertDialog containing workflow, operation count or audit target, environment, validation status, and confirmation consequences.
- Confirmation runs the two-request token flow automatically and displays pending, success, validation failure, stale-preview, policy-blocked, and network states.
- Successful actions explicitly refresh; Realtime provides cross-tab and external-agent updates.

Independent fetches and mutation follow-up work start together where possible, and event-driven refreshes are debounced to avoid request waterfalls and duplicate rerenders.

## Authorization, Quota, and Error Handling

Dashboard actions authenticate with the user's Supabase access token and never accept a service-role or platform API key from the browser.

Actions use the same short-window and daily quota rules as MCP tool calls and write `mcp_call_logs`. Policy, confirmation, workflow validation, SSRF protection, n8n timeouts, and audit logging remain server-side.

Structured route statuses:

- `401`: missing or invalid session
- `403`: policy denial or cross-user resource
- `404`: preview/audit candidate not found
- `409`: confirmation required, stale preview, consumed token, or rollback conflict
- `422`: operation or workflow validation failure
- `429`: rate/daily quota exceeded
- `502`: n8n/upstream failure

Responses include a request ID and safe error code. Raw credentials, confirmation hashes, full snapshots, and unsanitized upstream bodies are never returned.

## Supabase Types

Regenerate `src/integrations/supabase/types.ts` from the linked or local schema after applying the migration. The generated output must include:

- `workflow_audit_log`
- updated `mcp_call_logs`
- `workflow_confirmation_challenges`
- `workflow_audit_operation`

Remove the narrow database casts from `src/lib/audit.server.ts` and `src/lib/dashboard-agent-console.ts`; use the generated `Database` row/insert/update types directly.

## Git Hygiene

Do not stage the existing working tree wholesale. Every implementation commit stages explicit paths only.

Before any publish step:

- remove `.env` from Git tracking without deleting the local file;
- verify `.env` and local caches remain ignored;
- scan staged changes for secrets;
- decide separately whether the recovered TanStack-to-Next migration should become its own baseline commit.

Credential rotation is an external operational action and is reported if the public history contains live credentials; it is not performed automatically.

## Testing Strategy

Implementation follows red-green-refactor for each behavior.

Add or extend tests for:

- metadata allowlisting, size caps, and recursive secret redaction;
- session/workflow correlation and template/plan derivation;
- durable token creation, scope binding, expiry, one-time consumption, and cross-user rejection;
- trusted preview lookup, selected indexes, stale-version rejection, and successful Apply;
- rollback validation, n8n failure without audit marking, successful PATCH then audit finalization, and retryable finalization failure;
- action route authentication, status codes, quota enforcement, and safe errors;
- Realtime subscription filters, cleanup, reconnect, and debounced refresh;
- operation selection, confirmation dialogs, pending/success/error states, and explicit refresh;
- generated database type usage and migration assertions.

Repair the 18 baseline failures before completion. The two correlation tests must mock exported error classes correctly. CRUD/graph tests must reflect the current validation-first and multi-fetch behavior rather than weakening production validation.

Final verification commands:

```bash
npm test
npm run type-check
npm run lint
npm run build
npm run test:e2e
```

Rendered QA uses the in-app Browser against the local Console on desktop and mobile. It verifies page identity, meaningful content, absence of framework overlays, console health, live invalidation, operation selection, both confirmation paths, and the resulting refreshed state.

## Acceptance Criteria

- Git commands continue to use the restored `gao51-qw/n8nmcp` history and no current source is overwritten.
- Console updates appear without page refresh after new MCP or audit rows.
- Apply can only execute selected operations from a trusted, current preview.
- Apply and Rollback require durable, user- and scope-bound confirmation tokens.
- Rollback never marks an audit row before n8n accepts the restored workflow.
- Template hits and agent plan come from server-recorded tool execution, not caller-supplied display metadata.
- Supabase generated types contain all Console tables and narrow casts are removed.
- `.env` is not included in any new commit.
- The complete test, type-check, lint, build, E2E, and rendered Browser validation gates pass, or any external environment blocker is reported with exact evidence.
