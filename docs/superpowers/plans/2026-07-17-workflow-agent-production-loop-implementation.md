# Workflow Agent Production Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the Root Next.js MCP gateway, the internal Knowledge MCP, n8n, durable confirmation, trusted previews, smoke testing, audit metadata, and rollback into one production-safe workflow-agent loop.

**Architecture:** Keep the Root Next.js route as the only public gateway. Add a bounded trusted Knowledge MCP client and inject it, the existing durable confirmation service, workflow validation, partial-operation preview/apply, and n8n access into focused workflow-agent pipeline modules. Creation always produces an inactive draft; deployment is the only activation path; repair is expressed as trusted `WorkflowOperation` previews followed by confirmed application, testing, and safe rollback.

**Tech Stack:** Next.js 16, TypeScript 5.8, Vitest 4, Zod 3, Supabase/Postgres, MCP JSON-RPC over HTTP/SSE, n8n REST API, VPS Docker Compose/Caddy.

## Global Constraints

- The Root Next.js application under `src/` is the only product application and public MCP gateway.
- Shared workflow-agent code belongs under `src/lib/workflow-agent/`; Knowledge acquisition and serving code stays under `tools/n8n-knowledge-mcp/`.
- Use npm 11.6.2 only; use Node 20 and `--maxWorkers=1` for Knowledge MCP verification.
- Never route user-controlled URLs through the trusted transport; they continue through `src/lib/ssrf-guard.server.ts`.
- Creation never activates. Warnings allow an inactive draft but block deployment. Knowledge degradation may create only reviewed-registry drafts and blocks testing/activation.
- Confirmation tokens expire after five minutes, are owner/action/scope-bound, persist across MCP requests, and are single-use.
- Invalid input fails before n8n or Supabase mutation. Metadata is allowlisted, size-capped, and secret-free.
- Preserve the existing dirty worktree. Do not clean, reset, or broadly stage. Because unrelated changes are already staged, use file-scoped diffs as checkpoints and do not create commits unless the user asks.
- Baseline evidence on 2026-07-17: `npm test` passes 62 files and 576 tests.

---

### Task 1: Canonical Public Tool Contracts

**Files:**
- Modify: `src/lib/orchestrated-tools.ts`
- Modify: `src/lib/mcp-tool-definitions.ts`
- Modify: `src/lib/mcp.server.ts`
- Test: `src/lib/__tests__/mcp-tool-contract-parity.test.ts`
- Test: `src/lib/__tests__/mcp-agent-tools.test.ts`
- Test: `src/lib/__tests__/mcp-tool-metadata.test.ts`

**Interfaces:**
- Consumes: `LOCAL_TOOLS`, `orchestratedTools`, `runTool()` runtime parsers.
- Produces: canonical `preview_workflow_diff`, `update_partial_workflow`, orchestrated-create, deployment, and repair JSON Schemas whose field names and required lists match runtime behavior.

- [ ] **Step 1: Write failing contract tests**

  Assert that preview requires only `workflowId` and `operations`; partial update also requires `sourcePreviewCallId`; selected operation indexes, `confirm`, and `confirmationToken` are advertised only where supported; deployment requires `testData`; create enums contain only implemented values; and `activate` is described as intent rather than immediate activation.

  ```ts
  expect(tool("preview_workflow_diff").inputSchema.required).toEqual([
    "workflowId",
    "operations",
  ]);
  expect(tool("update_partial_workflow").inputSchema.required).toEqual([
    "workflowId",
    "operations",
    "sourcePreviewCallId",
  ]);
  expect(tool("deploy_and_test_workflow").inputSchema.required).toEqual([
    "workflowId",
    "testData",
  ]);
  ```

- [ ] **Step 2: Verify RED**

  Run: `npx vitest run src/lib/__tests__/mcp-tool-contract-parity.test.ts src/lib/__tests__/mcp-agent-tools.test.ts src/lib/__tests__/mcp-tool-metadata.test.ts`

  Expected: failures show the current reversed preview/update requirements, unsupported enum values, and missing runtime parity.

