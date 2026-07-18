// MCP Streamable HTTP gateway helpers (server-only).
// Auth: Bearer nmcp_<...> from `Authorization` header → SHA-256 → platform_api_keys lookup.
// Rate limit: database-backed short-window limiter + daily quota check via usage_daily.
import { createHash, randomBytes } from "node:crypto";
import type { Json } from "@/integrations/supabase/types";
import { hashPlatformApiKey, decryptSecret } from "./crypto.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { TIER_DAILY_LIMITS, type Tier } from "./tiers";
import {
  callUpstreamTool,
  categorize,
  isManagementTool,
  isUpstreamConfigured,
  listUpstreamTools,
  type UpstreamTool,
  type CallerCtx,
} from "./mcp-upstream.server";
import { LOCAL_TOOLS, TOOLS } from "./mcp-tool-definitions";
import {
  calculateChanges,
  detectSuspiciousActivity,
  getRollbackSnapshotForUser,
  getAuditStatistics,
  getWorkflowHistory,
  markAuditRolledBack,
  recordWorkflowAudit,
  type WorkflowAuditOperation,
} from "./audit.server";
import {
  NodeKnowledgeService,
  WorkflowDiffService,
  WorkflowOperationPolicyService,
  WorkflowValidationService,
  optionalPolicy,
  requireOperations,
  requireWorkflow,
  type WorkflowLike,
  type WorkflowPolicyContext,
} from "./workflow-agent";
import {
  ConfirmationRequiredError,
  createConfirmationService,
} from "./workflow-agent/confirmation.server";
import {
  assertTrustedWorkflowPreview,
  loadTrustedWorkflowPreview,
} from "./workflow-agent/trusted-preview.server";
import { WorkflowCreationPipeline } from "./workflow-agent/creation-pipeline.server";
import {
  createKnowledgeClient,
  type KnowledgeClient,
} from "./workflow-agent/knowledge-client.server";

export type AuthedKey = {
  user_id: string;
  key_id: string;
  tier: Tier;
};

type ClientCapabilities = {
  elicitation?: boolean;
  sampling?: boolean;
};

type ElicitationRequest = {
  title: string;
  description: string;
  details?: string;
  schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

export type ToolContext = {
  user_id?: string;
  request_id?: string;
  clientCapabilities?: ClientCapabilities;
  requestElicitation?: (request: ElicitationRequest) => Promise<Record<string, unknown>>;
  policy?: WorkflowPolicyContext;
  confirmationVerified?: boolean;
};

export class ElicitationRequiredError extends Error {
  constructor(
    public readonly elicitationId: string,
    public readonly request: ElicitationRequest,
  ) {
    super(`Elicitation required for ${request.title} (${elicitationId})`);
  }
}

// Fallback in-memory short-window throttle (per Worker isolate). 60 req / 10s per user.
const buckets = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10_000;
const WINDOW_MAX = 60;
const TEST_CONFIRMATION_TOKEN_TTL_MS = 5 * 60_000;
const testOnlyConfirmationChallenges = new Map<string, { token: string; expiresAt: number }>();
const confirmationService = createConfirmationService();
const nodeKnowledgeService = new NodeKnowledgeService();
const workflowValidationService = new WorkflowValidationService();
const workflowDiffService = new WorkflowDiffService();
const workflowOperationPolicyService = new WorkflowOperationPolicyService();
let productionKnowledgeClient: KnowledgeClient | undefined;
const deferredProductionKnowledgeClient: KnowledgeClient = {
  searchTemplates: (...args) =>
    (productionKnowledgeClient ??= createKnowledgeClient()).searchTemplates(...args),
  getTemplate: (...args) =>
    (productionKnowledgeClient ??= createKnowledgeClient()).getTemplate(...args),
  searchNodes: (...args) =>
    (productionKnowledgeClient ??= createKnowledgeClient()).searchNodes(...args),
  getNode: (...args) => (productionKnowledgeClient ??= createKnowledgeClient()).getNode(...args),
  validateNode: (...args) =>
    (productionKnowledgeClient ??= createKnowledgeClient()).validateNode(...args),
  validateWorkflow: (...args) =>
    (productionKnowledgeClient ??= createKnowledgeClient()).validateWorkflow(...args),
};
const PARTIAL_UPDATE_AUDIT_BEFORE = Symbol("partialUpdateAuditBefore");
const ORCHESTRATED_TOOL_NAMES = new Set([
  "create_scheduled_workflow",
  "create_webhook_workflow",
  "create_ai_chatbot_workflow",
  "create_email_workflow",
  "deploy_and_test_workflow",
  "fix_workflow_errors",
]);

export const KNOWLEDGE_TOOL_MAP = Object.freeze({
  search_nodes: "search_nodes",
  get_node: "get_node_essentials",
  search_templates: "search_templates",
  get_template: "get_workflow_template",
} as const);

export function shortWindowAllow(userId: string): boolean {
  const now = Date.now();
  const b = buckets.get(userId);
  if (!b || b.resetAt < now) {
    buckets.set(userId, { count: 1, resetAt: now + WINDOW_MS });
    return true;
  }
  if (b.count >= WINDOW_MAX) return false;
  b.count++;
  return true;
}

export async function checkShortWindowQuota(userId: string): Promise<boolean> {
  if (process.env.MCP_SHORT_WINDOW_LIMITER === "memory") {
    return shortWindowAllow(userId);
  }

  const { data, error } = await supabaseAdmin.rpc("check_mcp_short_window", {
    _user_id: userId,
    _window_seconds: Math.floor(WINDOW_MS / 1000),
    _max_requests: WINDOW_MAX,
  });

  if (error) {
    console.error("[mcp.rate_limit] database limiter failed; failing closed", error);
    return false;
  }

  return data === true;
}

export async function authenticateBearer(req: Request): Promise<AuthedKey | null> {
  const h = req.headers.get("authorization") ?? "";
  const m = h.match(/^Bearer\s+(nmcp_[A-Za-z0-9_-]+)$/);
  if (!m) return null;
  const full = m[1];
  const hash = hashPlatformApiKey(full);

  const { data: key } = await supabaseAdmin
    .from("platform_api_keys")
    .select("id,user_id,revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();
  if (!key || key.revoked_at) return null;

  const { data: sub } = await supabaseAdmin
    .from("subscriptions")
    .select("tier,status")
    .eq("user_id", key.user_id)
    .maybeSingle();

  // touch last_used_at (fire and forget)
  void supabaseAdmin
    .from("platform_api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", key.id);

  return {
    user_id: key.user_id,
    key_id: key.id,
    tier: effectiveTier(sub?.tier, sub?.status),
  };
}

// A paid tier only confers paid quota while the subscription is in good standing.
// past_due / canceled / paused / anything non-active collapses to `free`, so a
// user whose payment failed cannot keep hitting pro/enterprise MCP limits until
// Paddle eventually sends a cancellation event.
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["active", "trialing"]);

export function effectiveTier(
  tier: string | null | undefined,
  status: string | null | undefined,
): Tier {
  const resolved = (tier as Tier) ?? "free";
  if (resolved === "free") return "free";
  return ACTIVE_SUBSCRIPTION_STATUSES.has(status ?? "") ? resolved : "free";
}

export async function checkDailyQuota(
  auth: AuthedKey,
): Promise<{ ok: boolean; used: number; limit: number }> {
  const limit = TIER_DAILY_LIMITS[auth.tier] ?? TIER_DAILY_LIMITS.free;
  const { data, error } = await supabaseAdmin.rpc("get_today_mcp_usage", {
    _user_id: auth.user_id,
  });
  if (error) {
    console.error("[mcp.quota] daily quota lookup failed; failing closed", error);
    return { ok: false, used: limit, limit };
  }
  const used = typeof data === "number" ? data : 0;
  return { ok: used < limit, used, limit };
}

export async function recordCall(opts: {
  user_id: string;
  instance_id?: string | null;
  tool_name: string | null;
  status: "ok" | "error" | "rate_limited";
  latency_ms: number;
  error_message?: string | null;
  upstream?: boolean;
  category?: "local" | "knowledge" | "management" | null;
  workflow_id?: string | null;
  session_id?: string | null;
  metadata?: Json;
}) {
  const writes: PromiseLike<unknown>[] = [
    supabaseAdmin.from("mcp_call_logs").insert({
      user_id: opts.user_id,
      instance_id: opts.instance_id ?? null,
      tool_name: opts.tool_name,
      status: opts.status,
      latency_ms: opts.latency_ms,
      error_message: opts.error_message ?? null,
      upstream: opts.upstream ?? false,
      category: opts.category ?? null,
      workflow_id: opts.workflow_id ?? null,
      session_id: opts.session_id ?? null,
      metadata: opts.metadata ?? {},
    }),
  ];

  if (opts.status !== "rate_limited") {
    writes.push(supabaseAdmin.rpc("increment_mcp_usage", { _user_id: opts.user_id, _n: 1 }));
  }

  await Promise.allSettled(writes);
}

/** Pick the user's first n8n instance (single-instance MVP). */
export async function getDefaultInstance(userId: string) {
  const { data } = await supabaseAdmin
    .from("n8n_instances")
    .select("id,base_url,api_key_encrypted,api_key_iv,api_key_tag,name")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    id: data.id,
    name: data.name,
    base_url: data.base_url,
    api_key: decryptSecret({
      ciphertext: data.api_key_encrypted,
      iv: data.api_key_iv,
      tag: data.api_key_tag,
    }),
  };
}

