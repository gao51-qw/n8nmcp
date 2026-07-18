# Workflow Agent Console Live Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a live Workflow Agent Console whose Apply and Rollback controls execute trusted, validated, confirmed workflow mutations and whose complete repository test suite is green.

**Architecture:** Supabase Postgres Changes provides WebSocket invalidation while authenticated Next.js routes remain the snapshot and mutation authority. MCP calls persist allowlisted workflow-agent metadata; Dashboard actions resolve operations from those server records, use durable hashed confirmation challenges, and dispatch the existing workflow policy/validation code.

**Tech Stack:** TypeScript 5.8, Next.js 16 App Router, React 19, Supabase/Postgres/Realtime, Zod, Vitest 4, Playwright, in-app Browser QA.

## Global Constraints

- Work on `fix/workflow-agent-console-live-actions`; never implement on `main`.
- The root Next.js application under `src/` is the active product surface; do not wire the Console through legacy `apps/api`.
- Use `npm@11.6.2`, as declared by the root `packageManager`; `pnpm` is unavailable in this environment.
- Use TDD for every behavior: failing test, observed expected failure, minimal implementation, passing test, refactor.
- Never stage the working tree wholesale. Stage only exact paths named by the current task.
- Never stage `.env`; it is already tracked by recovered history and contains local configuration.
- Mutations remain behind server-side auth, quota, policy, confirmation, validation, SSRF protection, and audit logging.
- Realtime payloads are invalidations; the HTTP Console snapshot remains the source of truth.
- Metadata uses an allowlist, recursive redaction, and a 64 KiB serialized ceiling. It never stores credentials or full workflow snapshots.
- Confirmation tokens expire after five minutes, are stored only as SHA-256 hashes, are user/action/scope bound, and are one-time use.
- Browser validation is mandatory because this changes a rendered Next.js interaction surface.

---

## File Structure

### New files

- `src/lib/workflow-agent/call-metadata.server.ts` — safe tool metadata extraction and deterministic agent-plan derivation.
- `src/lib/workflow-agent/confirmation.server.ts` — durable confirmation challenge service.
- `src/lib/workflow-agent/dashboard-actions.server.ts` — trusted Apply/Rollback orchestration for Dashboard JWT users.
- `src/lib/workflow-agent/realtime.client.ts` — owner-filtered Console Realtime subscription.
- `src/lib/workflow-agent/__tests__/call-metadata.server.test.ts`
- `src/lib/workflow-agent/__tests__/confirmation.server.test.ts`
- `src/lib/workflow-agent/__tests__/dashboard-actions.server.test.ts`
- `src/lib/workflow-agent/__tests__/realtime.client.test.ts`
- `src/app/api/dashboard/agent-console/actions/route.ts`
- `src/app/api/dashboard/agent-console/actions/__tests__/route.test.ts`
- `supabase/tests/workflow_agent_console_live_actions.sql`
- One migration created by `npx supabase migration new workflow_agent_console_live_actions`; capture the exact generated path in `$MIGRATION` and use that path for all migration edits and commits.

### Modified files

- `src/lib/mcp-upstream.server.ts` — add stable `session_id` to `CallerCtx`.
- `src/lib/mcp.server.ts` — persist metadata, use durable confirmation, expose trusted preview version data, and make rollback finalization safe.
- `src/lib/mcp-route.server.ts` — pass session IDs and safe call metadata to `recordCall`.
- `src/lib/audit.server.ts` — generated types and two-phase rollback lookup/finalization.
- `src/lib/dashboard-agent-console.ts` — generated types, pending preview, rollback candidate, server-derived plan/template data.
- `src/components/workflow-agent/agent-console.tsx` — controlled actions, operation selection, confirmation/result UI.
- `src/app/dashboard/agent-console/agent-console-client.tsx` — authenticated mutation calls, Realtime invalidation, debounced refresh.
- `src/integrations/supabase/types.ts` — regenerated database types.
- `src/lib/support/__tests__/correlation.test.ts` — complete MCP module mock.
- `src/lib/__tests__/mcp-crud-tools.test.ts` — reset mock response queues and align legacy expectations with validation-first behavior.
- Existing Console, MCP route, audit, and component tests listed in the tasks below.

---

### Task 1: Restore a Green Pre-Feature Test Baseline

