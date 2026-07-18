# n8n Workflow Agent Phase 1 Design

Date: 2026-07-06

## Purpose

The current gateway is strong at productized MCP access, user-owned n8n instances, API key handling, audit logs, and Dashboard-oriented management. Its workflow creation path is still too close to direct CRUD plus hand-built workflow JSON. Phase 1 upgrades the backend Agent behavior into an n8n workflow production pipeline that uses node knowledge, templates, validation, diff previews, and safer partial updates.

The goal is not to copy `czlonkowski/n8n-mcp`. The goal is to absorb its strongest execution strategy inside this productized gateway: templates first, node knowledge first, multi-level validation, differential updates, and operation-level safety.

## Current Context

Local project assets already include `tools/n8n-knowledge-mcp`, which exposes knowledge and validation tools such as:

- `search_nodes`
- `get_node_info`
- `get_node_essentials`
- `search_templates`
- `get_template`
- `validate_node_minimal`
- `validate_node_operation`
- `validate_workflow`
- `validate_workflow_connections`
- `validate_workflow_expressions`

The API app currently exposes base CRUD tools and orchestrated tools through:

- `apps/api/src/services/mcp.service.ts`
- `apps/api/src/services/mcp-extended.service.ts`
- `apps/api/src/services/orchestrated-tools.service.ts`
- `apps/api/src/services/orchestrated-tools.ts`

The orchestrated tools currently build common workflow JSON directly and call the user's n8n API. This works for simple cases, but it leaves the Agent without a formal template selection step, node schema confirmation, default-value risk checks, or partial-update safety.

## Non-Goals

Phase 1 will not rebuild the Dashboard into a full Agent console. It will only add backend data and response shapes that make later Dashboard panels possible.

Phase 1 will not replace all direct workflow construction with a complete natural-language planner. Existing orchestrated tools should keep working, with a safer pipeline around them and template-first behavior where template data is available.

Phase 1 will not depend on external network access at runtime for node knowledge. The local knowledge database or local knowledge service remains the source of truth.

## Architecture

### Services

Add three backend services under `apps/api/src/services/`:

`node-knowledge.service.ts`

Provides a stable API-facing wrapper around local n8n node knowledge. It should support node search, node essentials, and node-level validation without requiring callers to understand the internal `tools/n8n-knowledge-mcp` server implementation.

`template.service.ts`

Provides template search and template retrieval. It should handle an empty template database cleanly and return a structured "no suitable template" result instead of throwing for normal misses.

`workflow-validation.service.ts`

Coordinates node-level validation, workflow-level validation, connection checks, expression checks, and local gateway rules such as "Never Trust Defaults". It should return structured validation results that can be surfaced in MCP responses, audit logs, and later Dashboard UI.

### Tool Registration

Extend `MCPServiceExtended.listTools()` with knowledge tools:

- `search_nodes`
- `get_node`
- `validate_node`
- `search_templates`
- `get_template`

These are read-only except `validate_node`, which is also read-only in effect because it analyzes input and does not mutate n8n state.

Add mutation-support tools:

- `preview_workflow_diff`
- `update_partial_workflow`

`preview_workflow_diff` is read-only. `update_partial_workflow` is mutating and must route through validation, audit, and safety checks.

### Orchestrated Tool Pipeline

Each existing orchestrated creation tool should use the same high-level pipeline:

```text
intent parameters
-> search templates
-> use best template if confidence is high enough
-> otherwise discover required nodes
-> build or adapt workflow draft
-> validate each important node
-> validate workflow connections and expressions
-> run local gateway default-value risk checks
-> create inactive workflow
-> activate only if requested and validation passed
-> audit template, validation, and deployment metadata
```

The six existing orchestrated tools remain public:

- `create_scheduled_workflow`
- `create_webhook_workflow`
- `create_email_workflow`
- `create_ai_chatbot_workflow`
- `deploy_and_test_workflow`
- `fix_workflow_errors`

If template search fails or the template database is empty, the tool falls back to current hand-built workflow behavior, then still passes the draft through validation before deployment.

## Workflow Diff And Partial Update

Add shared operation types in `packages/types/src/` and use them from API services. The initial operation set should be intentionally small:

```json
[
  { "type": "updateNode", "nodeId": "node-id", "changes": {} },
  { "type": "addNode", "node": {} },
  { "type": "removeNode", "nodeId": "node-id" },
  {
    "type": "addConnection",
    "source": "source-node",
    "target": "target-node",
    "sourcePort": "main",
    "targetPort": "main",
    "sourceIndex": 0,
    "targetIndex": 0
  },
  { "type": "removeConnection", "source": "source-node", "target": "target-node" },
  { "type": "cleanStaleConnections" }
]
```

