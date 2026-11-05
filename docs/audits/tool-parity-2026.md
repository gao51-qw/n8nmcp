# Tool parity with czlonkowski/n8n-mcp

Date: 2026-11-05. Compared with the tool list in czlonkowski/n8n-mcp's README (7 core and 21 management tools). Roadmap Phase 5.

Status: ✅ equivalent · ◐ partial · ⛔ deliberately not offered · ✗ missing

## Core (knowledge) tools

| czlonkowski | n8n-mcp gateway | Status | Notes |
|---|---|---|---|
| `tools_documentation` | upstream `tools_documentation` (merged into `tools/list`) | ✅ | Served by the Knowledge MCP |
| `search_nodes` | `search_nodes` | ✅ | Includes community nodes with `trust_level` (verified / parsed) |
| `get_node` | `get_node` | ✅ | |
| `validate_node` | `validate_node` | ✅ | Warns for unreviewed community nodes |
| `validate_workflow` | `validate_workflow` | ✅ | Plus local safety validation |
| `search_templates` | `search_templates` | ✅ | |
| `get_template` | `get_template` | ✅ | |

## n8n management tools

| czlonkowski | n8n-mcp gateway | Status | Notes |
|---|---|---|---|
| `n8n_create_workflow` | `create_workflow`, `create_workflow_from_blueprint`, `create_*_workflow` | ✅ | Creation pipeline validates against Knowledge first |
| `n8n_get_workflow` | `get_workflow` | ✅ | |
| `n8n_update_full_workflow` | `update_workflow` | ✅ | PUT with writable fields only |
| `n8n_update_partial_workflow` | `preview_workflow_diff` → `update_partial_workflow` | ✅ | Partial updates must name a recorded preview |
| `n8n_delete_workflow` | `delete_workflow` | ✅ | Confirmation required, audited |
| `n8n_list_workflows` | `list_workflows` | ✅ | |
| `n8n_validate_workflow` (by id) | `get_workflow` + `validate_workflow` | ◐ | No single by-id call |
| `n8n_autofix_workflow` | `autofix_workflow`, `fix_workflow_errors` | ⛔ apply / ✅ propose | Proposes WorkflowOperations from failed executions. Applying goes through `preview_workflow_diff` → `update_partial_workflow`; the safety sequence in AGENTS.md rules out a one-step apply |
| `n8n_workflow_versions` | `get_workflow_history` (`local` / `native` / `both`), `rollback_workflow` | ◐ | Version diffs (n8n `get_workflow_versions_diff`) are not exposed yet |
| `n8n_deploy_template` | `import_workflow_template` | ✅ | |
| `n8n_explore_node_resources` | `resolve_node_options` | ✅ | Needs the instance-level MCP token |
| `n8n_test_workflow` | `execute_workflow`, `deploy_and_test_workflow` | ✅ | Native manual run of drafts when a token is stored; webhook otherwise |
| `n8n_executions` | `list_executions`, `get_execution`, `delete_execution` | ✅ | Delete asks for confirmation |
| `n8n_evaluations` | — | ✗ | Not started |
| `n8n_manage_folders` | `manage_folders` | ◐ | List, create, rename, delete. Moving between folders is not offered |
| `n8n_manage_datatable` | `manage_data_table` | ◐ | List tables, list / insert / delete rows. Creating tables and managing columns are not offered |
| `n8n_manage_credentials` | `list_credentials`, `get_credential_schema` | ⛔ writes | Read-only metadata and type schemas. Creating or changing credentials through an AI client stays out of scope |
| `n8n_audit_instance` | `audit_instance` | ✅ | n8n security audit report |
| `n8n_manage_agents` | — | ⛔ for now | n8n Agents are in preview |
| `n8n_health_check` | — | ✗ | The dashboard checks connectivity when an instance is added; no MCP tool |
| `n8n_list_catalog` | `list_projects`, `manage_tags` (`list`) | ✅ | |

## Only in this gateway

- Workflow graph analysis and review: `analyze_workflow_graph`, `summarize_workflow_modules`, `summarize_workflow_semantic_modules`, `infer_workflow_business_intent`, `create_workflow_review_batches`, `audit_expression_dependencies`.
- Patch and simplification proposals with validation and rollback: `propose_workflow_patch`, `preview_workflow_patch`, `safe_apply_workflow_patch`, `propose_workflow_simplification`, `preview_workflow_simplification`, `safe_apply_workflow_simplification`.
- Audit trail and analysis: `get_workflow_history` with snapshots, `rollback_workflow`, `get_audit_statistics`, `detect_suspicious_activity`.
- Multi-tenant hosting: per-user keys, OAuth 2.1, quotas, scope checks per tool, encrypted instance secrets, SSRF-guarded outbound calls.

## Remaining gaps

`n8n_evaluations`, a health-check tool, folder moves, data-table schema management and version diffs. Credential writes and n8n Agents are left out on purpose.
