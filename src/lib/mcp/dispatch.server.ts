// dispatchTool: routes one MCP tool call to the knowledge cache, instance
// administration, audit/rollback handlers, runTool or the upstream proxy, and
// runs the mutation audit hook (server-only).
import {
  callUpstreamTool,
  categorize,
  isManagementTool,
  isUpstreamConfigured,
  type CallerCtx,
} from "@/lib/mcp-upstream.server";
import { strId } from "./args";
import {
  AUDIT_READ_TOOLS,
  MUTATION_DESCRIPTORS,
  fetchSnapshotSafe,
  handleAuditReadTool,
  recordMutationAudit,
  shouldRecordMutationAudit,
} from "./audit-tools.server";
import { requireConfirmation } from "./confirmation.server";
import { n8n } from "./n8n-client.server";
import { ORCHESTRATED_TOOL_NAMES, parseOrchestratedToolArgs } from "./orchestrated-args";
import {
  assertRollbackAllowed,
  handleRollback,
  precheckRollback,
  rollbackRequest,
} from "./rollback.server";
import { runTool } from "./run-tool.server";
import { KNOWLEDGE_TOOL_MAP, LOCAL_NAMES } from "./tool-catalog.server";
import type { N8nInstance, ToolContext } from "./types";

type Inst = N8nInstance;

const AGENT_READ_TOOLS = new Set<string>(["validate_node"]);
const AGENT_INSTANCE_TOOLS = new Set<string>(["preview_workflow_diff", "update_partial_workflow"]);

export type DispatchResult = {
  output: unknown;
  upstream: boolean;
  category: "local" | "knowledge" | "management";
  needsInstance: boolean;
};

async function validateWorkflowViaUpstream(args: Record<string, unknown>): Promise<unknown> {
  if (!args.workflow || typeof args.workflow !== "object") {
    throw new Error("workflow (object) is required");
  }
  // Delegate to upstream knowledge base for validation
  if (!isUpstreamConfigured()) {
    throw new Error("Knowledge base is not configured; cannot validate workflow.");
  }
  return callUpstreamTool("validate_workflow", { workflow: args.workflow }, null, {
    source: "validate_workflow",
  });
}

/**
 * The caller's n8n instance, or a loader that fetches (and decrypts) it.
 * dispatchTool calls a loader at most once, and only for tools that need an
 * instance, so knowledge, audit-read and validation tools never touch the
 * instance row or its secrets.
 */
export type InstanceSource = Inst | null | (() => Promise<Inst | null>);

/**
 * Route a tool call to local handler or upstream proxy.
 * An instance is required for local tools and for upstream `n8n_*` management
 * tools; upstream knowledge tools work without it.
 */