- [ ] **Step 3: Implement shared contract parsing**

  Keep schemas in descriptors and add runtime helpers in `mcp.server.ts` that reject missing or malformed values before dispatch. Remove unsupported `database_query`, `custom`, `enrich`, `store`, `notify`, Discord, Telegram, WhatsApp, Google AI, database-change triggers, and any field the active implementation cannot honor.

  ```ts
  const previewArgs = {
    workflowId: requireNonEmptyString(args.workflowId, "workflowId"),
    operations: requireOperations(args.operations),
  };
  const sourcePreviewCallId = requireNonEmptyString(
    args.sourcePreviewCallId,
    "sourcePreviewCallId",
  );
  ```

- [ ] **Step 4: Verify GREEN**

  Run the focused command from Step 2. Expected: all focused contract tests pass.

- [ ] **Step 5: Record a scoped checkpoint**

  Run: `git diff -- src/lib/orchestrated-tools.ts src/lib/mcp-tool-definitions.ts src/lib/mcp.server.ts src/lib/__tests__/mcp-tool-contract-parity.test.ts src/lib/__tests__/mcp-agent-tools.test.ts src/lib/__tests__/mcp-tool-metadata.test.ts`

---

### Task 2: Trusted Internal Knowledge MCP Transport

**Files:**
- Create: `src/lib/workflow-agent/knowledge-client.server.ts`
- Create: `src/lib/workflow-agent/__tests__/knowledge-client.server.test.ts`
- Modify: `src/lib/mcp-upstream.server.ts`
- Modify: `src/lib/__tests__/mcp-upstream.test.ts`
- Modify: `deploy/docker-compose.yml`
- Modify: `deploy/docker-compose.local.yml`
- Modify: `deploy/docker-compose.aapanel.yml`
- Modify: `deploy/.env.app.example`
- Test: `src/lib/__tests__/workflow-agent-docker-contract.test.ts`

**Interfaces:**
- Consumes: operator-owned `UPSTREAM_N8N_MCP_URL`, `UPSTREAM_N8N_MCP_TOKEN`, `fetch`.
- Produces: `KnowledgeClient` with `searchTemplates`, `getTemplate`, `searchNodes`, `getNode`, `validateNode`, and `validateWorkflow`; `createKnowledgeClient(config?, dependencies?)` enforces exact configured URL/origin, bearer auth, 10-second timeout, 1 MiB response limit, no redirects, JSON/SSE parsing, and sanitized errors.

- [ ] **Step 1: Write failing transport tests**

  Cover `http://mcp:3000/mcp`, an exact configured URL match, bearer header, redirect rejection, timeout, oversized response, malformed JSON/SSE, generic upstream errors, and a regression proving `safeFetchPublicUrl("http://127.0.0.1")` still rejects user-controlled private addresses.

  ```ts
  const client = createKnowledgeClient(
    { url: "http://mcp:3000/mcp", token: "secret" },
    { fetch: fetchMock },
  );
  await client.searchNodes("webhook", 5);
  expect(fetchMock).toHaveBeenCalledWith(
    "http://mcp:3000/mcp",
    expect.objectContaining({ redirect: "manual" }),
  );
  ```

- [ ] **Step 2: Verify RED**

  Run: `npx vitest run src/lib/workflow-agent/__tests__/knowledge-client.server.test.ts src/lib/__tests__/mcp-upstream.test.ts src/lib/__tests__/workflow-agent-docker-contract.test.ts`

  Expected: Docker-internal URL is rejected by the current public-address SSRF guard and the dedicated client does not exist.

- [ ] **Step 3: Implement the bounded trusted client**

  Build JSON-RPC calls only against the constructor-captured URL. Do not accept a URL from any method argument. Read the body as a bounded stream, reject redirects and non-2xx responses, and convert all failures to typed `KnowledgeUnavailableError`/`KnowledgeResponseError` messages without raw bodies or tokens.

  ```ts
  export interface KnowledgeClient {
    searchTemplates(query: string, limit: number): Promise<KnowledgeTemplateHit[]>;
    getTemplate(id: string | number): Promise<KnowledgeTemplateDetail>;
    searchNodes(query: string, limit: number): Promise<KnowledgeNodeHit[]>;
    getNode(nodeType: string): Promise<KnowledgeNodeDetail>;
    validateNode(input: KnowledgeNodeValidationInput): Promise<KnowledgeValidation>;
    validateWorkflow(workflow: WorkflowLike): Promise<KnowledgeValidation>;
  }
  ```

