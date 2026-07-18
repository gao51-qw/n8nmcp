# Workflow Agent Production Loop Design

**Date:** 2026-07-17

**Status:** Approved for implementation planning

## Goal

Connect the existing workflow-agent capabilities into one production-safe backend loop in the Root Next.js application. The loop must use the local Knowledge MCP for template and node knowledge, create inactive drafts, require durable confirmation before consequential actions, test before activation, record authoritative audit metadata, and remove active remnants of the retired application frameworks.

This design does not add an autonomous LLM planner. The calling MCP client continues to interpret natural-language intent. The server owns the deterministic production pipeline and enforces it consistently for every client.

## Active Architecture

The Root Next.js application under `src/` is the only product application and the only public MCP gateway. Shared workflow-agent behavior remains under `src/lib/`. The separately built `tools/n8n-knowledge-mcp/` package remains the authoritative local source for node metadata, templates, and knowledge validation.

The production path is:

```text
MCP client
  -> Root Next.js MCP route
  -> server-owned workflow-agent pipeline
  -> authenticated Knowledge MCP for knowledge and validation
  -> user-owned n8n instance for draft creation, testing, and activation
  -> Supabase for durable confirmation, call metadata, and workflow audit
```

No Express application, TanStack Router application, Vite application, Cloudflare Worker, or retired workspace package participates in this path.

## Scope

### Included

- Correct the public MCP contracts for preview, partial update, confirmation, and orchestrated tools.
- Make the internal Knowledge MCP reachable through the production Docker network without weakening protection for user-controlled outbound URLs.
- Route orchestrated creation through template search, node knowledge, node validation, workflow validation, inactive draft creation, and structured audit metadata.
- Centralize confirmation in the existing durable confirmation service.
- Separate creation from activation and require a successful smoke test before activation.
- Replace the unsafe automatic-fix mutation path with previewed partial operations and rollback metadata.
- Remove active references, configuration, tests, and instructions that still treat retired frameworks or workspace paths as runnable architecture.
- Add contract, unit, integration, deployment-contract, and architecture-guard tests for the completed loop.

### Excluded

- A server-owned LLM planner, conversation memory, reflection loop, or autonomous goal scheduler.
- A new credential-management API or automatic creation of n8n credentials.
- Community-node installation or execution.
- A redesign of the Dashboard Agent Console.
- Deleting historical design records solely because they mention an old architecture.

## Knowledge Boundary

### Trusted internal transport

`UPSTREAM_N8N_MCP_URL` and `UPSTREAM_N8N_MCP_TOKEN` are operator-controlled server configuration. The app may call the exact configured Knowledge MCP origin over the Docker network. This exception is limited to the fixed configured origin and is never applied to a URL supplied through an MCP tool argument, workflow node, template, request header, or database row.

User-controlled outbound URLs continue through `src/lib/ssrf-guard.server.ts` and retain public-address validation, redirect rejection, and timeout enforcement. The internal Knowledge MCP client uses a dedicated trusted-service transport with an exact URL/origin check, bearer authentication, response size limits, timeouts, and safe error messages.

### Authoritative knowledge use

The pipeline uses Knowledge MCP for:

- template search and template retrieval;
- node search and node essentials;
- operation-specific node validation;
- workflow, connection, and expression validation.

The small Root node registry remains a compiler aid for supported blueprint and fallback builders. It is not presented as complete node knowledge and cannot independently authorize automatic activation.

If Knowledge MCP is unavailable, a creation tool may build an inactive draft only when every node comes from the reviewed local registry. The response records degraded mode and the knowledge failure. Degraded drafts cannot be automatically tested or activated until authoritative knowledge validation succeeds.

## Canonical Tool Contracts

Public tool descriptors and runtime parsers must share the same field names, required fields, supported enum values, and confirmation semantics. Contract tests compare every advertised destructive tool with its runtime requirements.

Required corrections include:

- `preview_workflow_diff` accepts `workflowId`, `operations`, and optional policy data. It does not accept or require `sourcePreviewCallId`.
- `update_partial_workflow` requires `workflowId`, `operations`, and `sourcePreviewCallId`; it supports selected preview operation indexes, `confirm`, and `confirmationToken`.
- Token-gated orchestrated tools advertise `confirmationToken`.
- Unsupported scheduled actions, email triggers, AI providers, and chatbot platforms are removed from public enums until their implementations and tests exist.
- Creation tools keep the existing `activate` field for compatibility, but the field records activation intent rather than bypassing the deployment gate.