type Inst = NonNullable<Awaited<ReturnType<typeof getDefaultInstance>>>;

async function n8n(inst: Inst, path: string, init?: RequestInit) {
  const url = `${inst.base_url}${path}`;
  const { safeFetchPublicUrl } = await import("./ssrf-guard.server");
  const res = await safeFetchPublicUrl(url, {
    ...init,
    headers: {
      "X-N8N-API-KEY": inst.api_key,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`n8n request failed with status ${res.status}`);
  }
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Successful non-JSON responses are returned as text.
  }
  return body;
}

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

export async function runTool(
  inst: Inst,
  name: string,
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<unknown> {
  // Orchestrated tools. Note: this must list the orchestrated tool names
  // explicitly — a `create_*` prefix match would swallow the basic
  // `create_workflow` CRUD tool, which is handled in the switch below.
  if (ORCHESTRATED_TOOL_NAMES.has(name)) {
    const parsedArgs = parseOrchestratedToolArgs(name, args);
    const { OrchestratedToolsService } = await import("./orchestrated-tools.service");
    const creationPipeline = name.startsWith("create_")
      ? new WorkflowCreationPipeline({
          knowledge: deferredProductionKnowledgeClient,
          localValidation: workflowValidationService,
          createDraft: async (workflow) =>
            (await n8n(inst, "/api/v1/workflows", {
              method: "POST",
              body: JSON.stringify(workflow),
            })) as WorkflowLike,
        })
      : undefined;
    const service = new OrchestratedToolsService(inst, { creationPipeline });
    return service.callTool(name, parsedArgs, context);
  }

  switch (name) {
    case "validate_node":
      return nodeKnowledgeService.validateNode(
        requireNonEmptyString(args.nodeType, "nodeType"),
        asObj(args.parameters),
        args.credentials && typeof args.credentials === "object" && !Array.isArray(args.credentials)
          ? (args.credentials as Record<string, unknown>)
          : undefined,
      );
    case "preview_workflow_diff": {
      const previewArgs = parsePreviewWorkflowDiffArgs(args);
      return previewWorkflowDiff(inst, previewArgs);
    }
    case "update_partial_workflow": {
      const updateArgs = parseUpdatePartialWorkflowArgs(args);
      await requireConfirmation(
        updateArgs,
        "Update partial workflow",
        {
          requireToken: true,
          scope: {
            workflowId: updateArgs.workflowId,
            operations: updateArgs.operations,
          },
        },
        context,
      );
      return updatePartialWorkflow(inst, updateArgs, context);
    }
    case "list_workflows": {
      const qs = new URLSearchParams();
      if (typeof args.active === "boolean") qs.set("active", String(args.active));
      qs.set("limit", String(args.limit ?? 50));
      return n8n(inst, `/api/v1/workflows?${qs}`);
    }
    case "get_workflow":
      return n8n(inst, `/api/v1/workflows/${encodeURIComponent(String(args.id))}`);
    case "execute_workflow":
      await requireConfirmation(args, "Execute workflow", {}, context);
      return n8n(inst, `/api/v1/workflows/${encodeURIComponent(String(args.id))}/execute`, {
        method: "POST",
        body: JSON.stringify(args.data ?? {}),
      });
    case "list_executions": {
      const qs = new URLSearchParams();
      if (args.workflowId) qs.set("workflowId", String(args.workflowId));
      qs.set("limit", String(args.limit ?? 20));
      return n8n(inst, `/api/v1/executions?${qs}`);
    }
    case "import_workflow_template": {
      const id = Number(args.id);
      if (!Number.isFinite(id)) throw new Error("id (template id) is required");
      if (!isUpstreamConfigured()) {
        throw new Error(
          "Knowledge base is not configured on this gateway; cannot resolve template.",
        );
      }
      // 1) fetch template JSON from the upstream knowledge base
      const tpl = (await callUpstreamTool("get_workflow_template", { id }, null, {
        source: "import_workflow_template",
      })) as {
        content?: Array<{ type: string; text: string }>;
      };
      const raw = tpl?.content?.[0]?.text;
      if (!raw) throw new Error("template not found in knowledge base");
      const parsed = JSON.parse(raw) as {
        name?: string;
        workflow?: { name?: string; nodes?: unknown[]; connections?: unknown; settings?: unknown };
        error?: string;
      };
      if (parsed.error) throw new Error(parsed.error);
      const wf = parsed.workflow;
      if (!wf?.nodes) throw new Error("template has no workflow body");
      // 2) build n8n create payload (only fields the n8n REST API accepts on create)
      const payload = {
        name: String(args.name ?? wf.name ?? parsed.name ?? `template-${id}`),
        nodes: wf.nodes,
        connections: wf.connections ?? {},
        settings: wf.settings ?? {},
      };
      const created = (await n8n(inst, "/api/v1/workflows", {
        method: "POST",
        body: JSON.stringify(payload),
      })) as { id?: string | number };
      // 3) optionally activate
      if (args.activate && created?.id != null) {
        await n8n(inst, `/api/v1/workflows/${encodeURIComponent(String(created.id))}/activate`, {
          method: "POST",
        }).catch((e) => {
          console.warn("[import_workflow_template] activate failed:", (e as Error).message);
        });
      }
      return { ok: true, workflow_id: created?.id, name: payload.name, template_id: id };
    }
    case "create_workflow": {
      // Validate required fields
      if (!args.name || typeof args.name !== "string") {
        throw new Error("name (string) is required");
      }
      if (!Array.isArray(args.nodes)) {
        throw new Error("nodes (array) is required");
      }
      if (!args.connections || typeof args.connections !== "object") {
        throw new Error("connections (object) is required");
      }
      // Build payload
      const payload: Record<string, unknown> = {
        name: args.name,
        nodes: args.nodes,
        connections: args.connections,
      };
      if (args.settings) payload.settings = args.settings;
      if (args.staticData) payload.staticData = args.staticData;
      if (args.tags) payload.tags = args.tags;
      const validation = await workflowValidationService.validateWorkflow(payload as WorkflowLike);
      if (!validation.ok) {
        return {
          success: false,
          validation,
          message: "Workflow validation failed; workflow was not created.",
        };
      }
      // Create workflow
      return n8n(inst, "/api/v1/workflows", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    }
    case "update_workflow": {
      if (!args.id) throw new Error("id (workflow id) is required");
      const id = String(args.id);
      await requireConfirmation(args, "Update workflow", {}, context);
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
      // Build payload with only provided fields
      const payload: Record<string, unknown> = {};
      if (args.name !== undefined) payload.name = args.name;
      // Update workflow
      return n8n(inst, `/api/v1/workflows/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    }
    case "delete_workflow": {
      if (!args.id) throw new Error("id (workflow id) is required");
      const id = String(args.id);
      await requireConfirmation(args, "Delete workflow", { requireToken: true }, context);
      // Delete workflow
      await n8n(inst, `/api/v1/workflows/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
      return { ok: true, workflow_id: id, deleted: true };
    }
    case "activate_workflow": {
      if (!args.id) throw new Error("id (workflow id) is required");
      const id = String(args.id);
      if (typeof args.active !== "boolean") {
        throw new Error("active (boolean) is required");
      }
      await requireConfirmation(
        args,
        args.active ? "Activate workflow" : "Deactivate workflow",
        {},
        context,
      );
      // Activate or deactivate
      const endpoint = args.active ? "activate" : "deactivate";
      return n8n(inst, `/api/v1/workflows/${encodeURIComponent(id)}/${endpoint}`, {
        method: "POST",
      });
    }
    case "validate_workflow": {
      return validateWorkflowViaUpstream(args);
    }
    case "analyze_workflow_graph": {
      if (!args.id) throw new Error("id (workflow id) is required");
      const { analyzeWorkflowGraph } = await import("./workflow-graph");
      const workflow = await n8n(inst, `/api/v1/workflows/${encodeURIComponent(String(args.id))}`);

      return {
        workflow_id: args.id,
        analysis: analyzeWorkflowGraph(workflow as Parameters<typeof analyzeWorkflowGraph>[0]),
      };
    }
    case "apply_workflow_patch": {
      if (!args.id) throw new Error("id (workflow id) is required");
      if (!args.patch || typeof args.patch !== "object") {
        throw new Error("patch (object) is required");
      }
      await requireConfirmation(
        args,
        "Apply workflow patch",
        {
          requireToken: true,
          scope: { id: args.id, patch: args.patch },
        },
        context,
      );
      const { analyzeWorkflowGraph, applyWorkflowPatch, validateWorkflowPatch } =
        await import("./workflow-graph");
      const workflow = (await n8n(
        inst,
        `/api/v1/workflows/${encodeURIComponent(String(args.id))}`,
      )) as Parameters<typeof analyzeWorkflowGraph>[0];
      const patch = args.patch as Parameters<typeof validateWorkflowPatch>[1];
      const validation = validateWorkflowPatch(workflow, patch);

      if (!validation.valid) {
        return {
          success: false,
          errors: validation.errors,
          analysis: analyzeWorkflowGraph(workflow),
          message: "Workflow patch validation failed. Fix the patch and try again.",
        };
      }

      const patched = applyWorkflowPatch(workflow, patch);
      const updated = await n8n(inst, `/api/v1/workflows/${encodeURIComponent(String(args.id))}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...workflow,
          nodes: patched.workflow.nodes,
          connections: patched.workflow.connections,
          settings: patched.workflow.settings,
        }),
      });

      return {
        success: true,
        changed: patched.changed,
        workflow: updated,
        analysis: analyzeWorkflowGraph(patched.workflow),
      };
    }
    case "preview_workflow_patch": {
      if (!args.id) throw new Error("id (workflow id) is required");
      if (!args.patch || typeof args.patch !== "object") {
        throw new Error("patch (object) is required");
      }
      const { analyzeWorkflowGraph, createPatchDiff, validateWorkflowPatch } =
        await import("./workflow-graph");
      const workflow = (await n8n(
        inst,
        `/api/v1/workflows/${encodeURIComponent(String(args.id))}`,
      )) as Parameters<typeof analyzeWorkflowGraph>[0];
      const patch = args.patch as Parameters<typeof validateWorkflowPatch>[1];
      const validation = validateWorkflowPatch(workflow, patch);

      return {
        workflow_id: args.id,
        validation,
        diff: validation.valid ? createPatchDiff(workflow, patch) : null,
        analysis: analyzeWorkflowGraph(workflow),
      };
    }
    case "safe_apply_workflow_patch": {
      if (!args.id) throw new Error("id (workflow id) is required");
      if (!args.patch || typeof args.patch !== "object") {
        throw new Error("patch (object) is required");
      }
      await requireConfirmation(
        args,
        "Safe apply workflow patch",
        {
          requireToken: true,
          scope: {
            id: args.id,
            patch: args.patch,
            postApplyChecks: args.postApplyChecks,
          },
        },
        context,
      );
      const {
        analyzeWorkflowGraph,
        applyWorkflowPatch,
        auditExpressionDependencies,
        createPatchDiff,
        createWorkflowRollbackPatch,
        validateWorkflowPatch,
      } = await import("./workflow-graph");
      const workflow = (await n8n(
        inst,
        `/api/v1/workflows/${encodeURIComponent(String(args.id))}`,
      )) as Parameters<typeof analyzeWorkflowGraph>[0];
      const patch = args.patch as Parameters<typeof validateWorkflowPatch>[1];
      const validation = validateWorkflowPatch(workflow, patch);

      if (!validation.valid) {
        return {
          success: false,
          errors: validation.errors,
          analysis: analyzeWorkflowGraph(workflow),
          message: "Workflow patch validation failed. Fix the patch and try again.",
        };
      }

      const diff = createPatchDiff(workflow, patch);
      const rollbackPatch = createWorkflowRollbackPatch(workflow, diff.after);
      const patched = applyWorkflowPatch(workflow, patch);
      const updated = await n8n(inst, `/api/v1/workflows/${encodeURIComponent(String(args.id))}`, {
        method: "PATCH",
        body: JSON.stringify({
          ...workflow,
          nodes: patched.workflow.nodes,
          connections: patched.workflow.connections,
          settings: patched.workflow.settings,
        }),
      });

      const checks = Array.isArray(args.postApplyChecks)
        ? args.postApplyChecks.map(String)
        : ["expressionDependencies"];
      const postApplyValidation: Record<string, unknown> = {};
      let shouldRollback = false;

      if (checks.includes("expressionDependencies")) {
        const expressionAudit = auditExpressionDependencies(patched.workflow);
        postApplyValidation.expressionDependencies = expressionAudit;
        shouldRollback = expressionAudit.missingCount > 0;
      }

      if (shouldRollback) {
        const rolledBack = applyWorkflowPatch(patched.workflow, rollbackPatch);
        const rollbackWorkflow = await n8n(
          inst,
          `/api/v1/workflows/${encodeURIComponent(String(args.id))}`,
          {
            method: "PATCH",
            body: JSON.stringify({
              ...workflow,
              nodes: rolledBack.workflow.nodes,
              connections: rolledBack.workflow.connections,
              settings: rolledBack.workflow.settings,
            }),
          },
        );

        return {
          success: false,
          rolled_back: true,
          workflow: updated,
          rollback_workflow: rollbackWorkflow,
          diff,
          rollback_patch: rollbackPatch,
          post_apply_validation: postApplyValidation,
          message: "Post-apply validation failed; rollback patch was applied.",
        };
      }

      return {
        success: true,
        rolled_back: false,
        workflow: updated,
        diff,
        rollback_patch: rollbackPatch,
        post_apply_validation: postApplyValidation,
        analysis: analyzeWorkflowGraph(patched.workflow),
      };
    }
    case "propose_workflow_patch": {
      if (!args.id) throw new Error("id (workflow id) is required");
      const { analyzeWorkflowGraph, proposeWorkflowPatch } = await import("./workflow-graph");
      const workflow = (await n8n(
        inst,
        `/api/v1/workflows/${encodeURIComponent(String(args.id))}`,
      )) as Parameters<typeof analyzeWorkflowGraph>[0];

      return {
        workflow_id: args.id,
        proposal: proposeWorkflowPatch(workflow),
        analysis: analyzeWorkflowGraph(workflow),
      };
    }
    case "propose_workflow_simplification": {
      if (!args.id) throw new Error("id (workflow id) is required");
      const { analyzeWorkflowGraph, proposeWorkflowSimplification } =
        await import("./workflow-graph");
      const workflow = (await n8n(
        inst,
        `/api/v1/workflows/${encodeURIComponent(String(args.id))}`,
      )) as Parameters<typeof analyzeWorkflowGraph>[0];

      return {
        workflow_id: args.id,
        proposal: proposeWorkflowSimplification(workflow),
        analysis: analyzeWorkflowGraph(workflow),
      };
    }
    case "preview_workflow_simplification": {
      if (!args.id) throw new Error("id (workflow id) is required");
      if (!Array.isArray(args.candidateNodeNames)) {
        throw new Error("candidateNodeNames (array) is required");
      }
      const { analyzeWorkflowGraph, previewWorkflowSimplification } =
        await import("./workflow-graph");
      const workflow = (await n8n(
        inst,
        `/api/v1/workflows/${encodeURIComponent(String(args.id))}`,
      )) as Parameters<typeof analyzeWorkflowGraph>[0];

      return {
        workflow_id: args.id,
        preview: previewWorkflowSimplification(workflow, args.candidateNodeNames.map(String)),
        analysis: analyzeWorkflowGraph(workflow),
      };
    }
    case "safe_apply_workflow_simplification": {
      if (!args.id) throw new Error("id (workflow id) is required");
      if (!Array.isArray(args.candidateNodeNames)) {
        throw new Error("candidateNodeNames (array) is required");
      }
      const { previewWorkflowSimplification, simplifyWorkflowAsDraft } =
        await import("./workflow-graph");
      const workflow = (await n8n(
        inst,
        `/api/v1/workflows/${encodeURIComponent(String(args.id))}`,
      )) as Parameters<typeof previewWorkflowSimplification>[0];
      const candidateNodeNames = args.candidateNodeNames.map(String);
      const preview = previewWorkflowSimplification(workflow, candidateNodeNames);

      if (!preview.valid) {
        return {
          success: false,
          source_workflow_id: args.id,
          preview,
          message: "Simplification candidates are not approved for automatic draft creation.",
        };
      }

      const draft = simplifyWorkflowAsDraft(
        workflow,
        candidateNodeNames,
        typeof args.name === "string" && args.name.trim().length > 0 ? args.name.trim() : undefined,
      );
      const created = await n8n(inst, "/api/v1/workflows", {
        method: "POST",
        body: JSON.stringify(draft),
      });

      return {
        success: true,
        source_workflow_id: args.id,
        draft_workflow: created,
        preview,
        message: "Simplified workflow draft created. Source workflow was not modified.",
      };
    }
    case "summarize_workflow_modules": {
      if (!args.id) throw new Error("id (workflow id) is required");
      const { summarizeWorkflowModules } = await import("./workflow-graph");
      const workflow = (await n8n(
        inst,
        `/api/v1/workflows/${encodeURIComponent(String(args.id))}`,
      )) as Parameters<typeof summarizeWorkflowModules>[0];

      return {
        workflow_id: args.id,
        modules: summarizeWorkflowModules(workflow),
      };
    }
    case "summarize_workflow_semantic_modules": {
      if (!args.id) throw new Error("id (workflow id) is required");
      const { summarizeWorkflowSemanticModules } = await import("./workflow-graph");
      const workflow = (await n8n(
        inst,
        `/api/v1/workflows/${encodeURIComponent(String(args.id))}`,
      )) as Parameters<typeof summarizeWorkflowSemanticModules>[0];

      return {
        workflow_id: args.id,
        modules: summarizeWorkflowSemanticModules(workflow),
      };
    }
    case "infer_workflow_business_intent": {
      if (!args.id) throw new Error("id (workflow id) is required");
      const { inferWorkflowBusinessIntent } = await import("./workflow-graph");
      const workflow = (await n8n(
        inst,
        `/api/v1/workflows/${encodeURIComponent(String(args.id))}`,
      )) as Parameters<typeof inferWorkflowBusinessIntent>[0];

      return {
        workflow_id: args.id,
        intent: inferWorkflowBusinessIntent(workflow),
      };
    }
    case "create_workflow_review_batches": {
      if (!args.id) throw new Error("id (workflow id) is required");
      const { createWorkflowReviewBatches } = await import("./workflow-graph");
      const workflow = (await n8n(
        inst,
        `/api/v1/workflows/${encodeURIComponent(String(args.id))}`,
      )) as Parameters<typeof createWorkflowReviewBatches>[0];

      return {
        workflow_id: args.id,
        batches: createWorkflowReviewBatches(workflow, {
          batchSize: typeof args.batchSize === "number" ? args.batchSize : undefined,
          overlap: typeof args.overlap === "number" ? args.overlap : undefined,
        }),
      };
    }
    case "audit_expression_dependencies": {
      if (!args.id) throw new Error("id (workflow id) is required");
      const { auditExpressionDependencies } = await import("./workflow-graph");
      const workflow = (await n8n(
        inst,
        `/api/v1/workflows/${encodeURIComponent(String(args.id))}`,
      )) as Parameters<typeof auditExpressionDependencies>[0];

      return {
        workflow_id: args.id,
        audit: auditExpressionDependencies(workflow),
      };
    }
    case "clone_workflow_as_draft": {
      if (!args.id) throw new Error("id (workflow id) is required");
      const { cloneWorkflowAsDraft } = await import("./workflow-graph");
      const workflow = (await n8n(
        inst,
        `/api/v1/workflows/${encodeURIComponent(String(args.id))}`,
      )) as Parameters<typeof cloneWorkflowAsDraft>[0];
      const draft = cloneWorkflowAsDraft(
        workflow,
        typeof args.name === "string" && args.name.trim().length > 0 ? args.name.trim() : undefined,
      );
      const created = await n8n(inst, "/api/v1/workflows", {
        method: "POST",
        body: JSON.stringify(draft),
      });

      return {
        success: true,
        source_workflow_id: args.id,
        draft_workflow: created,
      };
    }
    case "create_workflow_from_blueprint": {
      const {
        compileBlueprint,
        getCredentialRequirements,
        isWorkflowBlueprint,
        repairBlueprint,
        validateBlueprint,
        validateCompiledWorkflow,
      } = await import("./workflow-blueprint");
      const { auditN8nAgentRules } = await import("./n8n-agent-rules");
      const shouldActivate = args.activate === true;
      const requireCredentials = args.requireCredentials === true;
      const repair = repairBlueprint(args);

      const validation = validateBlueprint(repair.blueprint);
      if (!validation.valid) {
        return {
          success: false,
          errors: validation.errors,
          repairs: repair.repairs,
          message: "Blueprint validation failed. Fix the errors and try again.",
        };
      }

      if (!isWorkflowBlueprint(repair.blueprint)) {
        throw new Error("Blueprint validation unexpectedly failed");
      }

      const credentialRequirements = getCredentialRequirements(repair.blueprint);
      if (requireCredentials && credentialRequirements.length > 0) {
        return {
          success: false,
          missingCredentials: credentialRequirements,
          repairs: repair.repairs,
          message: "Blueprint requires credentials before creation.",
        };
      }

      const workflow = compileBlueprint(repair.blueprint);
      const compiledValidation = validateCompiledWorkflow(workflow);
      const agentRuleAudit = auditN8nAgentRules(workflow);
      if (!compiledValidation.valid) {
        return {
          success: false,
          errors: compiledValidation.errors,
          repairs: repair.repairs,
          agentRuleAudit,
          message: "Compiled workflow validation failed. Fix the blueprint and try again.",
        };
      }

      const created = await n8n(inst, "/api/v1/workflows", {
        method: "POST",
        body: JSON.stringify(workflow),
      });

      if (shouldActivate && created && typeof created === "object" && "id" in created) {
        await n8n(inst, `/api/v1/workflows/${encodeURIComponent(String(created.id))}/activate`, {
          method: "POST",
        });
      }

      return {
        success: true,
        workflow: created,
        repairs: repair.repairs,
        credentialRequirements,
        agentRuleAudit,
        message: `Workflow created from blueprint${shouldActivate ? " and activated" : ""}`,
      };
    }
    // Note: `fix_workflow_errors` is intercepted at the top of runTool by the
    // ORCHESTRATED_TOOLS guard and routed to OrchestratedToolsService, so it has
    // no case here — a switch case would be unreachable.
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

async function capableOfElicitation(context?: ToolContext): Promise<boolean> {
  return !!(
    context?.clientCapabilities?.elicitation && typeof context.requestElicitation === "function"
  );
}

async function requestUserConfirmation(
  context: ToolContext | undefined,
  operation: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (!context?.requestElicitation || !context.clientCapabilities?.elicitation) {
    return false;
  }

  try {
    const response = await context.requestElicitation({
      title: operation,
      description: `Please confirm operation on ${String(args.id ?? args.workflowId ?? "target resource")}.`,
      schema: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            title: "Confirm this action",
            description: "Set true to proceed.",
          },
        },
        required: ["confirm"],
      },
    });
    return response.confirm === true;
  } catch (error) {
    if (error instanceof ElicitationRequiredError) {
      throw error;
    }
    return false;
  }
}

async function requireConfirmation(
  args: Record<string, unknown>,
  operation: string,
  opts: { requireToken?: boolean; scope?: unknown } = {},
  context?: ToolContext,
): Promise<void> {
  if (context?.confirmationVerified) return;
  if (opts.requireToken && (await capableOfElicitation(context))) {
    const confirmed = await requestUserConfirmation(context, operation, args);
    if (!confirmed) {
      throw new Error(`${operation} requires user confirmation via elicitation flow.`);
    }
    return;
  }

  if (opts.requireToken) {
    const authenticatedUserId = (context as (ToolContext & { user_id?: string }) | undefined)
      ?.user_id;
    const scope = opts.scope ?? { id: args.id ?? args.workflowId ?? "" };

    if (authenticatedUserId) {
      try {
        await confirmationService.requireOrConsume({
          userId: authenticatedUserId,
          action: operation,
          scope,
          confirmationToken:
            args.confirm === true && typeof args.confirmationToken === "string"
              ? args.confirmationToken
              : undefined,
        });
        return;
      } catch (error) {
        if (!(error instanceof ConfirmationRequiredError)) throw error;
        if (args.confirm === true) {
          throw new Error(
            `${operation} requires a valid confirmation token. Re-send with ` +
              `{"confirm": true, "confirmationToken": "${error.token}"} to proceed.`,
          );
        }
        throw new Error(
          `${operation} requires confirmation. Re-send with ` +
            `{"confirm": true, "confirmationToken": "${error.token}"} to proceed.`,
        );
      }
    }

    // Direct runTool unit tests do not have an authenticated caller. Keep their
    // compatibility challenge process-local; all production dispatches use the
    // durable, owner-scoped service above.
    const challengeKey = `${operation}:${stableStringify(scope)}`;
    const now = Date.now();
    const existing = testOnlyConfirmationChallenges.get(challengeKey);

    if (
      args.confirm === true &&
      typeof args.confirmationToken === "string" &&
      existing?.token === args.confirmationToken &&
      existing.expiresAt > now
    ) {
      testOnlyConfirmationChallenges.delete(challengeKey);
      return;
    }

    const token = `mcp_confirm_${randomBytes(16).toString("base64url")}`;
    testOnlyConfirmationChallenges.set(challengeKey, {
      token,
      expiresAt: now + TEST_CONFIRMATION_TOKEN_TTL_MS,
    });

    if (args.confirm === true) {
      throw new Error(
        `${operation} requires a valid confirmation token. Re-send with ` +
          `{"confirm": true, "confirmationToken": "${token}"} to proceed.`,
      );
    }

    throw new Error(
      `${operation} requires confirmation. Re-send with ` +
        `{"confirm": true, "confirmationToken": "${token}"} to proceed.`,
    );
  }

  if (args.confirm !== true) {
    throw new Error(`${operation} requires confirmation. Re-send with "confirm": true to proceed.`);
  }
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

// Names dispatched locally (CRUD + orchestrated). Built from TOOLS, which
// merges LOCAL_TOOLS with the orchestrated tool schemas, so every advertised
// tool is also routable through runTool.
const LOCAL_NAMES: Set<string> = new Set(TOOLS.map((t) => t.name));

export { LOCAL_TOOLS, TOOLS };

/**
 * Merge local tools with upstream knowledge/management tools (czlonkowski/n8n-mcp).
 * Local definitions win on name collisions.
 */
export async function getMergedTools(): Promise<
  Array<{ name: string; description?: string; inputSchema?: unknown }>
> {
  const upstream: UpstreamTool[] = await listUpstreamTools(false);
  const merged: Array<{ name: string; description?: string; inputSchema?: unknown }> = [...TOOLS];
  for (const t of upstream) {
    if (!t?.name || LOCAL_NAMES.has(t.name)) continue;
    merged.push(t);
  }
  return merged;
}

export type DispatchResult = {
  output: unknown;
  upstream: boolean;
  category: "local" | "knowledge" | "management";
  needsInstance: boolean;
};

// --- Workflow audit wiring -------------------------------------------------
// A single, data-driven audit hook lives in dispatchTool (below). It covers
// CRUD, blueprint and the orchestrated create/fix/deploy tools uniformly,
// mirroring the centralized recordCall() pattern. Read/rollback audit tools are
// intercepted here too because they need the caller's user id (rollback also
// needs an n8n instance to re-apply the snapshot).

const AUDIT_READ_TOOLS = new Set<string>([
  "get_workflow_history",
  "get_audit_statistics",
  "detect_suspicious_activity",
]);
const AGENT_READ_TOOLS = new Set<string>(["validate_node"]);
const AGENT_INSTANCE_TOOLS = new Set<string>(["preview_workflow_diff", "update_partial_workflow"]);

type MutationDescriptor = {
  op: (args: Record<string, unknown>) => WorkflowAuditOperation;
  captureBefore: boolean;
  idFrom: (args: Record<string, unknown>, out: unknown) => string | undefined;
  after: (out: unknown) => unknown;
};

function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
function strId(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}
function idOf(v: unknown): string | undefined {
  const id = asObj(v).id;
  return id == null ? undefined : String(id);
}
function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} (string) is required`);
  }
  return value;
}

function optionalNumberArray(value: unknown, field: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (!value.every((item) => Number.isInteger(item) && item >= 0)) {
    throw new Error(`${field} must contain only non-negative integers`);
  }
  return value as number[];
}

function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} (object) is required`);
  }
  return value as Record<string, unknown>;
}

function optionalObject(value: unknown, field: string): Record<string, unknown> | undefined {
  return value === undefined ? undefined : requireObject(value, field);
}

function requireEnumString<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  const parsed = requireNonEmptyString(value, field);
  if (!allowed.includes(parsed as T)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return parsed as T;
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}

function parseSmtpCredentialReference(value: unknown): {
  smtp: { id: string; name: string };
} {
  const credentials = requireObject(value, "interfaceConfig.humanEmailCredentials");
  const credentialKeys = Object.keys(credentials);
  if (credentialKeys.length !== 1 || credentialKeys[0] !== "smtp") {
    throw new Error("interfaceConfig.humanEmailCredentials must contain only smtp");
  }
  const smtp = requireObject(credentials.smtp, "interfaceConfig.humanEmailCredentials.smtp");
  const smtpKeys = Object.keys(smtp);
  if (smtpKeys.some((key) => key !== "id" && key !== "name")) {
    throw new Error("interfaceConfig.humanEmailCredentials.smtp supports only id and name");
  }
  return {
    smtp: {
      id: requireNonEmptyString(smtp.id, "interfaceConfig.humanEmailCredentials.smtp.id"),
      name: requireNonEmptyString(smtp.name, "interfaceConfig.humanEmailCredentials.smtp.name"),
    },
  };
}

function parseAIChatbotArgs(args: Record<string, unknown>): Record<string, unknown> {
  const interfaceName = requireEnumString(args.interface ?? args.platform, "interface", [
    "webhook",
    "slack",
  ]);
  const aiProvider =
    args.aiProvider === undefined
      ? "openai"
      : requireEnumString(args.aiProvider, "aiProvider", ["openai"]);
  const rawAIConfig = requireObject(args.aiConfig, "aiConfig");
  if (rawAIConfig.apiKey !== undefined) {
    throw new Error("aiConfig.apiKey is not supported; use an n8n credential reference");
  }
  const model = requireNonEmptyString(rawAIConfig.model, "aiConfig.model");

  const rawFeatures = optionalObject(args.features, "features") ?? {};
  const legacyEscalation = optionalObject(args.escalationRules, "escalationRules");
  const legacyNotification = optionalObject(args.humanNotification, "humanNotification");
  if (legacyNotification?.method !== undefined && legacyNotification.method !== "email") {
    throw new Error("humanNotification.method must be email");
  }
  if (legacyEscalation?.sentimentThreshold !== undefined) {
    optionalNumber(legacyEscalation.sentimentThreshold, "escalationRules.sentimentThreshold");
  }

  const explicitHumanHandoff = optionalBoolean(rawFeatures.humanHandoff, "features.humanHandoff");
  const explicitSentiment = optionalBoolean(
    rawFeatures.sentimentAnalysis,
    "features.sentimentAnalysis",
  );
  const humanHandoff = explicitHumanHandoff ?? legacyNotification !== undefined;
  const sentimentAnalysis = explicitSentiment ?? legacyEscalation?.sentimentThreshold !== undefined;

  const rawInterfaceConfig = optionalObject(args.interfaceConfig, "interfaceConfig") ?? {};
  const humanEmail = optionalString(
    rawInterfaceConfig.humanEmail ?? legacyNotification?.recipient,
    "interfaceConfig.humanEmail",
  );
  const rawHumanEmailCredentials =
    rawInterfaceConfig.humanEmailCredentials ?? legacyNotification?.credentials;
  const humanEmailCredentials =
    rawHumanEmailCredentials === undefined
      ? undefined
      : parseSmtpCredentialReference(rawHumanEmailCredentials);

  if (humanHandoff) {
    requireNonEmptyString(humanEmail, "interfaceConfig.humanEmail");
    if (!humanEmailCredentials || Object.keys(humanEmailCredentials).length === 0) {
      throw new Error("interfaceConfig.humanEmailCredentials must contain credential references");
    }
  }

  const credentialRequired = aiProvider === "openai" || sentimentAnalysis;
  const credentialId =
    rawAIConfig.credentialId === undefined
      ? undefined
      : requireNonEmptyString(rawAIConfig.credentialId, "aiConfig.credentialId");
  const credentialName =
    rawAIConfig.credentialName === undefined
      ? undefined
      : requireNonEmptyString(rawAIConfig.credentialName, "aiConfig.credentialName");
  if (credentialRequired && (!credentialId || !credentialName)) {
    throw new Error(
      "aiConfig credentialId and credentialName are required for OpenAI-backed nodes",
    );
  }

  const systemPromptValue = rawAIConfig.systemPrompt ?? args.systemPrompt;
  const systemPrompt =
    systemPromptValue === undefined
      ? undefined
      : requireNonEmptyString(systemPromptValue, "aiConfig.systemPrompt");
  const temperature = optionalNumber(rawAIConfig.temperature, "aiConfig.temperature");
  if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
    throw new Error("aiConfig.temperature must be between 0 and 2");
  }
  const maxTokens = optionalNumber(rawAIConfig.maxTokens, "aiConfig.maxTokens");
  if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens < 1)) {
    throw new Error("aiConfig.maxTokens must be a positive integer");
  }
  const path = optionalString(rawInterfaceConfig.path, "interfaceConfig.path");
  const activate = optionalBoolean(args.activate, "activate");

  return {
    name: requireNonEmptyString(args.name, "name"),
    interface: interfaceName,
    aiProvider,
    aiConfig: {
      model,
      ...(credentialId !== undefined ? { credentialId } : {}),
      ...(credentialName !== undefined ? { credentialName } : {}),
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    },
    interfaceConfig: {
      ...(path !== undefined ? { path } : {}),
      ...(humanEmail !== undefined ? { humanEmail } : {}),
      ...(humanEmailCredentials !== undefined ? { humanEmailCredentials } : {}),
    },
    features: {
      ...(humanHandoff ? { humanHandoff: true } : {}),
      ...(sentimentAnalysis ? { sentimentAnalysis: true } : {}),
    },
    ...(activate !== undefined ? { activate } : {}),
  };
}

function validateConfirmationFields(args: Record<string, unknown>): void {
  optionalBoolean(args.confirm, "confirm");
  if (args.confirmationToken !== undefined) {
    requireNonEmptyString(args.confirmationToken, "confirmationToken");
  }
}

function parsePreviewWorkflowDiffArgs(args: Record<string, unknown>): Record<string, unknown> {
  optionalObject(args.policy, "policy");
  return {
    ...args,
    workflowId: requireNonEmptyString(args.workflowId, "workflowId"),
    operations: requireOperations(args.operations),
  };
}

function parseUpdatePartialWorkflowArgs(args: Record<string, unknown>): Record<string, unknown> {
  optionalObject(args.policy, "policy");
  validateConfirmationFields(args);
  return {
    ...args,
    workflowId: requireNonEmptyString(args.workflowId, "workflowId"),
    operations: requireOperations(args.operations),
    sourcePreviewCallId: requireNonEmptyString(args.sourcePreviewCallId, "sourcePreviewCallId"),
    sourcePreviewOperationIndexes: optionalNumberArray(
      args.sourcePreviewOperationIndexes,
      "sourcePreviewOperationIndexes",
    ),
  };
}

function parseProcessingSteps(value: unknown): Array<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("processing must be an array");
  return value.map((candidate, index) => {
    const step = requireObject(candidate, `processing[${index}]`);
    return {
      ...step,
      action: requireEnumString(step.action, `processing[${index}].action`, [
        "transform",
        "validate",
      ]),
      config: requireObject(step.config, `processing[${index}].config`),
    };
  });
}

function parseValidationRules(value: unknown): Array<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("validationRules must be an array");
  return value.map((candidate, index) => {
    const rule = requireObject(candidate, `validationRules[${index}]`);
    return {
      ...rule,
      field: requireNonEmptyString(rule.field, `validationRules[${index}].field`),
      condition: requireEnumString(rule.condition, `validationRules[${index}].condition`, [
        "exists",
        "equals",
        "contains",
        "matches",
      ]),
      expectedValue: optionalString(rule.expectedValue, `validationRules[${index}].expectedValue`),
    };
  });
}

function parseOrchestratedToolArgs(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  switch (name) {
    case "create_scheduled_workflow":
      optionalBoolean(args.activate, "activate");
      return {
        ...args,
        name: requireNonEmptyString(args.name, "name"),
        schedule: requireNonEmptyString(args.schedule, "schedule"),
        action: requireEnumString(args.action, "action", [
          "send_email",
          "http_request",
          "slack_message",
        ]),
        actionConfig: requireObject(args.actionConfig, "actionConfig"),
      };
    case "create_webhook_workflow":
      optionalBoolean(args.activate, "activate");
      optionalObject(args.responseTemplate, "responseTemplate");
      return {
        ...args,
        name: requireNonEmptyString(args.name, "name"),
        path: optionalString(args.path, "path"),
        method:
          args.method === undefined
            ? undefined
            : requireEnumString(args.method, "method", ["GET", "POST", "PUT", "DELETE", "PATCH"]),
        processing: parseProcessingSteps(args.processing),
      };
    case "create_ai_chatbot_workflow":
      return parseAIChatbotArgs(args);
    case "create_email_workflow":
      optionalBoolean(args.activate, "activate");
      optionalObject(args.triggerConfig, "triggerConfig");
      if (args.conditions !== undefined && !Array.isArray(args.conditions)) {
        throw new Error("conditions must be an array");
      }
      return {
        ...args,
        name: requireNonEmptyString(args.name, "name"),
        trigger: requireEnumString(args.trigger, "trigger", ["webhook", "schedule", "manual"]),
        emailTemplate: requireObject(args.emailTemplate, "emailTemplate"),
      };
    case "deploy_and_test_workflow":
      validateConfirmationFields(args);
      optionalBoolean(args.rollbackOnFailure, "rollbackOnFailure");
      return {
        ...args,
        workflowId: requireNonEmptyString(args.workflowId, "workflowId"),
        testData: requireObject(args.testData, "testData"),
        validationRules: parseValidationRules(args.validationRules),
      };
    case "fix_workflow_errors":
      return {
        workflowId: requireNonEmptyString(args.workflowId, "workflowId"),
      };
    default:
      return args;
  }
}
// Workflow-creating orchestrated/blueprint tools all return { workflow: <created> }.
const createFromWorkflowField: MutationDescriptor = {
  op: () => "create",
  captureBefore: false,
  idFrom: (_a, o) => idOf(asObj(o).workflow),
  after: (o) => asObj(o).workflow,
};

const MUTATION_DESCRIPTORS: Record<string, MutationDescriptor> = {
  create_workflow: {
    op: () => "create",
    captureBefore: false,
    idFrom: (_a, o) => idOf(o),
    after: (o) => o,
  },
  update_workflow: {
    op: () => "update",
    captureBefore: true,
    idFrom: (a) => strId(a.id),
    after: (o) => o,
  },
  delete_workflow: {
    op: () => "delete",
    captureBefore: true,
    idFrom: (a) => strId(a.id),
    after: () => null,
  },
  activate_workflow: {
    op: (a) => (a.active ? "activate" : "deactivate"),
    captureBefore: true,
    idFrom: (a) => strId(a.id),
    after: (o) => o,
  },
  import_workflow_template: {
    op: () => "create",
    captureBefore: false,
    idFrom: (_a, o) => strId(asObj(o).workflow_id),
    after: (o) => o,
  },
  apply_workflow_patch: {
    op: () => "update",
    captureBefore: true,
    idFrom: (a) => strId(a.id),
    after: (o) => asObj(o).workflow ?? o,
  },
  safe_apply_workflow_patch: {
    op: () => "update",
    captureBefore: true,
    idFrom: (a) => strId(a.id),
    after: (o) => asObj(o).workflow ?? o,
  },
  update_partial_workflow: {
    op: () => "update",
    captureBefore: true,
    idFrom: (a) => strId(a.workflowId),
    after: (o) => asObj(o).workflow ?? o,
  },
  clone_workflow_as_draft: {
    op: () => "create",
    captureBefore: false,
    idFrom: (_a, o) => idOf(asObj(o).draft_workflow),
    after: (o) => asObj(o).draft_workflow,
  },
  safe_apply_workflow_simplification: {
    op: () => "create",
    captureBefore: false,
    idFrom: (_a, o) => idOf(asObj(o).draft_workflow),
    after: (o) => asObj(o).draft_workflow,
  },
  create_workflow_from_blueprint: createFromWorkflowField,
  create_scheduled_workflow: createFromWorkflowField,
  create_webhook_workflow: createFromWorkflowField,
  create_email_workflow: createFromWorkflowField,
  create_ai_chatbot_workflow: createFromWorkflowField,
  deploy_and_test_workflow: {
    op: () => "update",
    captureBefore: true,
    idFrom: (a) => strId(a.workflowId),
    after: (o) => asObj(o).workflow ?? o,
  },
};

/** GET a workflow for a before-snapshot. A failed fetch must never block the mutation. */
async function fetchSnapshotSafe(inst: Inst, id: string): Promise<unknown> {
  try {
    return await n8n(inst, `/api/v1/workflows/${encodeURIComponent(id)}`);
  } catch {
    return null;
  }
}

/** Write the audit row for a completed mutation. Best-effort; never throws into dispatch. */
async function recordMutationAudit(
  name: string,
  desc: MutationDescriptor,
  args: Record<string, unknown>,
  out: unknown,
  before: unknown,
  inst: Inst,
  caller: CallerCtx,
): Promise<void> {
  const userId = caller.user_id;
  if (!userId) return;
  try {
    const outRecord = asObj(out);
    const auditBefore =
      before ?? (outRecord as Record<PropertyKey, unknown>)[PARTIAL_UPDATE_AUDIT_BEFORE] ?? null;
    const reportedAfter = desc.after(out);
    const deploymentActivated =
      name === "deploy_and_test_workflow"
        ? asObj(asObj(outRecord.results).activation).success === true
        : null;
    const after = deploymentActivated === false ? auditBefore : reportedAfter;
    const workflowId = desc.idFrom(args, out) ?? strId(args.id) ?? strId(args.workflowId);
    if (!workflowId) return;
    await recordWorkflowAudit({
      userId,
      instanceId: inst.id,
      workflowId,
      operation: desc.op(args),
      snapshotBefore: auditBefore,
      snapshotAfter: after,
      changes: auditBefore ? calculateChanges(auditBefore, after) : undefined,
      aiReasoning: typeof args.reasoning === "string" ? args.reasoning : null,
      toolName: name,
      toolParams: auditToolParams(name, args, out),
      ipAddress: caller.ip ?? null,
      userAgent: caller.ua ?? null,
      sessionId: caller.request_id ?? null,
    });
  } catch (e) {
    console.warn("[mcp.audit] hook failed", e);
  }
}

export function shouldRecordMutationAudit(name: string, output: unknown): boolean {
  const result = asObj(output);
  if (name === "deploy_and_test_workflow") {
    return Object.keys(asObj(result.results)).length > 0;
  }
  if (name === "fix_workflow_errors" || result.success === false) return false;
  return true;
}

function auditToolParams(
  name: string,
  args: Record<string, unknown>,
  out: unknown,
): Record<string, unknown> {
  const output = asObj(out);
  if (name === "deploy_and_test_workflow") {
    const results = asObj(output.results);
    const test = asObj(results.test);
    const activation = asObj(results.activation);
    return {
      workflowId: strId(args.workflowId),
      workflowFingerprint: strId(output.workflowFingerprint),
      businessSuccess: output.success === true,
      validation: results.validation,
      smokeTest: {
        success: test.success === true,
        error: typeof test.error === "string" ? test.error : null,
      },
      activation: {
        success: activation.success === true,
        error: typeof activation.error === "string" ? activation.error : null,
      },
    };
  }
  return {
    ...args,
    ...(output.diff !== undefined ? { diff: output.diff } : {}),
    ...(output.validation !== undefined ? { validation: output.validation } : {}),
    ...(output.results !== undefined ? { results: output.results } : {}),
    ...(output.resolvedPolicy !== undefined ? { resolvedPolicy: output.resolvedPolicy } : {}),
    ...(name === "fix_workflow_errors" && output.applied !== undefined
      ? { applied: output.applied }
      : {}),
  };
}

async function handleAuditReadTool(
  name: string,
  args: Record<string, unknown>,
  userId: string | undefined,
): Promise<unknown> {
  if (!userId) throw new Error("Authentication required");
  switch (name) {
    case "get_workflow_history": {
      const workflowId = String(args.workflowId ?? "");
      if (!workflowId) throw new Error("workflowId is required");
      const limit = typeof args.limit === "number" ? args.limit : 20;
      return {
        workflow_id: workflowId,
        history: await getWorkflowHistory(userId, workflowId, limit),
      };
    }
    case "get_audit_statistics": {
      const days = typeof args.days === "number" ? args.days : 30;
      return getAuditStatistics(userId, days);
    }
    case "detect_suspicious_activity": {
      const hours = typeof args.hours === "number" ? args.hours : 24;
      return { findings: await detectSuspiciousActivity(userId, hours) };
    }
    default:
      throw new Error(`Unknown audit tool: ${name}`);
  }
}

/**
 * Roll a workflow back to a prior audited snapshot. Marks the audit row rolled
 * back (owner-scoped), re-applies snapshot_before to n8n, and records the
 * rollback itself as a new audit row.
 */
async function handleRollback(
  args: Record<string, unknown>,
  inst: Inst,
  caller?: CallerCtx,
): Promise<unknown> {
  const userId = caller?.user_id;
  if (!userId) throw new Error("Authentication required");
  const auditLogId = String(args.auditLogId ?? "");
  if (!auditLogId) throw new Error("auditLogId is required");

  const auditRow = await getRollbackSnapshotForUser(userId, auditLogId);
  const snap = asObj(auditRow.snapshot_before);
  const workflowId = auditRow.workflow_id;
  const snapshotWorkflowId = strId(snap.id);
  if (snapshotWorkflowId && snapshotWorkflowId !== workflowId) {
    throw new Error("Rollback snapshot workflow id does not match the audit record");
  }

  const validation = await workflowValidationService.validateWorkflow(
    requireWorkflow({ ...snap, id: workflowId }),
  );
  if (!validation.ok) {
    return {
      success: false,
      workflow_id: workflowId,
      rolled_back_from: auditLogId,
      validation,
      message: "Rollback snapshot failed validation; workflow was not restored.",
    };
  }

  const before = await fetchSnapshotSafe(inst, workflowId);
  const restored = await n8n(inst, `/api/v1/workflows/${encodeURIComponent(workflowId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      name: snap.name,
      nodes: snap.nodes,
      connections: snap.connections,
      settings: snap.settings ?? {},
    }),
  });

  await markAuditRolledBack(userId, auditLogId);

  await recordWorkflowAudit({
    userId,
    instanceId: inst.id,
    workflowId,
    operation: "update",
    snapshotBefore: before,
    snapshotAfter: restored,
    changes: before ? calculateChanges(before, restored) : undefined,
    aiReasoning: typeof args.reason === "string" ? args.reason : "rollback",
    toolName: "rollback_workflow",
    toolParams: { auditLogId },
    ipAddress: caller?.ip ?? null,
    userAgent: caller?.ua ?? null,
    sessionId: caller?.request_id ?? null,
  });

  return {
    success: true,
    workflow_id: workflowId,
    rolled_back_from: auditLogId,
    validation,
    workflow: restored,
  };
}