- [ ] **Step 4: Wire the production origin**

  Ensure all app services receive `UPSTREAM_N8N_MCP_URL=http://mcp:3000/mcp`, the app depends on the healthy `mcp` service, and the token matches the MCP container auth token without exposing the internal MCP port publicly.

- [ ] **Step 5: Verify GREEN**

  Run the focused command from Step 2. Expected: all trusted-transport and Docker-contract tests pass.

- [ ] **Step 6: Record a scoped checkpoint**

  Run: `git diff -- src/lib/workflow-agent/knowledge-client.server.ts src/lib/workflow-agent/__tests__/knowledge-client.server.test.ts src/lib/mcp-upstream.server.ts src/lib/__tests__/mcp-upstream.test.ts src/lib/__tests__/workflow-agent-docker-contract.test.ts deploy/docker-compose.yml deploy/docker-compose.local.yml deploy/docker-compose.aapanel.yml deploy/.env.app.example`

---

### Task 3: Shared Inactive-Draft Creation Pipeline

**Files:**
- Create: `src/lib/workflow-agent/creation-pipeline.server.ts`
- Create: `src/lib/workflow-agent/__tests__/creation-pipeline.server.test.ts`
- Modify: `src/lib/orchestrated-tools.service.ts`
- Modify: `src/lib/__tests__/orchestrated-tools.service.test.ts`
- Modify: `src/lib/mcp.server.ts`
- Modify: `src/lib/__tests__/orchestrated-tools-wiring.test.ts`

**Interfaces:**
- Consumes: `KnowledgeClient`, reviewed local builders/registry, `WorkflowValidationService`, injected n8n `createDraft` function.
- Produces: `WorkflowCreationPipeline.create(input): Promise<CreationPipelineResult>` with structured template selection, per-node knowledge/validation, authoritative workflow validation, degraded-mode state, inactive-only creation, and `nextAction: "deploy_and_test_workflow"`.

- [ ] **Step 1: Write failing creation-pipeline tests**

  Cover compatible template selection, incompatible-template fallback, template sanitization, node essentials lookup for every unique node type, per-node validation, authoritative workflow validation, validation-error no-mutation, warning draft creation, reviewed-registry degraded draft, unsupported-node degradation rejection, and `activate: true` remaining inactive.

  ```ts
  const result = await pipeline.create({
    intent: "daily report",
    activateIntent: true,
    buildFallback: () => reviewedWorkflow,
    templateCompatibility: isScheduledEmailTemplate,
  });
  expect(n8n.createDraft).toHaveBeenCalledWith(
    expect.objectContaining({ active: false }),
  );
  expect(n8n.activate).not.toHaveBeenCalled();
  expect(result.nextAction).toBe("deploy_and_test_workflow");
  ```

- [ ] **Step 2: Verify RED**

  Run: `npx vitest run src/lib/workflow-agent/__tests__/creation-pipeline.server.test.ts src/lib/__tests__/orchestrated-tools.service.test.ts src/lib/__tests__/orchestrated-tools-wiring.test.ts`

  Expected: existing create methods directly activate and use the local stub `TemplateService` rather than Knowledge MCP.

- [ ] **Step 3: Implement `WorkflowCreationPipeline`**

  Normalize the intent, search/load a compatible sanitized template, or call an injected reviewed builder; load essentials and validate every unique node; validate the full workflow; reject errors before mutation; post an inactive draft only; return allowlisted knowledge/template/validation/fallback metadata.

  ```ts
  export type CreationPipelineResult = {
    success: boolean;
    workflow?: WorkflowLike;
    knowledgeMode: "authoritative" | "degraded";
    activationEligible: boolean;
    activationIntent: boolean;
    template: TemplateSelectionMetadata;
    validation: WorkflowValidationResult;
    nextAction: "deploy_and_test_workflow";
  };
  ```