Invalid input fails before any n8n or Supabase mutation. Error responses identify the invalid field without returning credentials, raw upstream bodies, workflow snapshots, or confirmation hashes.

## Creation Pipeline

All orchestrated creation tools use one injected pipeline rather than constructing and deploying independently.

```text
normalize intent
  -> search templates
  -> load and sanitize a compatible template, or select a reviewed local builder
  -> resolve node essentials for every node type
  -> validate each node operation
  -> validate workflow structure, connections, expressions, and local safety rules
  -> create an inactive n8n draft
  -> record template, validation, fallback, and draft metadata
  -> return the draft and the next required deployment action
```

A template is usable only when its workflow body passed the Knowledge MCP ingestion security gate and its trigger/action pattern is compatible with the requested orchestrated tool. The pipeline never executes template expressions or code during selection. Template incompatibility is a normal structured fallback, not an exception.

Validation errors prevent creation. Warnings permit inactive draft creation but block activation. A clean result permits the caller to enter the deployment pipeline; it does not activate during creation.

## Deployment And Activation Pipeline

`deploy_and_test_workflow` is the only orchestrated activation path.

```text
load current inactive draft
  -> authoritative knowledge validation
  -> issue or consume durable confirmation bound to user and action scope
  -> execute smoke test with explicit test data
  -> evaluate explicit output rules
  -> activate only after successful test
  -> record deployment and test outcome
```

Confirmation scope includes the user, workflow ID, workflow version or fingerprint, test data digest, validation rules, and requested activation. Tokens expire after five minutes and are single-use. Elicitation-capable clients use the same server-owned confirmation boundary; non-elicitation clients use the two-request token flow.

Missing test data, validation warnings, stale workflow state, failed output rules, execution errors, or n8n activation errors leave the workflow inactive. The response explains the next safe action.

## Partial Update And Repair Pipeline

The trusted preview record remains the authority for partial updates. Preview records include sanitized operations, base version or fingerprint, validation, and owner/session correlation. Apply re-fetches the workflow and rejects stale or cross-user previews.

`fix_workflow_errors` becomes a repair proposal flow:

```text
read recent failed executions
  -> classify evidence
  -> produce supported WorkflowOperation proposals
  -> preview operations against the current workflow
  -> validate the proposed result
  -> return a trusted preview
  -> confirmed partial update
  -> smoke test
  -> retain update on success or apply recorded rollback on failure
```

The repair path never adds private marker properties such as `_fixApplied`, never writes a complete workflow with an unvalidated PUT, and never claims an advisory action such as credential configuration was applied automatically. Unsupported diagnoses remain explicit manual recommendations.

## Confirmation And Policy

All mutations use the shared confirmation service created by the MCP server and backed by `workflow_confirmation_challenges`. Orchestrated service instances do not own confirmation maps or tokens.

The server enforces read-only mode, disabled tools, disabled operations, active-production confirmation, preview ownership, and stale-version rejection. Caller-supplied policy can only make execution more restrictive; it cannot weaken server policy.

Inactive draft creation is permitted without a confirmation token. Execution, activation, destructive patches, partial updates, rollback, and automatic repair require the configured confirmation level.

## Audit And Observability

The authoritative call and audit records include only allowlisted, size-capped metadata:

- MCP session and request correlation;
- selected template ID, source, confidence, and fallback reason;
- node types and validation summaries;
- workflow validation, risk, and activation eligibility;
- trusted preview call ID and selected operation indexes;
- workflow version or fingerprint;
- smoke-test status and output-rule summary;
- activation outcome;
- before/after snapshots and rollback linkage for mutations.

Credentials, authorization headers, cookies, confirmation tokens and hashes, raw test payloads containing secrets, and unsanitized upstream responses are never written to call metadata.

## Retired Framework Cleanup

The cleanup targets active architecture surfaces, not arbitrary historical text.

The implementation removes or corrects:

