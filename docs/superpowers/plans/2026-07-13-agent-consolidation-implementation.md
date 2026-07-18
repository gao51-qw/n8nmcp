# Agent Consolidation and Lovable Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove Lovable and obsolete Agent implementations, then make the Next.js `/mcp` path report only authoritative knowledge, trusted mutations, real execution outcomes, and real generated values.

**Architecture:** Keep Express only for auth, API keys, instances, billing, health, and monitoring. Route Agent traffic through Next.js MCP, proxy knowledge operations to the authenticated knowledge MCP, bind partial updates to owner-scoped preview records, and derive logs/audits/UI state from business outcomes.

**Tech Stack:** TypeScript, Next.js 16, Node.js, Vitest 4, Supabase, MCP Streamable HTTP, `cron-parser`, npm workspaces.

## Global Constraints

- Preserve unrelated dirty-worktree changes.
- Do not add a replacement chat service.
- Keep `src/app/mcp/route.ts`, its `/api/public/mcp` compatibility alias, and `src/lib/*` as the only Agent implementation.
- Knowledge, preview, validation, audit, and business failures fail closed.
- Never log secrets or raw secret-bearing upstream bodies.
- Use a visible red-green-refactor cycle for every behavior change.

## File Map

Delete `.lovable/`, `supabase/functions/chat-agent/`, `src/integrations/lovable/`, `src/legacy-routes/`, and the unmounted MCP/Agent files under `apps/api/src/services/`. Preserve `api-keys.service.ts`, `auth.service.ts`, `instances.service.ts`, and their active tests.

Create `src/lib/workflow-agent/trusted-preview.server.ts`, its test, and `src/lib/__tests__/agent-consolidation-guards.test.ts`.

Modify package manifests/lockfiles, active configuration, `src/lib/mcp*.ts`, `src/lib/workflow-agent*`, `src/lib/dashboard-agent-console.ts`, `src/lib/orchestrated-tools.service.ts`, and their focused tests.

---

### Task 1: Hard-delete Lovable and obsolete source trees

**Files:**
- Create: `src/lib/__tests__/agent-consolidation-guards.test.ts`
- Modify: `src/lib/__tests__/architecture-guards.test.ts`
- Modify: `src/lib/__tests__/next-architecture-guards.test.ts`
- Modify: `package.json`, `package-lock.json`, `pnpm-lock.yaml`
- Modify: `tsconfig.json`, `vitest.config.ts`, `eslint.config.js`
- Delete: approved Lovable, legacy-route, and old Agent paths

**Interfaces:** Produces filesystem/package guards for the single production Agent architecture.

- [ ] **Step 1: Write the failing guard**

```ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("single production Agent architecture", () => {
  it("removes Lovable and obsolete source trees", () => {
    const pkg = JSON.parse(read("package.json")) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies?.["@lovable.dev/cloud-auth-js"]).toBeUndefined();
    for (const path of [
      ".lovable",
      "supabase/functions/chat-agent",
      "src/integrations/lovable",
      "src/legacy-routes",
      "apps/api/src/services/mcp.service.ts",
      "apps/api/src/services/mcp-extended.service.ts",
      "apps/api/src/services/orchestrated-tools.service.ts",
    ]) expect(existsSync(join(root, path)), path).toBe(false);
  });

  it("keeps only Next MCP routes", () => {
    expect(existsSync(join(root, "src/app/mcp/route.ts"))).toBe(true);
    expect(existsSync(join(root, "src/app/api/public/mcp/route.ts"))).toBe(true);
    expect(existsSync(join(root, "apps/api/src/routes/mcp.ts"))).toBe(false);
  });
});
```

- [ ] **Step 2: Verify RED**

Run `npx vitest run src/lib/__tests__/agent-consolidation-guards.test.ts src/lib/__tests__/architecture-guards.test.ts src/lib/__tests__/next-architecture-guards.test.ts`.

Expected: FAIL because approved removal targets still exist.

- [ ] **Step 3: Remove approved paths safely**