- [ ] **Step 4: Route all orchestrated create tools through the pipeline**

  Keep existing reviewed builders but remove their direct POST/activate logic. Pass their built workflow into the shared pipeline. Replace default-active copy with compatibility copy: `activate` records intent and never bypasses deployment.

- [ ] **Step 5: Verify GREEN**

  Run the focused command from Step 2. Expected: all create paths are inactive, knowledge-aware, and share one pipeline.

- [ ] **Step 6: Record a scoped checkpoint**

  Run: `git diff -- src/lib/workflow-agent/creation-pipeline.server.ts src/lib/workflow-agent/__tests__/creation-pipeline.server.test.ts src/lib/orchestrated-tools.service.ts src/lib/__tests__/orchestrated-tools.service.test.ts src/lib/mcp.server.ts src/lib/__tests__/orchestrated-tools-wiring.test.ts`

---

### Task 4: Durable Deployment, Smoke Test, And Activation Gate

**Files:**
- Create: `src/lib/workflow-agent/deployment-pipeline.server.ts`
- Create: `src/lib/workflow-agent/__tests__/deployment-pipeline.server.test.ts`
- Modify: `src/lib/workflow-agent/confirmation.server.ts`
- Modify: `src/lib/workflow-agent/__tests__/confirmation.server.test.ts`
- Modify: `src/lib/orchestrated-tools.service.ts`
- Modify: `src/lib/mcp.server.ts`
- Modify: `src/lib/__tests__/orchestrated-tools.service.test.ts`
- Modify: `src/lib/__tests__/mcp-route.server.test.ts`

**Interfaces:**
- Consumes: owner ID, durable confirmation service, Knowledge validation, n8n read/run/activate/deactivate functions, explicit `testData`, output rules.
- Produces: `WorkflowDeploymentPipeline.deploy(input): Promise<DeploymentResult>`; confirmation scope includes owner, workflow ID, version/fingerprint, test-data digest, output-rule digest, and requested activation.

- [ ] **Step 1: Write failing confirmation/deployment tests**

  Cover cross-request token consumption, expiry, replay, owner mismatch, workflow/fingerprint mismatch, test-data/rule mismatch, elicitation using the same boundary, active/stale draft rejection, degraded knowledge rejection, validation errors/warnings, missing test data, failed execution, failed output rule, activation error, and successful test-then-activation ordering.

  ```ts
  expect(events).toEqual([
    "load-draft",
    "knowledge-validate",
    "consume-confirmation",
    "smoke-test",
    "evaluate-rules",
    "activate",
  ]);
  ```

- [ ] **Step 2: Verify RED**

  Run: `npx vitest run src/lib/workflow-agent/__tests__/confirmation.server.test.ts src/lib/workflow-agent/__tests__/deployment-pipeline.server.test.ts src/lib/__tests__/orchestrated-tools.service.test.ts src/lib/__tests__/mcp-route.server.test.ts`

  Expected: orchestrated deployment still owns an in-memory challenge map, scope omits workflow fingerprint, and validation is local-only.

- [ ] **Step 3: Extend the shared confirmation boundary**

  Expose a single injected `ConfirmationService` interface. Elicitation acceptance creates/consumes the same durable challenge semantics or marks a server-verified confirmation scope; service-local maps are removed from production code.

  ```ts
  export interface ConfirmationService {
    requireOrConsume(input: {
      userId: string;
      action: string;
      scope: unknown;
      confirmationToken?: string;
    }): Promise<void>;
  }
  ```

- [ ] **Step 4: Implement deployment ordering and failure preservation**

  Re-fetch the inactive draft, compute its stable fingerprint, run authoritative validation, consume confirmation, execute the smoke test with explicit data, evaluate rules without dynamic code execution, activate only on success, and leave/deactivate the workflow on any activation/test failure.

- [ ] **Step 5: Wire `deploy_and_test_workflow` through the deployment pipeline**

  Inject authenticated owner/correlation context from `dispatchTool`/`runTool`. Remove `OrchestratedToolsService.confirmationChallenges` and its duplicate confirmation methods.

- [ ] **Step 6: Verify GREEN**

  Run the focused command from Step 2. Expected: durable scope-bound confirmation and strict validate-test-activate order pass.