**Files:**
- Modify: `src/lib/support/__tests__/correlation.test.ts`
- Modify: `src/lib/__tests__/mcp-crud-tools.test.ts`

**Interfaces:**
- Consumes: current `ElicitationRequiredError` export and validation-first `runTool` behavior.
- Produces: a green 501-test baseline without weakening production validation.

- [ ] **Step 1: Complete the MCP test mock**

Change the correlation mock to export the error class required by `mcp-route.server.ts`:

```ts
vi.mock("@/lib/mcp.server", () => ({
  ...mcpMocks,
  ElicitationRequiredError: class ElicitationRequiredError extends Error {
    constructor(
      public readonly elicitationId: string,
      public readonly request: unknown,
    ) {
      super(`Elicitation required (${elicitationId})`);
    }
  },
}));
```

- [ ] **Step 2: Reset queued fetch implementations between CRUD tests**

Use an explicit reset before clearing other mocks:

```ts
beforeEach(() => {
  mockFetch.mockReset();
  vi.clearAllMocks();
});
```

Replace the two empty-workflow success fixtures with a valid Manual Trigger node:

```ts
const validNodes = [
  {
    name: "Manual Trigger",
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    position: [0, 0],
    parameters: {},
  },
];
```

Use `nodes: validNodes` in the required-fields and optional-fields create tests. Replace the legacy structural `active` update expectation with:

```ts
await expect(
  runTool(mockN8nInstance, "update_workflow", {
    id: "workflow-123",
    active: true,
    confirm: true,
  }),
).rejects.toThrow(/preview_workflow_diff.*update_partial_workflow/);
expect(mockFetch).not.toHaveBeenCalled();
```

- [ ] **Step 3: Run the two previously failing files**

Run:

```bash
npm test -- src/lib/support/__tests__/correlation.test.ts src/lib/__tests__/mcp-crud-tools.test.ts
```

Expected: both files pass; 53 tests pass and no tests fail.

- [ ] **Step 4: Run the complete baseline**

Run:

```bash
npm test
```

Expected: 51 files pass and 501 tests pass.

- [ ] **Step 5: Commit only the baseline tests**

```bash
git add -- src/lib/support/__tests__/correlation.test.ts src/lib/__tests__/mcp-crud-tools.test.ts
git commit -m "test(mcp): restore validation-first baseline"
```

---

### Task 2: Add Durable Schema, Realtime Publication, and Generated Types

**Files:**
- Create via CLI: migration returned by `npx supabase migration new workflow_agent_console_live_actions`
- Create: `supabase/tests/workflow_agent_console_live_actions.sql`
- Modify: `src/integrations/supabase/types.ts`

**Interfaces:**
- Produces: typed `mcp_call_logs.workflow_id/session_id/metadata`, `workflow_confirmation_challenges`, and Realtime publication membership.

- [ ] **Step 1: Discover and create the migration through Supabase CLI**

Run:

```powershell
npx supabase migration new --help
$created = npx supabase migration new workflow_agent_console_live_actions
$MIGRATION = ($created | Select-String 'supabase[/\\]migrations[/\\].+\.sql').Matches.Value
if (-not $MIGRATION) { throw 'Supabase CLI did not return a migration path' }
$MIGRATION
```

Expected: one new migration path ending in `_workflow_agent_console_live_actions.sql`.

- [ ] **Step 2: Write the failing pgTAP contract**

Create `supabase/tests/workflow_agent_console_live_actions.sql` with assertions for:

```sql
begin;
select plan(14);
select has_column('public', 'mcp_call_logs', 'workflow_id');
select has_column('public', 'mcp_call_logs', 'session_id');
select has_column('public', 'mcp_call_logs', 'metadata');
select has_index('public', 'mcp_call_logs', 'idx_mcp_call_logs_user_workflow_time');
select has_table('public', 'workflow_confirmation_challenges');
select has_column('public', 'workflow_confirmation_challenges', 'token_hash');
select has_column('public', 'workflow_confirmation_challenges', 'scope_hash');
select has_column('public', 'workflow_confirmation_challenges', 'expires_at');
select has_column('public', 'workflow_confirmation_challenges', 'consumed_at');
select is((select relrowsecurity from pg_class where oid = 'public.workflow_confirmation_challenges'::regclass), true, 'challenge RLS enabled');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename = 'workflow_confirmation_challenges'), 0, 'service-only challenge table');
select ok(exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mcp_call_logs'), 'mcp logs published');
select ok(exists(select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workflow_audit_log'), 'audit logs published');
select col_default_is('public', 'mcp_call_logs', 'metadata', '''{}''::jsonb');
select * from finish();
rollback;
```