`preview_workflow_diff` should:

- Fetch the current workflow.
- Apply operations to an in-memory copy.
- Return a structured summary of changed nodes, changed connections, risk level, and validation results.
- Never call n8n update endpoints.

`update_partial_workflow` should:

- Fetch the current workflow.
- Create a backup snapshot for audit.
- Apply operations to an in-memory copy.
- Validate the updated workflow.
- Refuse mutation when validation fails unless the caller explicitly requests a draft-only update and the workflow remains inactive.
- Patch the workflow only after validation and safety checks pass.
- Write audit entries with before snapshot, after snapshot, operations, validation result, and risk metadata.

## Validation Rules

The validation layer should combine local knowledge validation with product safety rules.

### Never Trust Defaults

Flag or reject workflow drafts where runtime-critical behavior is left implicit. Phase 1 should cover these cases:

- Webhook nodes must explicitly set HTTP method, path or documented generated path behavior, response mode, and response behavior.
- HTTP Request nodes must explicitly set method, URL, authentication mode, timeout or retry policy when relevant, and body/query/header modes.
- Email nodes must explicitly set recipient, subject, body/message, and credential requirements.
- IF/Switch-style nodes must explicitly declare conditions and branch behavior.
- Merge-style nodes must explicitly declare merge mode.
- AI or LLM-related nodes must explicitly declare model/provider, credential reference, system prompt when applicable, and tool/memory behavior when applicable.
- Nodes that require credentials must not accept raw secrets in node parameters when a credential reference is expected.

Validation failures should block deployment. Warnings may allow draft creation but should block automatic activation.

## Security And Permissions

Phase 1 should prepare operation-level policy without requiring a full permissions UI.

Add backend policy checks for:

- Read-only mode for API keys or workspace context when such metadata is available.
- Disabled tools by name.
- Disabled operations within `update_partial_workflow`.
- Confirmation requirement for active production workflows.
- Automatic backup snapshot before update or delete operations.

Where the current data model does not yet store these settings, implement the service boundary and default policy behavior. Defaults should preserve existing functionality while making stricter policy easy to enable later.

## Audit And Observability

Extend audit metadata for workflow-producing tools with:

- `templateId` when a template is used.
- `templateConfidence` when available.
- `validationResult`.
- `diffOperations` for partial updates.
- `riskLevel`.
- `activated` boolean.
- `fallbackReason` when template-first falls back to direct construction.

The initial Dashboard does not need to render these fields, but API responses should include enough information for a future validation panel, diff preview, tool timeline, and rollback view.

## Error Handling

Knowledge lookup failures should not crash orchestrated creation if a safe fallback exists. They should produce `fallbackReason` and continue to existing construction logic.

Validation failures should return structured errors and not deploy or activate workflows.

Partial update conflicts, missing nodes, malformed operations, and stale connections should fail before mutation.

n8n API failures should preserve current error handling behavior, with clearer messages where the failure happens after validation but before audit logging.

## Testing

Add or update tests for:

- Knowledge tools are registered and marked read-only.
- `search_nodes`, `get_node`, `validate_node`, `search_templates`, and `get_template` return stable response envelopes.
- Orchestrated tools still work when the template database is empty.
- Template-first path records `templateId` and validation metadata when a template is found.
- Validation failure prevents activation.
- `preview_workflow_diff` does not call n8n mutation endpoints.
- `update_partial_workflow` only mutates intended nodes and connections.
- Active workflow updates require confirmation or policy approval.
- Audit logs receive before/after snapshots and operation metadata.

## Rollout Plan

1. Add shared types for knowledge responses, validation results, and workflow operations.
2. Add service wrappers for node knowledge, templates, validation, and operation policy.
3. Register read-only knowledge tools in `mcp-extended.service.ts`.
4. Add `preview_workflow_diff` and `update_partial_workflow`.
5. Wrap orchestrated creation tools with template-first and validation-first behavior.
6. Add tests around registration, validation blocking, fallback behavior, partial updates, and audit metadata.
7. Run type checks and targeted Vitest suites.

## Acceptance Criteria

Phase 1 is complete when:

- The API exposes the five knowledge tools and two diff/update tools.
- Existing orchestrated tools preserve their public names and basic behavior.
- Orchestrated creation attempts template search first and records fallback when no template is available.
- Workflow drafts are validated before creation or activation.
- Runtime-critical defaults are flagged by the local validation layer.
- Partial update preview is available without mutating n8n.
- Partial update mutation records before/after audit data.
- Tests cover the new behavior and existing orchestrated tests continue to pass.