- [ ] **Step 7: Record a scoped checkpoint**

  Run: `git diff -- src/lib/workflow-agent/deployment-pipeline.server.ts src/lib/workflow-agent/__tests__/deployment-pipeline.server.test.ts src/lib/workflow-agent/confirmation.server.ts src/lib/workflow-agent/__tests__/confirmation.server.test.ts src/lib/orchestrated-tools.service.ts src/lib/mcp.server.ts src/lib/__tests__/orchestrated-tools.service.test.ts src/lib/__tests__/mcp-route.server.test.ts`

---

### Task 5: Trusted Partial Update And Automatic Repair

**Files:**
- Create: `src/lib/workflow-agent/repair-pipeline.server.ts`
- Create: `src/lib/workflow-agent/__tests__/repair-pipeline.server.test.ts`
- Modify: `src/lib/workflow-agent/trusted-preview.server.ts`
- Modify: `src/lib/workflow-agent/__tests__/trusted-preview.server.test.ts`
- Modify: `src/lib/workflow-agent/__tests__/mcp-partial-update.server.test.ts`
- Modify: `src/lib/orchestrated-tools.service.ts`
- Modify: `src/lib/mcp.server.ts`
- Modify: `src/lib/__tests__/orchestrated-tools.service.test.ts`

**Interfaces:**
- Consumes: recent failed executions, current workflow, `WorkflowDiffService`, authoritative validation, trusted preview store, partial update executor, deployment smoke-test executor, audit rollback writer.
- Produces: repair proposals expressed only as supported `WorkflowOperation[]`; proposal mode returns a trusted preview; confirmed mode applies selected operations, tests, and retains or rolls back.

- [ ] **Step 1: Write failing preview/repair tests**

  Cover owner/session/workflow/fingerprint/expiry checks, selected indexes, stale rejection, supported timeout/retry operations, credential/manual recommendations remaining advisory, no `_fixApplied`, no full-workflow PUT, validation before apply, confirmation before mutation, post-apply smoke test, successful retain, failed-test rollback, and rollback-failure high-severity result.

  ```ts
  expect(proposal.operations).toEqual([
    { type: "updateNode", nodeId: "HTTP", changes: { parameters: { options: { timeout: 30000 } } } },
  ]);
  expect(JSON.stringify(proposal)).not.toContain("_fixApplied");
  expect(requests.some((request) => request.method === "PUT")).toBe(false);
  ```

- [ ] **Step 2: Verify RED**

  Run: `npx vitest run src/lib/workflow-agent/__tests__/trusted-preview.server.test.ts src/lib/workflow-agent/__tests__/mcp-partial-update.server.test.ts src/lib/workflow-agent/__tests__/repair-pipeline.server.test.ts src/lib/__tests__/orchestrated-tools.service.test.ts`

  Expected: the current repair path mutates a cloned full workflow with PUT and private markers.

- [ ] **Step 3: Harden trusted preview authority**

  Persist sanitized operations, base version/fingerprint, validation summary, owner, session correlation, and expiry in call metadata. Re-fetch and compare before apply. Confirmation scope uses the trusted selected operations, never caller-replaced operations.

- [ ] **Step 4: Implement supported repair classification**

  Convert timeout and retry evidence into nested `updateNode` operations. Return auth, credential, endpoint, and unknown diagnoses as manual recommendations. Preview and validate proposed workflow before returning any apply action.

- [ ] **Step 5: Implement apply-test-rollback**

  Apply via `update_partial_workflow`, retain the before snapshot and mutation audit ID, run the deployment smoke-test path without activating unless separately requested, and use the owner-scoped rollback path only when the recorded snapshot still matches the applied mutation.

- [ ] **Step 6: Verify GREEN**

  Run the focused command from Step 2. Expected: partial update and repair tests pass without PUT/private-marker behavior.

- [ ] **Step 7: Record a scoped checkpoint**

  Run: `git diff -- src/lib/workflow-agent/repair-pipeline.server.ts src/lib/workflow-agent/__tests__/repair-pipeline.server.test.ts src/lib/workflow-agent/trusted-preview.server.ts src/lib/workflow-agent/__tests__/trusted-preview.server.test.ts src/lib/workflow-agent/__tests__/mcp-partial-update.server.test.ts src/lib/orchestrated-tools.service.ts src/lib/mcp.server.ts src/lib/__tests__/orchestrated-tools.service.test.ts`

