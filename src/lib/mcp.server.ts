// MCP Streamable HTTP gateway helpers (server-only): public facade.
//
// The implementation lives in src/lib/mcp/; this module re-exports its public
// surface unchanged. Code outside src/lib/mcp/ (route handlers, the dashboard
// agent console, support tooling) and tests that vi.mock("@/lib/mcp.server")
// must keep importing from here, never from the submodules, so a mock of this
// facade still covers them. Modules inside src/lib/mcp/ import each other
// directly.
//
// Module map:
//   mcp/types.ts                    shared types (AuthedKey, ToolContext, N8nInstance)
//   mcp/auth.server.ts              bearer authentication and effective tier
//   mcp/quota.server.ts             short-window limiter, daily quota, recordCall
//   mcp/instance.server.ts          default instance loading and decryption
//   mcp/n8n-client.server.ts        n8n Public API client (SSRF-guarded)
//   mcp/args.ts, orchestrated-args  fail-closed argument parsers
//   mcp/fingerprint.ts              stable serialization and workflow fingerprints
//   mcp/confirmation.server.ts      elicitation and confirmation tokens
//   mcp/services.server.ts          workflow-agent service and Knowledge client singletons
//   mcp/partial-update.server.ts    preview_workflow_diff and update_partial_workflow
//   mcp/audit-tools.server.ts       mutation descriptors, audit hook, audit read tools
//   mcp/rollback.server.ts          rollback precheck and restore
//   mcp/run-tool.server.ts          runTool (local tool implementations)
//   mcp/tool-catalog.server.ts      advertised tool list
//   mcp/dispatch.server.ts          dispatchTool (routing and audit wiring)

export type { AuthedKey, N8nInstance, NativeInstanceMcp, ToolContext } from "./mcp/types";
export { authenticateBearer, effectiveTier } from "./mcp/auth.server";
export {
  checkDailyQuota,
  checkShortWindowQuota,
  recordCall,
  releaseDailyQuota,
  reserveDailyQuota,
  shortWindowAllow,
  type CallUsage,
} from "./mcp/quota.server";
export { getDefaultInstance } from "./mcp/instance.server";
export { ElicitationRequiredError } from "./mcp/confirmation.server";
export { runTool } from "./mcp/run-tool.server";
export { LOCAL_TOOLS, TOOLS } from "./mcp-tool-definitions";
export { KNOWLEDGE_TOOL_MAP, getMergedTools } from "./mcp/tool-catalog.server";
export { shouldRecordMutationAudit } from "./mcp/audit-tools.server";
export {
  assessRollback,
  type RollbackAssessment,
  type RollbackPrecheckConflict,
} from "./mcp/rollback.server";
export { dispatchTool, type DispatchResult, type InstanceSource } from "./mcp/dispatch.server";