- [ ] **Step 3: Implement the migration**

Write to `$MIGRATION`:

```sql
alter table public.mcp_call_logs
  add column workflow_id text check (workflow_id is null or char_length(workflow_id) between 1 and 128),
  add column session_id text check (session_id is null or char_length(session_id) between 1 and 128),
  add column metadata jsonb not null default '{}'::jsonb;

create index idx_mcp_call_logs_user_workflow_time
  on public.mcp_call_logs(user_id, workflow_id, created_at desc);

create table public.workflow_confirmation_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (char_length(action) between 1 and 80),
  scope_hash text not null check (char_length(scope_hash) = 64),
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_workflow_confirmation_challenges_lookup
  on public.workflow_confirmation_challenges(user_id, action, scope_hash, expires_at)
  where consumed_at is null;

alter table public.workflow_confirmation_challenges enable row level security;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'mcp_call_logs') then
    alter publication supabase_realtime add table public.mcp_call_logs;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'workflow_audit_log') then
    alter publication supabase_realtime add table public.workflow_audit_log;
  end if;
end
$$;
```

- [ ] **Step 4: Run local database tests when the Supabase runtime is available**

Run:

```bash
npx supabase test db supabase/tests/workflow_agent_console_live_actions.sql
```

Expected: 14 assertions pass. If Docker/local Supabase is unavailable, record the exact command failure and continue with static migration tests added to Vitest in Task 9.

- [ ] **Step 5: Regenerate database types**

Run `npx supabase gen types --help`, then use the linked project if configured:

```powershell
npx supabase gen types typescript --linked --schema public | Set-Content -Encoding utf8 src/integrations/supabase/types.ts
```

Expected: generated `Database` includes `workflow_audit_log`, updated `mcp_call_logs`, `workflow_confirmation_challenges`, and `workflow_audit_operation`.

- [ ] **Step 6: Type-check and commit exact schema paths**

```bash
npm run type-check
git add -- "$MIGRATION" supabase/tests/workflow_agent_console_live_actions.sql src/integrations/supabase/types.ts
git commit -m "feat(db): persist workflow agent action state"
```

---

### Task 3: Persist Safe Workflow-Agent Call Metadata

**Files:**
- Create: `src/lib/workflow-agent/call-metadata.server.ts`
- Create: `src/lib/workflow-agent/__tests__/call-metadata.server.test.ts`
- Modify: `src/lib/mcp-upstream.server.ts`
- Modify: `src/lib/mcp.server.ts`
- Modify: `src/lib/mcp-route.server.ts`
- Modify: `src/lib/__tests__/mcp-route.server.test.ts`

**Interfaces:**
- Produces: `buildWorkflowAgentCallMetadata(name, args, output)`, `deriveAgentPlan(events)`, and extended `recordCall` fields.

- [ ] **Step 1: Write failing metadata tests**

Cover preview extraction and redaction:

```ts
expect(buildWorkflowAgentCallMetadata("preview_workflow_diff", {
  workflowId: "wf-1",
  operations: [{ type: "updateNode", nodeId: "http", changes: { authorization: "secret", method: "GET" } }],
}, {
  baseVersionId: "v1",
  baseFingerprint: "abc",
  diff: { changedNodes: ["HTTP"] },
  validation: { ok: true, errors: [], warnings: [] },
})).toMatchObject({
  workflowId: "wf-1",
  operations: [{ changes: { authorization: "[REDACTED]", method: "GET" } }],
  baseVersionId: "v1",
});
```

Also assert unknown tools return `{}`, oversized payloads return `{ _truncated: true }`, template output creates safe hits, and agent plan order is deterministic.

- [ ] **Step 2: Run and observe RED**

```bash
npm test -- src/lib/workflow-agent/__tests__/call-metadata.server.test.ts
```

Expected: module-not-found failure.