---

### Task 6: Authoritative Metadata And Audit Outcomes

**Files:**
- Modify: `src/lib/workflow-agent/call-metadata.server.ts`
- Modify: `src/lib/workflow-agent/__tests__/call-metadata.server.test.ts`
- Modify: `src/lib/audit.server.ts`
- Modify: `src/lib/__tests__/audit.server.test.ts`
- Modify: `src/lib/__tests__/audit-wiring.test.ts`
- Modify: `src/lib/mcp-route.server.ts`
- Modify: `src/lib/__tests__/mcp-route.server.test.ts`

**Interfaces:**
- Consumes: structured creation/deployment/repair/pipeline results.
- Produces: allowlisted 64 KiB call metadata and 256 KiB audit snapshots that accurately record template, validation, preview, smoke-test, activation, repair, rollback, workflow fingerprint, selected operation indexes, and correlation IDs without secrets.

- [ ] **Step 1: Write failing metadata tests**

  Assert all required outcome fields and recursively reject keys/values for credentials, tokens, raw test payloads, auth headers, cookies, hashes, and upstream bodies. Add size-cap and circular/unsupported-value cases.

- [ ] **Step 2: Verify RED**

  Run: `npx vitest run src/lib/workflow-agent/__tests__/call-metadata.server.test.ts src/lib/__tests__/audit.server.test.ts src/lib/__tests__/audit-wiring.test.ts src/lib/__tests__/mcp-route.server.test.ts`

  Expected: current generic sanitization omits several authoritative pipeline fields and does not prove the complete allowlist.

- [ ] **Step 3: Implement explicit metadata projections**

  Build per-tool projections rather than copying arbitrary args/output. Hash test data only for confirmation scope and never log the digest if it could be confused with a reusable credential. Keep snapshots in the workflow audit table and only compact summaries in call metadata.

- [ ] **Step 4: Correct audit success semantics**

  Record draft creation, preview, applied mutation, smoke-test failure, activation success/failure, repair retain, and rollback linkage with truthful status. Never suppress a failed deployment/repair outcome merely because no mutation succeeded.

- [ ] **Step 5: Verify GREEN**

  Run the focused command from Step 2. Expected: metadata/audit tests pass and secret fixtures are absent from serialized records.

- [ ] **Step 6: Record a scoped checkpoint**

  Run: `git diff -- src/lib/workflow-agent/call-metadata.server.ts src/lib/workflow-agent/__tests__/call-metadata.server.test.ts src/lib/audit.server.ts src/lib/__tests__/audit.server.test.ts src/lib/__tests__/audit-wiring.test.ts src/lib/mcp-route.server.ts src/lib/__tests__/mcp-route.server.test.ts`

---

### Task 7: Retired Runtime Cleanup And Architecture Guards