- runnable source and entry files from retired Express, TanStack Router/Start, Vite, Cloudflare Worker, Lovable, and workspace layouts;
- active imports, scripts, dependencies, lockfiles, exclusions, aliases, and build settings that support those retired runtimes;
- deployment instructions that describe Vercel, Cloudflare Worker, legacy Express, split application domains, or retired `apps/*` and `packages/*` build commands as current production authority;
- current agent plans or guides that direct implementers to `apps/api`, pnpm, Bun, Turborepo, or other retired paths;
- duplicate MCP or workflow-agent implementations outside `src/lib/` and `tools/n8n-knowledge-mcp/`;
- stale generated files that are no longer inputs to the Root Next.js build.

Historical specifications and plans remain available when they document past decisions. Any historical document likely to be executed by an agent receives a prominent superseded notice that points to this design and the new implementation plan. Dependency-only transitive references, such as Vite used internally by Vitest, are not treated as an active Vite application.

Architecture guards assert that the retired runtime trees, entry files, direct framework dependencies, active documentation instructions, and deployment paths do not return.

## Error Handling

- Knowledge network or authentication failures return a structured degraded result for safe inactive draft creation, or block validation/deployment when authoritative knowledge is required.
- Template misses fall back normally and record the reason.
- Node or workflow validation errors block mutation.
- Validation warnings allow drafts but block activation.
- Confirmation challenges return a stable confirmation-required response and are safe to retry.
- Stale preview or workflow versions require a new preview.
- Test or activation failures preserve the inactive workflow and audit the failure.
- Repair post-apply failures trigger rollback when the recorded before snapshot is still applicable; rollback failure is reported as a high-severity operational error without falsifying audit state.

## Testing Strategy

Implementation follows test-driven development. Each behavior begins with a failing regression or contract test.

### Root application

- Tool-schema/runtime parity tests.
- Confirmation tests covering cross-request consumption, expiry, replay, scope mismatch, and non-elicitation clients.
- Knowledge-client tests for exact trusted origin, token handling, timeout, response limits, and safe errors.
- Creation-pipeline tests for template selection, template fallback, per-node validation, degraded mode, inactive-only creation, and audit metadata.
- Deployment tests for validation, confirmation, smoke-test requirements, output rules, activation, and failure preservation.
- Partial-update and repair tests for trusted preview ownership, selected operations, stale versions, supported proposals, testing, and rollback.
- Architecture guards for all retired framework surfaces.

### Knowledge MCP

- Existing Node 20, single-worker test and type-check suites remain mandatory.
- Add only the compatibility tests required by the Root knowledge client contract.

### Integration and release gates

- A local Docker contract test proves the app can call `http://mcp:3000/mcp` through the trusted-service transport while user-controlled private URLs remain blocked.
- The complete Root test suite, type check, lint, and standalone build run before completion.
- Knowledge MCP tests and TypeScript compilation run independently with Node 20 and `--maxWorkers=1`.
- Existing unrelated failing tests are repaired or reported with exact evidence; no gate is weakened or skipped.

## Migration And Compatibility

No retired runtime is restored during migration. Existing public tool names remain stable. Supported parameters retain their meanings except that creation-time `activate: true` no longer activates directly; responses make this compatibility change explicit and provide the required deployment action.

No database migration is expected unless implementation inspection proves the existing durable confirmation or audit schema lacks a required invariant. Any necessary database change must be additive, include a Supabase migration, generated types, and database tests.

## Acceptance Criteria

- Production Knowledge MCP calls succeed through the Docker-internal configured origin without allowing arbitrary private-network fetches.
- Orchestrated creation performs template and node knowledge lookup, authoritative validation, and inactive draft creation through one shared pipeline.
- Knowledge degradation never leads to automatic testing or activation.
- Public tool schemas match runtime parsing and supported behavior.
- Confirmation tokens survive across MCP requests, are scope-bound, expire, and cannot be replayed.
- Creation never activates a workflow directly.
- Deployment requires clean validation, durable confirmation, explicit smoke-test data, passing output rules, and successful n8n activation.
- Partial updates require a current owner-scoped trusted preview.
- Automatic repair uses supported partial operations, validates and tests the result, and rolls back failed repairs when safe.
- Audit and call metadata accurately describe template, validation, preview, test, activation, repair, and rollback outcomes without storing secrets.
- Active retired-framework source, configuration, dependencies, deployment authority, and executable documentation instructions are absent.
- Root and Knowledge MCP verification gates pass with no weakened tests.