- [ ] **Step 3: Implement the allowlisted metadata builder**

Export:

```ts
export type WorkflowAgentCallMetadata = Record<string, Json>;
export function buildWorkflowAgentCallMetadata(
  name: string,
  args: Record<string, unknown>,
  output: unknown,
): WorkflowAgentCallMetadata;
export function deriveAgentPlan(events: Array<{ tool_name: string | null; status: string; created_at: string }>): Array<{
  tool: string;
  status: "complete" | "blocked" | "pending";
}>;
```

Use a recursive key redactor and `JSON.stringify(result).length <= 65_536`.

- [ ] **Step 4: Thread session and metadata through MCP recording**

Add `session_id?: string` to `CallerCtx`. Extend `recordCall` with `workflow_id`, `session_id`, and `metadata`. In `mcp-route.server.ts`, pass the request's stable session header and call:

```ts
metadata: buildWorkflowAgentCallMetadata(name, args, result.output),
workflow_id: workflowIdFromCall(name, args, result.output),
session_id: sessionId,
```

Update route tests to assert those fields reach `recordCall`.

- [ ] **Step 5: Verify focused tests and type-check**

```bash
npm test -- src/lib/workflow-agent/__tests__/call-metadata.server.test.ts src/lib/__tests__/mcp-route.server.test.ts
npm run type-check
```

Expected: focused tests and type-check pass.

- [ ] **Step 6: Commit**

```bash
git add -- src/lib/workflow-agent/call-metadata.server.ts src/lib/workflow-agent/__tests__/call-metadata.server.test.ts src/lib/mcp-upstream.server.ts src/lib/mcp.server.ts src/lib/mcp-route.server.ts src/lib/__tests__/mcp-route.server.test.ts
git commit -m "feat(mcp): record trusted workflow agent metadata"
```

---

### Task 4: Replace Process-Local Confirmation with Durable Challenges

**Files:**
- Create: `src/lib/workflow-agent/confirmation.server.ts`
- Create: `src/lib/workflow-agent/__tests__/confirmation.server.test.ts`
- Modify: `src/lib/mcp.server.ts`
- Modify: `src/lib/__tests__/mcp-crud-tools.test.ts`

**Interfaces:**
- Produces: `ConfirmationService`, `ConfirmationRequiredError`, and one-time DB-backed confirmation.

- [ ] **Step 1: Write failing service tests**

Define an injectable store and assert token hashing, expiry, user/action/scope binding, one-time consumption, and no raw token persistence:

```ts
const service = createConfirmationService(fakeStore, { now: () => new Date("2026-07-10T00:00:00Z") });
const challenge = await service.requireOrConsume({ userId: "u1", action: "apply", scope: { previewCallId: "p1", selected: [0] } });
expect(challenge).rejects.toMatchObject({ code: "confirmation_required" });
expect(fakeStore.inserted.token_hash).toMatch(/^[a-f0-9]{64}$/);
expect(JSON.stringify(fakeStore.inserted)).not.toContain("mcp_confirm_");
```

- [ ] **Step 2: Run and observe RED**

```bash
npm test -- src/lib/workflow-agent/__tests__/confirmation.server.test.ts
```

- [ ] **Step 3: Implement service and errors**

Export:

```ts
export class ConfirmationRequiredError extends Error {
  readonly code = "confirmation_required";
  constructor(public readonly token: string, public readonly expiresAt: string, public readonly summary: string);
}

export function createConfirmationService(store?: ConfirmationStore, options?: { now?: () => Date }): {
  requireOrConsume(input: {
    userId: string;
    action: string;
    scope: unknown;
    confirmationToken?: string;
  }): Promise<void>;
};
```

The default store uses typed `supabaseAdmin` insert/update queries. Consume with one conditional UPDATE and `.select("id").maybeSingle()`.

- [ ] **Step 4: Replace the in-memory map in `mcp.server.ts`**

