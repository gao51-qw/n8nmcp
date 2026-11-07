// runTool: the local MCP tool implementations (CRUD, graph analysis and patch,
// blueprint and orchestrated tools) against the caller's n8n instance (server-only).
import { callUpstreamTool, isUpstreamConfigured } from "@/lib/mcp-upstream.server";
import type { WorkflowLike } from "@/lib/workflow-agent";
import { WorkflowCreationPipeline } from "@/lib/workflow-agent/creation-pipeline.server";
import {
  asObj,
  parsePreviewWorkflowDiffArgs,
  parseUpdatePartialWorkflowArgs,
  requireNonEmptyString,
} from "./args";
import { requireConfirmation } from "./confirmation.server";
import { n8n } from "./n8n-client.server";
import { ORCHESTRATED_TOOL_NAMES, parseOrchestratedToolArgs } from "./orchestrated-args";
import { previewWorkflowDiff, updatePartialWorkflow } from "./partial-update.server";
import {
  deferredProductionKnowledgeClient,
  nodeKnowledgeService,
  workflowValidationService,
} from "./services.server";
import type { N8nInstance, ToolContext } from "./types";
import {
  attachConcurrencyResult,
  putWorkflowAndVerify,
  verifyWorkflowWrite,
} from "./write-verification.server";