async function previewWorkflowDiff(inst: Inst, args: Record<string, unknown>): Promise<unknown> {
  const workflowId = requireNonEmptyString(args.workflowId, "workflowId");
  const operations = requireOperations(args.operations);
  const policy = optionalPolicy(args.policy, args.confirm, undefined);
  workflowOperationPolicyService.assertToolAllowed("preview_workflow_diff", policy);

  const current = requireWorkflow(
    await n8n(inst, `/api/v1/workflows/${encodeURIComponent(workflowId)}`),
  );
  const { workflow, diff } = workflowDiffService.applyOperations(current, operations);
  const validation = await workflowValidationService.validateWorkflow(workflow);

  return {
    success: true,
    workflowId,
    baseVersionId: strId(current.versionId) ?? undefined,
    baseFingerprint: workflowFingerprint(current),
    diff,
    validation,
  };
}

async function updatePartialWorkflow(
  inst: Inst,
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<unknown> {
  const workflowId = requireNonEmptyString(args.workflowId, "workflowId");
  const requestedOperations = requireOperations(args.operations);
  const sourcePreviewCallId = requireNonEmptyString(
    args.sourcePreviewCallId,
    "sourcePreviewCallId",
  );
  const userId = context?.user_id;
  if (!userId) throw new Error("Authentication required for partial workflow updates");
  const operationIndexes = optionalNumberArray(
    args.sourcePreviewOperationIndexes,
    "sourcePreviewOperationIndexes",
  );
  const preview = await loadTrustedWorkflowPreview(userId, sourcePreviewCallId);
  const trustedPreview = assertTrustedWorkflowPreview({
    preview,
    userId,
    workflowId,
    operations: requestedOperations,
    operationIndexes,
    sessionId: context?.request_id,
  });
  const operations = requireOperations(trustedPreview.operations);
  const policy = optionalPolicy(args.policy, args.confirm, context?.policy);
  workflowOperationPolicyService.assertToolAllowed("update_partial_workflow", policy);
  workflowOperationPolicyService.assertOperationsAllowed(operations, policy);

  const current = requireWorkflow(
    await n8n(inst, `/api/v1/workflows/${encodeURIComponent(workflowId)}`),
  );
  const currentVersionId = strId(current.versionId);
  const currentFingerprint = workflowFingerprint(current);
  const expectedVersionId = trustedPreview.baseVersionId;
  const expectedFingerprint = trustedPreview.baseFingerprint;
  if (
    (expectedVersionId && expectedVersionId !== currentVersionId) ||
    (expectedFingerprint && expectedFingerprint !== currentFingerprint)
  ) {
    throw new Error(
      "Workflow preview is stale; preview the workflow again before applying updates.",
    );
  }
  workflowOperationPolicyService.assertOperationsAllowed(operations, policy, current);

  const { workflow, diff } = workflowDiffService.applyOperations(current, operations);
  const validation = await workflowValidationService.validateWorkflow(workflow);

  if (!validation.ok) {
    const blocked = {
      success: false,
      workflowId,
      diff,
      validation,
      message: "Validation failed; workflow was not updated.",
    };
    Object.defineProperty(blocked, PARTIAL_UPDATE_AUDIT_BEFORE, { value: current });
    return blocked;
  }

  const updated = await n8n(inst, `/api/v1/workflows/${encodeURIComponent(workflowId)}`, {
    method: "PATCH",
    body: JSON.stringify(workflow),
  });

  const result = {
    success: true,
    workflow: updated,
    diff,
    validation,
    resolvedPolicy: policy,
  };
  Object.defineProperty(result, PARTIAL_UPDATE_AUDIT_BEFORE, { value: current });
  return result;
}

function workflowFingerprint(workflow: WorkflowLike): string {
  return createHash("sha256")
    .update(
      stableStringify({
        name: workflow.name ?? null,
        nodes: workflow.nodes ?? [],
        connections: workflow.connections ?? {},
        settings: workflow.settings ?? {},
        versionId: workflow.versionId ?? null,
      }),
    )
    .digest("hex");
}

/**
 * Route a tool call to local handler or upstream proxy.
 * `inst` is required for local tools and for upstream `n8n_*` management tools;
 * upstream knowledge tools work without it.
 */
export async function dispatchTool(
  name: string,
  args: Record<string, unknown>,
  inst: Inst | null,
  caller?: CallerCtx & ToolContext,
): Promise<DispatchResult> {
  const upstreamKnowledgeTool = KNOWLEDGE_TOOL_MAP[name as keyof typeof KNOWLEDGE_TOOL_MAP];
  if (upstreamKnowledgeTool) {
    if (!isUpstreamConfigured()) {
      throw new Error(
        `Knowledge tool ${name} is unavailable because the upstream knowledge MCP is not configured`,
      );
    }
    const output = await callUpstreamTool(upstreamKnowledgeTool, args, null, caller);
    return { output, upstream: true, category: "knowledge", needsInstance: false };
  }

  // Audit read tools resolve from the audit log and need only the caller's id.
  if (AUDIT_READ_TOOLS.has(name)) {
    const output = await handleAuditReadTool(name, args, caller?.user_id);
    return { output, upstream: false, category: "local", needsInstance: false };
  }
  // Rollback re-applies a prior snapshot, so it also needs an n8n instance.
  if (name === "rollback_workflow") {
    if (!inst) {
      return { output: null, upstream: false, category: "local", needsInstance: true };
    }
    if (!caller?.user_id) throw new Error("Authentication required");
    await requireConfirmation(
      args,
      "Rollback workflow",
      {
        requireToken: true,
        scope: { auditLogId: args.auditLogId },
      },
      caller,
    );
    const output = await handleRollback(args, inst, caller);
    return { output, upstream: false, category: "local", needsInstance: false };
  }

  if (name === "validate_workflow") {
    const output = await validateWorkflowViaUpstream(args);
    return { output, upstream: false, category: "local", needsInstance: false };
  }

  if (AGENT_READ_TOOLS.has(name)) {
    const output = await runTool(inst ?? ({} as Inst), name, args, caller);
    return { output, upstream: false, category: "local", needsInstance: false };
  }

  if (AGENT_INSTANCE_TOOLS.has(name)) {
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