Resolve each recursive deletion target and verify it begins with `D:\n8nmcp\`. Delete the approved trees and these obsolete Express service families: `audit*`, `mcp*`, `node-knowledge*`, `orchestrated-tools*`, `template*`, `workflow-diff*`, `workflow-operation-policy*`, and `workflow-validation*`, including matching tests. Preserve active auth/API-key/instance services.

- [ ] **Step 4: Remove active Lovable dependencies and copy**

Remove `@lovable.dev/cloud-auth-js`, `chat-agent` tier features, Lovable OAuth, status/footer links, environment guidance, preview labels, endpoints, and active deployment references. Remove obsolete legacy/Lovable exclusions from TypeScript, Vitest, and ESLint configuration. Synchronize both lockfiles without upgrading unrelated dependencies.

- [ ] **Step 5: Verify GREEN and active Express imports**

Run the Step 2 test command, then:

```powershell
rg -n -e 'services/' apps/api/src --glob '*.ts' --glob '!services/**'
npm run type-check --workspace @n8nmcp/api
```

Expected: guards PASS; only auth/API-key/instance services are imported; type-check exits 0.

- [ ] **Step 6: Commit**

```powershell
git add -- package.json package-lock.json pnpm-lock.yaml tsconfig.json vitest.config.ts eslint.config.js src apps/api/src supabase/functions .lovable deploy
git commit -m "refactor(agent): remove Lovable and legacy agent paths"
```

---

### Task 2: Use authoritative knowledge and complete node validation

**Files:**
- Modify: `src/lib/mcp.server.ts`
- Modify: `src/lib/mcp-tool-definitions.ts`
- Modify: `src/lib/workflow-agent.ts`
- Modify: `src/lib/__tests__/mcp-agent-tools.test.ts`

**Interfaces:** Produces `KNOWLEDGE_TOOL_MAP` and `validateNode(nodeType, parameters, credentials)`.

- [ ] **Step 1: Write failing upstream-routing tests**

```ts
upstreamMocks.isUpstreamConfigured.mockReturnValue(true);
upstreamMocks.callUpstreamTool.mockResolvedValueOnce({ content: [{ type: "text", text: "real" }] });
const result = await dispatchTool("search_templates", { query: "slack" }, null, {
  user_id: "user-1", key_id: "key-1",
});
expect(upstreamMocks.callUpstreamTool).toHaveBeenCalledWith(
  "search_templates", { query: "slack" }, null, expect.objectContaining({ user_id: "user-1" }),
);
expect(result).toMatchObject({ upstream: true, category: "knowledge", needsInstance: false });
```

Add mappings for `search_nodes -> search_nodes`, `get_node -> get_node_essentials`, `search_templates -> search_templates`, and `get_template -> get_workflow_template`. Add a test that missing upstream configuration throws instead of returning zero results.

- [ ] **Step 2: Verify RED**

Run `npx vitest run src/lib/__tests__/mcp-agent-tools.test.ts`.

Expected: FAIL because local static/empty services currently win.

- [ ] **Step 3: Implement authoritative mapping**

```ts
export const KNOWLEDGE_TOOL_MAP = Object.freeze({
  search_nodes: "search_nodes",
  get_node: "get_node_essentials",
  search_templates: "search_templates",
  get_template: "get_workflow_template",
} as const);
```

Handle mapped names before local Agent reads. If upstream is unconfigured, throw `Knowledge tool <name> is unavailable because the upstream knowledge MCP is not configured`. Otherwise call `callUpstreamTool(mappedName, args, null, caller)` and return category `knowledge`. Remove mapped names from local dispatch; keep `NODE_REGISTRY` internal.

- [ ] **Step 4: Write the failing credentials test**

```ts
const result = await dispatchTool("validate_node", {
  nodeType: "n8n-nodes-base.emailSend",
  parameters: { toEmail: "ops@example.org", subject: "Alert", message: "Body" },
  credentials: { smtp: { id: "smtp-1", name: "Operations SMTP" } },
}, null, { user_id: "user-1", key_id: "key-1" });
expect(result.output).toMatchObject({ ok: true });
```

Run the focused test and confirm it fails because credentials are discarded.

- [ ] **Step 5: Pass credentials through validation**

Add `credentials` to the tool schema. Change the validator signature to accept `credentials?: Record<string, unknown>`, attach it to the candidate node, and pass `asObj(args.credentials)` from dispatch.

- [ ] **Step 6: Verify GREEN and commit**

Run `npx vitest run src/lib/__tests__/mcp-agent-tools.test.ts src/lib/__tests__/mcp-upstream.test.ts`.

Expected: PASS.

```powershell
git add -- src/lib/mcp.server.ts src/lib/mcp-tool-definitions.ts src/lib/workflow-agent.ts src/lib/__tests__/mcp-agent-tools.test.ts
git commit -m "fix(agent): require authoritative knowledge results"
```

---

### Task 3: Bind partial updates to trusted previews

**Files:**
- Create: `src/lib/workflow-agent/trusted-preview.server.ts`
- Create: `src/lib/workflow-agent/__tests__/trusted-preview.server.test.ts`
- Modify: `src/lib/mcp.server.ts`, `src/lib/mcp-tool-definitions.ts`
- Modify: `src/lib/workflow-agent/dashboard-actions.server.ts`
- Modify: related MCP and dashboard-action tests

**Interfaces:** Produces `loadTrustedWorkflowPreview(userId, previewCallId)` and `assertTrustedWorkflowPreview(input)` returning trusted workflow/operations/version/fingerprint. The validator accepts optional server-validated operation indexes; without indexes, the requested operations must equal the full preview.

- [ ] **Step 1: Write failing pure-validator tests**

```ts
const trusted = assertTrustedWorkflowPreview({
  preview: {
    id: "preview-1", user_id: "user-1", tool_name: "preview_workflow_diff", status: "ok",
    created_at: "2026-07-13T02:00:00.000Z", workflow_id: "wf-1",
    metadata: {
      workflowId: "wf-1",
      operations: [{ type: "updateNode", nodeId: "n1", changes: { parameters: { path: "v2" } } }],
      baseFingerprint: "fingerprint-1",
    },
  },
  userId: "user-1", workflowId: "wf-1",
  operations: [{ type: "updateNode", nodeId: "n1", changes: { parameters: { path: "v2" } } }],
  now: new Date("2026-07-13T02:05:00.000Z"),
});
expect(trusted.baseFingerprint).toBe("fingerprint-1");
```

Add rejection tests for missing row, foreign owner, wrong tool, non-`ok` status, age over 30 minutes, workflow mismatch, operation mismatch, duplicate indexes, and out-of-range indexes. Add one success case proving indexes `[0, 2]` derive exactly those stored operations.

- [ ] **Step 2: Verify RED**

Run `npx vitest run src/lib/workflow-agent/__tests__/trusted-preview.server.test.ts`.

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement trusted preview loading and validation**

Use a 30-minute TTL, owner-scoped Supabase lookup, and stable JSON comparison. Reject every mismatch with a secret-safe error. When trusted indexes are present, derive the authorized operations from stored preview metadata instead of trusting caller-provided operation objects. Return only values stored in trusted metadata.

- [ ] **Step 4: Write failing MCP enforcement tests**

Prove `update_partial_workflow` rejects missing, unknown, foreign, expired, mismatched, and stale preview evidence before any n8n PATCH. Prove a valid preview reaches the existing current-fingerprint check.

- [ ] **Step 5: Enforce schema/runtime contract**

Require `sourcePreviewCallId` in the tool schema. Add an internal `sourcePreviewOperationIndexes` integer array used by the Dashboard path. In `updatePartialWorkflow`, require authenticated `caller.user_id`, load the preview, derive or compare the exact operations, and use trusted version/fingerprint values. Caller-provided operations, indexes, or fingerprints alone never authorize a write.

- [ ] **Step 6: Reuse the shared validator in Dashboard actions**

Replace the private trust checks with the shared validator. Dashboard actions pass the selected indexes, and the update service derives the selected operation objects again from the owner-scoped preview row before writing. Preserve confirmation behavior.

- [ ] **Step 7: Verify GREEN and commit**

Run:

```powershell
npx vitest run src/lib/workflow-agent/__tests__/trusted-preview.server.test.ts src/lib/workflow-agent/__tests__/dashboard-actions.server.test.ts src/lib/__tests__/mcp-agent-tools.test.ts
```

Expected: PASS and no rejected path reaches PATCH.

```powershell
git add -- src/lib/workflow-agent src/lib/mcp.server.ts src/lib/mcp-tool-definitions.ts src/lib/__tests__/mcp-agent-tools.test.ts
git commit -m "fix(agent): bind partial updates to trusted previews"
```

---

### Task 4: Record real business, audit, and Console outcomes

**Files:**
- Modify: `src/lib/mcp-route.server.ts`, `src/lib/mcp.server.ts`
- Modify: `src/lib/workflow-agent/call-metadata.server.ts`
- Modify: `src/lib/dashboard-agent-console.ts`
- Modify: route, audit, metadata, and console tests

**Interfaces:** Produces `toolBusinessOutcome(output)` plus metadata fields `businessSuccess`, `mutationApplied`, `validation`, and `results`.

- [ ] **Step 1: Write failing business-failure tests**

Mock dispatch returning `{ output: { success: false, message: "Validation failed" }, ... }`. Assert `recordCall` receives `status: "error"`, the safe error message, and `metadata.businessSuccess: false`. Assert Console maps it to blocked, not complete.

- [ ] **Step 2: Verify RED**

Run `npx vitest run src/lib/__tests__/mcp-route.server.test.ts src/lib/__tests__/dashboard-agent-console.test.ts`.

Expected: FAIL because transport success is currently recorded as `ok`.

- [ ] **Step 3: Implement outcome classification**

```ts
export function toolBusinessOutcome(output: unknown) {
  const record = asRecord(output);
  if (record.success === false) return { success: false as const, errorMessage: safeMessage(record) };
  if (record.success === true) return { success: true as const };
  return { success: null as const };
}
```

Record business failures as `error`, return structured MCP content with `isError: true`, and keep thrown transport errors in the existing catch path.

- [ ] **Step 4: Write failing audit-gating tests**

Prove no mutation audit is written for `fix_workflow_errors` with `applied: false` or failed deploy/test; prove applied updates write one audit containing sanitized validation/results.

- [ ] **Step 5: Gate mutation audit and enrich metadata**

```ts
function mutationApplied(name: string, output: unknown): boolean {
  const result = asObj(output);
  if (result.success === false) return false;
  if (name === "fix_workflow_errors") return result.applied === true;
  if (name === "deploy_and_test_workflow") {
    return asObj(asObj(result.results).activation).success === true;
  }
  return true;
}
```

Write mutation audit only when true. Persist sanitized `validation`, `results`, `diff`, and policy metadata. Make Console read call metadata when a failed deployment correctly has no mutation audit, preserving passed/failed/blocked/skipped/not-run.

- [ ] **Step 6: Verify GREEN and commit**

Run:

```powershell
npx vitest run src/lib/__tests__/mcp-route.server.test.ts src/lib/__tests__/audit-wiring.test.ts src/lib/__tests__/dashboard-agent-console.test.ts src/lib/__tests__/workflow-agent-console-migration.test.ts
```

Expected: PASS.

```powershell
git add -- src/lib/mcp-route.server.ts src/lib/mcp.server.ts src/lib/workflow-agent/call-metadata.server.ts src/lib/dashboard-agent-console.ts src/lib/__tests__
git commit -m "fix(agent): report real tool and audit outcomes"
```

---

### Task 5: Replace generated placeholders and unsafe defaults

**Files:**
- Modify: `package.json`, lockfiles
- Modify: `src/lib/orchestrated-tools.service.ts`
- Modify: `src/lib/__tests__/orchestrated-tools.service.test.ts`

**Interfaces:** Produces a future ISO `nextRun`; rejects incomplete human-handoff configuration.

- [ ] **Step 1: Write failing schedule tests**

Freeze time at `2026-07-13T00:00:00.000Z`, create an hourly scheduled workflow, and expect `nextRun === "2026-07-13T01:00:00.000Z"`. Add a test that invalid cron rejects before n8n POST.

- [ ] **Step 2: Verify RED**

Run `npx vitest run src/lib/__tests__/orchestrated-tools.service.test.ts -t "next run|invalid cron"`.

Expected: FAIL because the current value is placeholder text.

- [ ] **Step 3: Add `cron-parser` and calculate real time**

```ts
private getNextRunTime(cronExpression: string, currentDate = new Date()): string {
  try {
    return CronExpressionParser.parse(cronExpression, { currentDate }).next().toDate().toISOString();
  } catch {
    throw new Error(`Invalid cron expression: ${cronExpression}`);
  }
}
```

Calculate before workflow creation. Synchronize lockfiles without unrelated upgrades.

- [ ] **Step 4: Write failing handoff tests**

Add separate tests that `humanHandoff: true` rejects missing `humanEmail` and missing `humanEmailCredentials`. Assert serialized workflows never contain `support@example.com`.

- [ ] **Step 5: Require explicit handoff configuration**

```ts
if (params.features?.humanHandoff) {
  if (!params.interfaceConfig?.humanEmail?.trim()) {
    throw new Error("Human handoff requires an explicit notification email");
  }
  if (!isRecord(params.interfaceConfig.humanEmailCredentials)) {
    throw new Error("Human handoff requires explicit email credential references");
  }
}
```

Remove the example-address fallback.

- [ ] **Step 6: Verify GREEN and commit**

Run `npx vitest run src/lib/__tests__/orchestrated-tools.service.test.ts`.

Expected: PASS.

```powershell
git add -- package.json package-lock.json pnpm-lock.yaml src/lib/orchestrated-tools.service.ts src/lib/__tests__/orchestrated-tools.service.test.ts
git commit -m "fix(agent): remove generated workflow placeholders"
```

---

### Task 6: Full cleanup and verification

**Files:** Active files returned by scans only.

**Interfaces:** Produces the verified final repository state.

- [ ] **Step 1: Remove remaining active forbidden references**

```powershell
rg -n -i "lovable|chat-agent|ai\.gateway\.lovable\.dev|LOVABLE_API_KEY|n8nmcp\.lovable\.app" package.json src apps supabase deploy .github Dockerfile next.config.ts --glob '!**/*.md'
rg -n -F -e 'Next run time calculated based on cron expression' -e 'support@example.com' src apps --glob '*.{ts,tsx}' --glob '!**/__tests__/**'
rg -n -e 'mcp-extended.service' -e 'src/legacy-routes' src apps package.json tsconfig.json vitest.config.ts eslint.config.js
```

Remove every active runtime/config/deployment match. Do not rewrite unrelated archival reports.

- [ ] **Step 2: Run focused regression tests**

```powershell
npx vitest run src/lib/__tests__/agent-consolidation-guards.test.ts src/lib/__tests__/mcp-agent-tools.test.ts src/lib/workflow-agent/__tests__/trusted-preview.server.test.ts src/lib/workflow-agent/__tests__/dashboard-actions.server.test.ts src/lib/__tests__/mcp-route.server.test.ts src/lib/__tests__/audit-wiring.test.ts src/lib/__tests__/dashboard-agent-console.test.ts src/lib/__tests__/orchestrated-tools.service.test.ts
```

Expected: 0 failed tests.

- [ ] **Step 3: Run full root verification**

```powershell
npm test -- --run
npm run type-check
npm run lint
npm run build
```

Expected: every command exits 0.

- [ ] **Step 4: Run Express workspace verification**

```powershell
npm test --workspace @n8nmcp/api -- --run
npm run type-check --workspace @n8nmcp/api
npm run build --workspace @n8nmcp/api
```

Expected: every command exits 0 and no deleted service is imported.

- [ ] **Step 5: Re-run scans and diff checks**

Repeat Step 1, then run:

```powershell
git diff --check
git status --short
git diff --stat
```

Expected: active forbidden scans have no matches; diff check exits 0; status contains only intended changes plus pre-existing user changes.

- [ ] **Step 6: Commit final cleanup if needed**

```powershell
git add -- package.json package-lock.json pnpm-lock.yaml src apps supabase deploy .github Dockerfile next.config.ts
git commit -m "chore(agent): finalize single production path"
```

- [ ] **Step 7: Check completion criteria against fresh output**

Confirm Lovable and old trees are absent; knowledge calls are authoritative; partial updates require trusted previews; business/audit/Console states are real; cron output is real; no example recipient is generated; root and Express verification passed.