export async function runTool(
  inst: N8nInstance,
  name: string,
  args: Record<string, unknown>,
  context?: ToolContext,
): Promise<unknown> {
  // Orchestrated tools. Note: this must list the orchestrated tool names
  // explicitly — a `create_*` prefix match would swallow the basic
  // `create_workflow` CRUD tool, which is handled in the switch below.
  if (ORCHESTRATED_TOOL_NAMES.has(name)) {
    const parsedArgs = parseOrchestratedToolArgs(name, args);
    const { OrchestratedToolsService } = await import("@/lib/orchestrated-tools.service");
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
    case "execute_workflow": {
      if (!args.id) throw new Error("id (workflow id) is required");
      const id = String(args.id);
      await requireConfirmation(args, "Execute workflow", {}, context);

      // Preferred: n8n's instance-level MCP server, when a token is stored and
      // it offers execute_workflow. Active workflows run their published
      // version ("production"); inactive drafts run as a manual test.
      let nativeFallback: string | null = null;
      const { nativeToolAvailable } = await import("@/lib/n8n-native-execution.server");
      if (nativeToolAvailable(inst, "execute_workflow")) {
        const { nativeClientFor, runViaNativeMcp } =
          await import("@/lib/n8n-native-execution.server");
        const { NativeMcpError } = await import("@/lib/n8n-native-mcp.server");
        const workflow = (await n8n(
          inst,
          `/api/v1/workflows/${encodeURIComponent(id)}`,
        )) as WorkflowLike;
        const mode = workflow.active === true ? "production" : "manual";
        try {
          const run = await runViaNativeMcp(nativeClientFor(inst), {
            workflowId: id,
            workflow,
            mode,
            data: asObj(args.data),
          });
          if (run.started) {
            const execution = run.execution;
            return {
              success: true,
              workflowId: id,
              executionSource: "native_mcp",
              mode,
              execution,
              message: execution?.finished
                ? `Execution ${run.executionId} finished with status ${execution.status ?? "unknown"}.`
                : `Execution ${run.executionId} is still running; check it with list_executions.`,
            };
          }
          nativeFallback = run.error;
        } catch (error) {
          // A network failure while starting leaves it unknown whether n8n ran
          // the workflow; do not risk running it a second time.
          if (!(error instanceof NativeMcpError) || error.kind === "unavailable") throw error;
          nativeFallback = error.message;
        }
      }

      // The Public API has no execution endpoint: run the workflow through its
      // production webhook and report the execution n8n recorded for it.
      const {
        latestExecutionId,
        resolveWebhookTrigger,
        triggerWorkflowWebhook,
        waitForNewExecution,
      } = await import("@/lib/n8n-execution.server");
      const workflow = (await n8n(
        inst,
        `/api/v1/workflows/${encodeURIComponent(id)}`,
      )) as Parameters<typeof triggerWorkflowWebhook>[1];
      resolveWebhookTrigger(workflow); // fail fast before touching executions
      const request = (path: string, init?: RequestInit) => n8n(inst, path, init);
      const previousExecutionId = await latestExecutionId(request, id);
      const webhook = await triggerWorkflowWebhook(inst.base_url, workflow, asObj(args.data));
      const execution = await waitForNewExecution(request, id, {
        excludeId: previousExecutionId,
      });
      return {
        success: true,
        workflowId: id,
        executionSource: "webhook",
        mode: "production",
        ...(nativeFallback ? { nativeFallbackReason: nativeFallback } : {}),
        webhook,
        execution,
        message: execution
          ? execution.finished
            ? `Execution ${execution.id ?? "?"} finished with status ${execution.status ?? "unknown"}.`
            : `Execution ${execution.id ?? "?"} is still running; check it with list_executions.`
          : "Webhook accepted the request but no new execution was recorded yet; check list_executions.",
      };
    }
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
      // The Public API only supports PUT with a complete workflow body, so merge the
      // provided fields into the current workflow instead of sending a partial patch.
      const { toWorkflowUpdatePayload } = await import("@/lib/workflow-graph");
      const current = (await n8n(
        inst,
        `/api/v1/workflows/${encodeURIComponent(id)}`,
      )) as Parameters<typeof toWorkflowUpdatePayload>[0];
      const payload = toWorkflowUpdatePayload(
        current,
        args.name !== undefined ? { name: String(args.name) } : {},
      );
      const { written, concurrency } = await putWorkflowAndVerify(
        inst,
        id,
        payload,
        current,
        "update_workflow",
      );
      // The output stays the n8n workflow; flag fields are added only when a
      // concurrent write was detected.
      return written && typeof written === "object" && !Array.isArray(written)
        ? attachConcurrencyResult({ ...(written as Record<string, unknown>) }, concurrency)
        : written;
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
    case "analyze_workflow_graph": {
      if (!args.id) throw new Error("id (workflow id) is required");
      const { analyzeWorkflowGraph } = await import("@/lib/workflow-graph");
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
      const {
        analyzeWorkflowGraph,
        applyWorkflowPatch,
        toWorkflowUpdatePayload,
        validateWorkflowPatch,
      } = await import("@/lib/workflow-graph");
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
      const { written: updated, concurrency } = await putWorkflowAndVerify(
        inst,
        String(args.id),
        toWorkflowUpdatePayload(patched.workflow),
        workflow,
        "apply_workflow_patch",
      );

      return attachConcurrencyResult(
        {
          success: true,
          changed: patched.changed,
          workflow: updated,
          analysis: analyzeWorkflowGraph(patched.workflow),
        },
        concurrency,
      );
    }
    case "preview_workflow_patch": {
      if (!args.id) throw new Error("id (workflow id) is required");
      if (!args.patch || typeof args.patch !== "object") {
        throw new Error("patch (object) is required");
      }
      const { analyzeWorkflowGraph, createPatchDiff, validateWorkflowPatch } =
        await import("@/lib/workflow-graph");
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
        toWorkflowUpdatePayload,
        validateWorkflowPatch,
      } = await import("@/lib/workflow-graph");
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
      const patchedPayload = toWorkflowUpdatePayload(patched.workflow);
      const updated = await n8n(inst, `/api/v1/workflows/${encodeURIComponent(String(args.id))}`, {
        method: "PUT",
        body: JSON.stringify(patchedPayload),
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
        const rollbackPayload = toWorkflowUpdatePayload(rolledBack.workflow);
        const rollbackWorkflow = await n8n(
          inst,
          `/api/v1/workflows/${encodeURIComponent(String(args.id))}`,
          {
            method: "PUT",
            body: JSON.stringify(rollbackPayload),
          },
        );
        // Verify only the final write (one re-read): its base is our own
        // first PUT, the last state we saw before the rollback PUT.
        const concurrency = await verifyWorkflowWrite(
          inst,
          String(args.id),
          rollbackPayload,
          updated,
          rollbackWorkflow,
          "safe_apply_workflow_patch",
        );

        return attachConcurrencyResult(
          {
            success: false,
            rolled_back: true,
            workflow: updated,
            rollback_workflow: rollbackWorkflow,
            diff,
            rollback_patch: rollbackPatch,
            post_apply_validation: postApplyValidation,
            message: "Post-apply validation failed; rollback patch was applied.",
          },
          concurrency,
        );
      }

      const concurrency = await verifyWorkflowWrite(
        inst,
        String(args.id),
        patchedPayload,
        workflow,
        updated,
        "safe_apply_workflow_patch",
      );
      return attachConcurrencyResult(
        {
          success: true,
          rolled_back: false,
          workflow: updated,
          diff,
          rollback_patch: rollbackPatch,
          post_apply_validation: postApplyValidation,
          analysis: analyzeWorkflowGraph(patched.workflow),
        },
        concurrency,
      );
    }
    case "propose_workflow_patch": {
      if (!args.id) throw new Error("id (workflow id) is required");
      const { analyzeWorkflowGraph, proposeWorkflowPatch } = await import("@/lib/workflow-graph");
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
        await import("@/lib/workflow-graph");
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
        await import("@/lib/workflow-graph");
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
        await import("@/lib/workflow-graph");
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
      const { summarizeWorkflowModules } = await import("@/lib/workflow-graph");
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
      const { summarizeWorkflowSemanticModules } = await import("@/lib/workflow-graph");
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
      const { inferWorkflowBusinessIntent } = await import("@/lib/workflow-graph");
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
      const { createWorkflowReviewBatches } = await import("@/lib/workflow-graph");
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
      const { auditExpressionDependencies } = await import("@/lib/workflow-graph");
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
      const { cloneWorkflowAsDraft } = await import("@/lib/workflow-graph");
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
      } = await import("@/lib/workflow-blueprint");
      const { auditN8nAgentRules } = await import("@/lib/n8n-agent-rules");
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