Pass authenticated `user_id` into `requireConfirmation`; retain existing MCP-compatible message text by translating `ConfirmationRequiredError` at the MCP boundary. Update confirmation tests to inject the fake store rather than parse process-local state.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- src/lib/workflow-agent/__tests__/confirmation.server.test.ts src/lib/__tests__/mcp-crud-tools.test.ts src/lib/__tests__/mcp-route.server.test.ts
npm run type-check
git add -- src/lib/workflow-agent/confirmation.server.ts src/lib/workflow-agent/__tests__/confirmation.server.test.ts src/lib/mcp.server.ts src/lib/__tests__/mcp-crud-tools.test.ts src/lib/__tests__/mcp-route.server.test.ts
git commit -m "feat(security): persist workflow confirmation challenges"
```

---

### Task 5: Make Rollback Two-Phase and Add Trusted Dashboard Actions

**Files:**
- Create: `src/lib/workflow-agent/dashboard-actions.server.ts`
- Create: `src/lib/workflow-agent/__tests__/dashboard-actions.server.test.ts`
- Create: `src/app/api/dashboard/agent-console/actions/route.ts`
- Create: `src/app/api/dashboard/agent-console/actions/__tests__/route.test.ts`
- Modify: `src/lib/audit.server.ts`
- Modify: `src/lib/__tests__/audit.server.test.ts`
- Modify: `src/lib/mcp.server.ts`

**Interfaces:**
- Produces: `executeDashboardAgentAction(userId, input, requestContext)` and safe rollback prepare/finalize functions.

- [ ] **Step 1: Write rollback ordering tests**

Assert:

```ts
await expect(actions.rollback(validInput)).rejects.toThrow("n8n PATCH failed");
expect(auditStore.markRolledBack).not.toHaveBeenCalled();
```

Then assert success ordering is `validate -> fetch current -> PATCH -> mark -> record audit`.

- [ ] **Step 2: Split audit lookup and finalization**

Replace `markRolledBack()` with:

```ts
export async function getRollbackSnapshotForUser(userId: string, auditLogId: string): Promise<WorkflowAuditRow>;
export async function markAuditRolledBack(userId: string, auditLogId: string): Promise<void>;
```

The lookup validates owner, `snapshot_before`, and `is_rolled_back` without writing. Finalization runs only after n8n accepted the snapshot.

- [ ] **Step 3: Write trusted Apply action tests**

Test that Apply reloads `previewCallId` by `id + user_id`, resolves only selected indexes, rejects stale previews and duplicate/unknown indexes, and never accepts client-supplied operations.

- [ ] **Step 4: Implement dashboard action service**

Use Zod discriminated inputs:

```ts
type DashboardAgentAction =
  | { action: "apply"; previewCallId: string; selectedOperationIndexes: number[]; confirmationToken?: string }
  | { action: "rollback"; auditLogId: string; reason?: string; confirmationToken?: string };
```

Enforce short-window/daily quotas, call `dispatchTool`, write `recordCall`, and return a structured success or `ConfirmationRequiredError`.

- [ ] **Step 5: Implement and test the authenticated route**

`POST` authenticates with `requireSupportUser`, parses JSON, maps confirmation to `409`, validation to `422`, quota to `429`, and all responses include `x-request-id`.

Run:

```bash
npm test -- src/lib/workflow-agent/__tests__/dashboard-actions.server.test.ts src/app/api/dashboard/agent-console/actions/__tests__/route.test.ts src/lib/__tests__/audit.server.test.ts
npm run type-check
```

- [ ] **Step 6: Commit**

```bash
git add -- src/lib/workflow-agent/dashboard-actions.server.ts src/lib/workflow-agent/__tests__/dashboard-actions.server.test.ts src/app/api/dashboard/agent-console/actions/route.ts src/app/api/dashboard/agent-console/actions/__tests__/route.test.ts src/lib/audit.server.ts src/lib/__tests__/audit.server.test.ts src/lib/mcp.server.ts
git commit -m "feat(console): execute trusted workflow actions"
```

---

### Task 6: Build Pending Preview, Rollback Candidate, and Server-Derived Context

**Files:**
- Modify: `src/lib/dashboard-agent-console.ts`
- Modify: `src/lib/__tests__/dashboard-agent-console.test.ts`
- Modify: `src/components/workflow-agent/agent-console.tsx` (types only in this task)

**Interfaces:**
- Produces: `pendingUpdate`, `rollbackCandidate`, and `agentPlan` in `WorkflowAgentConsoleData`.

- [ ] **Step 1: Write failing mapping tests**

Supply call rows with `metadata` and assert the newest unused preview becomes:

```ts
expect(data.pendingUpdate).toMatchObject({
  previewCallId: "preview-2",
  workflowId: "wf-1",
  operations: [
    { index: 0, operation: { type: "updateNode", nodeId: "http" } },
  ],
});
expect(data.rollbackCandidate).toMatchObject({ auditLogId: "audit-latest", workflowId: "wf-1" });
expect(data.agentPlan?.map((step) => step.tool)).toEqual(["search_templates", "preview_workflow_diff"]);
```

Assert an applied `sourcePreviewCallId` supersedes the pending preview and that an unrelated rolled-back row does not disable the current candidate.

- [ ] **Step 2: Run and observe RED**

```bash
npm test -- src/lib/__tests__/dashboard-agent-console.test.ts
```

- [ ] **Step 3: Implement typed loading and mapping**

Use generated `Database["public"]["Tables"]` types directly. Query `mcp_call_logs` metadata and session/workflow fields. Remove `ConsoleDatabase`/`QueryBuilder` casts from `dashboard-agent-console.ts` and the matching narrow cast from `audit.server.ts`.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- src/lib/__tests__/dashboard-agent-console.test.ts src/lib/__tests__/audit.server.test.ts
npm run type-check
git add -- src/lib/dashboard-agent-console.ts src/lib/__tests__/dashboard-agent-console.test.ts src/components/workflow-agent/agent-console.tsx src/lib/audit.server.ts
git commit -m "feat(console): expose trusted pending workflow state"
```