**Files:**
- Modify: `src/lib/__tests__/architecture-guards.test.ts`
- Modify: `src/lib/__tests__/next-architecture-guards.test.ts`
- Modify: `src/lib/__tests__/single-app-architecture.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `tsconfig.json`
- Modify: `eslint.config.js`
- Modify: `vitest.config.ts`
- Modify: `Dockerfile`
- Modify: `deploy/README.md`
- Modify: `deploy/DEPLOY.md`
- Modify: active agent-facing guides identified by the failing guard
- Delete: only active retired entry/config files explicitly named by the guard and confirmed present

**Interfaces:**
- Consumes: repository filesystem and active documentation/config manifests.
- Produces: executable guards proving no active Express, TanStack Router/Start, Vite app, Cloudflare Worker, Lovable, Bun, pnpm, Turbo, retired workspace, split-domain, or non-VPS production authority remains.

- [ ] **Step 1: Write failing architecture scans**

  Scan active source/config/package/deploy/runbook surfaces with explicit allowlists for Vitest transitive references and historical specs. Test exact retired files/dependencies/scripts and executable documentation commands.

- [ ] **Step 2: Verify RED**

  Run: `npx vitest run src/lib/__tests__/architecture-guards.test.ts src/lib/__tests__/next-architecture-guards.test.ts src/lib/__tests__/single-app-architecture.test.ts`

  Expected: failures enumerate only still-active retired surfaces; already deleted dirty-worktree paths are treated as intended removals.

- [ ] **Step 3: Remove or correct each enumerated active surface**

  Preserve historical decision records. Add a superseded notice only to historical plans/guides that still look executable. Do not recreate any retired runtime or deployment target.

- [ ] **Step 4: Verify GREEN**

  Run the focused command from Step 2. Expected: all architecture guards pass.

- [ ] **Step 5: Record a scoped checkpoint**

  Run: `git diff -- package.json package-lock.json tsconfig.json eslint.config.js vitest.config.ts Dockerfile deploy/README.md deploy/DEPLOY.md src/lib/__tests__/architecture-guards.test.ts src/lib/__tests__/next-architecture-guards.test.ts src/lib/__tests__/single-app-architecture.test.ts`

---

### Task 8: Root, Knowledge MCP, Database, And Release Verification

**Files:**
- Modify if required by failures: focused source/tests from Tasks 1-7 only
- Test: all Root tests
- Test: `tools/n8n-knowledge-mcp/` tests and type check
- Test: Supabase database tests when a local database is available

**Interfaces:**
- Consumes: the completed implementation and acceptance checklist.
- Produces: fresh evidence for every release gate without weakening tests.

- [ ] **Step 1: Run focused workflow-agent regression tests**

  Run: `npx vitest run src/lib/workflow-agent src/lib/__tests__/mcp-agent-tools.test.ts src/lib/__tests__/mcp-tool-contract-parity.test.ts src/lib/__tests__/mcp-upstream.test.ts src/lib/__tests__/orchestrated-tools.service.test.ts src/lib/__tests__/audit-wiring.test.ts`

  Expected: all pass, zero failures.

- [ ] **Step 2: Run the complete Root suite**

  Run, independently:

  ```powershell
  npm test
  npm run type-check
  npm run lint
  npm run build
  ```

  Expected: each exits 0. Existing CSS parse warnings are noted but cannot hide failures.

- [ ] **Step 3: Verify the Knowledge MCP independently**

  Run:

  ```powershell
  Set-Location tools/n8n-knowledge-mcp
  npm ci
  npx.cmd --yes node@20 ./node_modules/vitest/vitest.mjs run --maxWorkers=1
  npx.cmd --yes node@20 ./node_modules/typescript/bin/tsc -p tsconfig.json
  ```

  Expected: tests and TypeScript compilation exit 0 under Node 20 with one worker.

- [ ] **Step 4: Run database contract tests if Supabase is available**

  Run: `supabase test db`

  Expected: confirmation and workflow audit contracts pass. If Docker/Supabase is unavailable, report that exact environmental blocker rather than claiming the DB gate passed.

- [ ] **Step 5: Re-read the design acceptance criteria**

  Map each acceptance criterion to a passing test or a verified deployment/config assertion. Record any gap and fix it with a new failing test before implementation.

- [ ] **Step 6: Inspect final scope**

  Run:

  ```powershell
  git status --short
  git diff --check
  git diff --stat
  ```

  Confirm unrelated staged, modified, deleted, and untracked user paths remain untouched.

---

## Self-Review

- Spec coverage: trusted Knowledge transport, canonical contracts, inactive creation, durable confirmation, smoke-test activation, trusted partial updates, repair rollback, audit metadata, retired-runtime cleanup, and all release gates each have a task.
- Completeness scan: every implementation step names a concrete behavior, command, and expected result.
- Type consistency: all pipeline tasks consume `WorkflowLike`, `WorkflowOperation`, `KnowledgeClient`, and `ConfirmationService`; `sourcePreviewCallId` exists only on apply, while preview returns the metadata later persisted by the MCP call log.
- Scope: the tasks are ordered by dependency and each ends in a focused testable checkpoint; no server-owned LLM planner, credential API, community-node execution, or Dashboard redesign is added.