export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  instanceSource: InstanceSource,
  caller?: CallerCtx & ToolContext,
): Promise<DispatchResult> {
  let pending: Promise<Inst | null> | undefined;
  const loadInstance = (): Promise<Inst | null> =>
    (pending ??=
      typeof instanceSource === "function" ? instanceSource() : Promise.resolve(instanceSource));
  const upstreamKnowledgeTool = KNOWLEDGE_TOOL_MAP[name as keyof typeof KNOWLEDGE_TOOL_MAP];
  if (upstreamKnowledgeTool) {
    if (!isUpstreamConfigured()) {
      throw new Error(
        `Knowledge tool ${name} is unavailable because the upstream knowledge MCP is not configured`,
      );
    }
    const { cachedKnowledgeCall } = await import("@/lib/knowledge-cache.server");
    const output = await cachedKnowledgeCall(upstreamKnowledgeTool, args, () =>
      callUpstreamTool(upstreamKnowledgeTool, args, null, caller),
    );
    return { output, upstream: true, category: "knowledge", needsInstance: false };
  }

  // Instance administration over the Public API (credentials metadata,
  // projects, folders, tags, data tables, executions, security audit).
  const { ADMIN_TOOL_NAMES, runAdminTool } = await import("@/lib/n8n-admin.server");
  if (ADMIN_TOOL_NAMES.has(name)) {
    const inst = await loadInstance();
    if (!inst) return { output: null, upstream: false, category: "local", needsInstance: true };
    const output = await runAdminTool(
      name,
      args,
      (path, init) => n8n(inst, path, init),
      (operation, scope) =>
        requireConfirmation(args, operation, { requireToken: true, scope }, caller),
    );
    return { output, upstream: false, category: "local", needsInstance: false };
  }
  if (name === "autofix_workflow") {
    const inst = await loadInstance();
    if (!inst) return { output: null, upstream: false, category: "local", needsInstance: true };
    const { OrchestratedToolsService } = await import("@/lib/orchestrated-tools.service");
    const service = new OrchestratedToolsService(inst);
    const output = await service.callTool(
      "fix_workflow_errors",
      { workflowId: args.workflowId },
      caller,
    );
    return { output, upstream: false, category: "local", needsInstance: false };
  }

  // Native n8n MCP tools (instance-level MCP token required).
  if (name === "resolve_node_options") {
    const inst = await loadInstance();
    if (!inst) return { output: null, upstream: false, category: "local", needsInstance: true };
    const { resolveNodeOptions } = await import("@/lib/n8n-native-tools.server");
    return {
      output: await resolveNodeOptions(inst, args),
      upstream: false,
      category: "local",
      needsInstance: false,
    };
  }
  if (name === "get_workflow_history" && (args.source === "native" || args.source === "both")) {
    const inst = await loadInstance();
    if (!inst) return { output: null, upstream: false, category: "local", needsInstance: true };
    const workflowId = String(args.workflowId ?? "").trim();
    if (!workflowId) throw new Error("workflowId is required");
    const { nativeWorkflowHistory } = await import("@/lib/n8n-native-tools.server");
    const native = await nativeWorkflowHistory(inst, workflowId, Number(args.limit ?? 20));
    const output =
      args.source === "both"
        ? {
            workflowId,
            source: "both",
            local: await handleAuditReadTool(name, args, caller?.user_id),
            native,
          }
        : { workflowId, source: "native", native };
    return { output, upstream: false, category: "local", needsInstance: false };
  }

  // Audit read tools resolve from the audit log and need only the caller's id.
  if (AUDIT_READ_TOOLS.has(name)) {
    const output = await handleAuditReadTool(name, args, caller?.user_id);
    return { output, upstream: false, category: "local", needsInstance: false };
  }
  // Rollback re-applies a prior snapshot, so it also needs an n8n instance.
  if (name === "rollback_workflow") {
    const inst = await loadInstance();
    if (!inst) {
      return { output: null, upstream: false, category: "local", needsInstance: true };
    }
    const { userId, auditLogId, force } = rollbackRequest(args, caller);
    // Read-only precheck before confirmation: a conflicting rollback is
    // reported without consuming the confirmation token or asking the user
    // (elicitation), so the client is not asked to confirm twice. A changed or
    // unverifiable workflow proceeds only with force; instance_mismatch never.
    const precheck = await precheckRollback(inst, userId, auditLogId);
    assertRollbackAllowed(precheck, force);
    await requireConfirmation(
      args,
      "Rollback workflow",
      {
        requireToken: true,
        // A forced rollback overwrites newer edits, so it needs its own token.
        scope:
          args.force === true
            ? { auditLogId: args.auditLogId, force: true }
            : { auditLogId: args.auditLogId },
      },
      caller,
    );
    const output = await handleRollback(args, inst, caller, precheck);
    return { output, upstream: false, category: "local", needsInstance: false };
  }

  if (name === "validate_workflow") {
    const output = await validateWorkflowViaUpstream(args);
    return { output, upstream: false, category: "local", needsInstance: false };
  }

  if (AGENT_READ_TOOLS.has(name)) {
    // validate_node never reads the instance: do not load it.
    const known = typeof instanceSource === "function" ? null : instanceSource;
    const output = await runTool(known ?? ({} as Inst), name, args, caller);
    return { output, upstream: false, category: "local", needsInstance: false };
  }

  if (AGENT_INSTANCE_TOOLS.has(name)) {
    const inst = await loadInstance();
    if (!inst) {
      return { output: null, upstream: false, category: "local", needsInstance: true };
    }

    const desc = MUTATION_DESCRIPTORS[name];
    let before: unknown = null;
    if (name !== "update_partial_workflow" && desc?.captureBefore && caller?.user_id) {
      const beforeId = strId(args.id) ?? strId(args.workflowId);
      if (beforeId) before = await fetchSnapshotSafe(inst, beforeId);
    }

    const output = await runTool(inst, name, args, caller);
    if (desc && caller?.user_id && shouldRecordMutationAudit(name, output)) {
      await recordMutationAudit(name, desc, args, output, before, inst, caller);
    }
    return { output, upstream: false, category: "local", needsInstance: false };
  }

  if (LOCAL_NAMES.has(name)) {
    const inst = await loadInstance();
    if (!inst) {
      return {
        output: null,
        upstream: false,
        category: "local",
        needsInstance: true,
      };
    }
    const dispatchArgs = ORCHESTRATED_TOOL_NAMES.has(name)
      ? parseOrchestratedToolArgs(name, args)
      : args;
    if (name === "update_workflow") {
      const structuralFields = [
        "nodes",
        "connections",
        "settings",
        "staticData",
        "tags",
        "active",
      ].filter((field) => args[field] !== undefined);
      if (structuralFields.length > 0) {
        throw new Error(
          `update_workflow no longer accepts structural workflow fields (${structuralFields.join(
            ", ",
          )}). Use preview_workflow_diff and update_partial_workflow instead.`,
        );
      }
    }
    const desc = MUTATION_DESCRIPTORS[name];
    let before: unknown = null;
    if (desc?.captureBefore && caller?.user_id) {
      const beforeId = strId(dispatchArgs.id) ?? strId(dispatchArgs.workflowId);
      if (beforeId) before = await fetchSnapshotSafe(inst, beforeId);
    }
    const out = await runTool(inst, name, dispatchArgs, caller);
    if (desc && caller?.user_id) {
      await recordMutationAudit(name, desc, dispatchArgs, out, before, inst, caller);
    }
    return { output: out, upstream: false, category: "local", needsInstance: false };
  }

  if (!isUpstreamConfigured()) {
    throw new Error(
      `Unknown tool: ${name} (upstream knowledge base is not configured on this gateway)`,
    );
  }

  const management = isManagementTool(name);
  const inst = management ? await loadInstance() : null;
  if (management && !inst) {
    return {
      output: null,
      upstream: true,
      category: "management",
      needsInstance: true,
    };
  }

  const out = await callUpstreamTool(
    name,
    args,
    management && inst ? { base_url: inst.base_url, api_key: inst.api_key } : null,
    caller,
  );
  return {
    output: out,
    upstream: true,
    category: categorize(name),
    needsInstance: false,
  };
}