---

### Task 7: Add Realtime WebSocket Invalidation

**Files:**
- Create: `src/lib/workflow-agent/realtime.client.ts`
- Create: `src/lib/workflow-agent/__tests__/realtime.client.test.ts`
- Modify: `src/app/dashboard/agent-console/agent-console-client.tsx`

**Interfaces:**
- Produces: `subscribeToWorkflowAgentConsole(userId, handlers): () => void`.

- [ ] **Step 1: Write failing subscription tests**

Assert configs exactly equal:

```ts
[
  { event: "INSERT", schema: "public", table: "mcp_call_logs", filter: "user_id=eq.user-1" },
  { event: "INSERT", schema: "public", table: "workflow_audit_log", filter: "user_id=eq.user-1" },
  { event: "UPDATE", schema: "public", table: "workflow_audit_log", filter: "user_id=eq.user-1" },
]
```

Also assert cleanup, connection status callbacks, and reconnect invalidation.

- [ ] **Step 2: Run and observe RED**

```bash
npm test -- src/lib/workflow-agent/__tests__/realtime.client.test.ts
```

- [ ] **Step 3: Implement the helper and debounced client refresh**

Export:

```ts
export function subscribeToWorkflowAgentConsole(
  userId: string,
  handlers: { onInvalidate: () => void; onStatus: (status: string) => void },
): () => void;
```

In `AgentConsoleClient`, retain the last ready data during refresh, debounce invalidations by 150 ms, remove the channel and timer on cleanup, and prevent stale fetches with `AbortController`.

- [ ] **Step 4: Verify and commit**

```bash
npm test -- src/lib/workflow-agent/__tests__/realtime.client.test.ts src/app/dashboard/__tests__/agent-console-page.test.ts
npm run type-check
git add -- src/lib/workflow-agent/realtime.client.ts src/lib/workflow-agent/__tests__/realtime.client.test.ts src/app/dashboard/agent-console/agent-console-client.tsx
git commit -m "feat(console): stream workflow agent invalidations"
```

---

### Task 8: Wire Apply and Rollback UI with Confirmation States

**Files:**
- Modify: `src/components/workflow-agent/agent-console.tsx`
- Modify: `src/components/workflow-agent/__tests__/agent-console.test.tsx`
- Modify: `src/app/dashboard/agent-console/agent-console-client.tsx`

**Interfaces:**
- Consumes: `pendingUpdate`, `rollbackCandidate`, action route, and Realtime refresh.
- Produces: selected operations and real confirmed mutations.

- [ ] **Step 1: Write failing component interaction tests**

Render with a pending preview and callbacks. Assert selecting operations changes the submitted indexes, read-only/validation/stale states disable Apply, Rollback submits the candidate audit ID, and local state does not claim success before the callback resolves.

```ts
expect(onApply).toHaveBeenCalledWith({ previewCallId: "preview-1", selectedOperationIndexes: [0] });
expect(onRollback).toHaveBeenCalledWith({ auditLogId: "audit-1", reason: expect.any(String) });
```

- [ ] **Step 2: Run and observe RED**

```bash
npm test -- src/components/workflow-agent/__tests__/agent-console.test.tsx
```

- [ ] **Step 3: Implement controlled action props and dialogs**

Use:

```ts
type WorkflowAgentConsoleProps = {
  data: WorkflowAgentConsoleData;
  actionState: { status: "idle" | "confirming" | "pending" | "success" | "error"; message?: string };
  onApply: (input: { previewCallId: string; selectedOperationIndexes: number[] }) => Promise<void>;
  onRollback: (input: { auditLogId: string; reason: string }) => Promise<void>;
};
```

Use the existing Radix AlertDialog components. `AgentConsoleClient` performs the first POST, receives `409 confirmation_required`, immediately resubmits after the user confirms with the returned token, and refreshes the authoritative snapshot on success.

- [ ] **Step 4: Verify React behavior and type-check**

```bash
npm test -- src/components/workflow-agent/__tests__/agent-console.test.tsx src/lib/__tests__/dashboard-agent-console.test.ts
npm run type-check
```

- [ ] **Step 5: Commit**

```bash
git add -- src/components/workflow-agent/agent-console.tsx src/components/workflow-agent/__tests__/agent-console.test.tsx src/app/dashboard/agent-console/agent-console-client.tsx
git commit -m "feat(console): confirm apply and rollback actions"
```

---

### Task 9: Full Verification, Migration Guards, and Rendered QA

**Files:**
- Create: `src/lib/__tests__/workflow-agent-console-migration.test.ts`
- Modify: `src/app/dashboard/__tests__/agent-console-page.test.ts`
- No committed screenshots or temporary Browser scripts.

**Interfaces:**
- Produces: evidence that all acceptance gates pass.

- [ ] **Step 1: Add static migration guards**

Create `src/lib/__tests__/workflow-agent-console-migration.test.ts`. Locate the single migration ending in `_workflow_agent_console_live_actions.sql`, read it, and assert it contains RLS, both publication checks, the metadata default, and no authenticated policy on `workflow_confirmation_challenges`. Extend `agent-console-page.test.ts` to assert the action route and Realtime helper are wired from the client.

- [ ] **Step 2: Run the complete automated verification set**

```bash
npm test
npm run type-check
npm run lint
npm run build
npm run test:e2e
```

Expected: all commands exit 0. Record exact environmental blockers instead of claiming a pass when a command cannot run.

- [ ] **Step 3: Inspect repository scope**

```bash
git status --short
git diff --check HEAD
git diff --name-only origin/main...HEAD
git diff --cached --name-only
```

Expected: no staged files, `.env` absent from feature commits, and branch commits contain only design, plan, tests, migration, generated types, Console/MCP/audit implementation files.

- [ ] **Step 4: Run in-app Browser QA**

Flow under test:

`/dashboard/agent-console -> live preview arrives -> select operations -> confirm Apply -> authoritative snapshot refreshes -> confirm Rollback -> audit/timeline refreshes`.

Verify desktop and mobile page identity, non-blank content, no framework overlay, console health, screenshot evidence, disabled/error states, Realtime invalidation, and both confirmation interactions.

- [ ] **Step 5: Commit the verification guards**

```bash
git add -- src/lib/__tests__/workflow-agent-console-migration.test.ts src/app/dashboard/__tests__/agent-console-page.test.ts
git commit -m "test(console): verify live workflow action boundaries"
```

---

## Plan Self-Review Results

- Spec coverage: Git preservation, Realtime, trusted Apply, safe Rollback, durable confirmation, server-derived metadata, generated types, quota/policy enforcement, full tests, and Browser QA are each mapped to a task.
- Type consistency: `previewCallId`, `selectedOperationIndexes`, `auditLogId`, `pendingUpdate`, `rollbackCandidate`, and `agentPlan` use the same names across server, route, data mapper, and UI tasks.
- Scope: legacy `apps/api` remains untouched; no unrelated Dashboard redesign or repository-wide refactor is included.
- Git safety: every commit stages explicit paths and `.env` is excluded.
