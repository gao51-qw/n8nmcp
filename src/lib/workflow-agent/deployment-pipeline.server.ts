import { createHash } from "node:crypto";

import type { WorkflowLike } from "../workflow-agent";

export type DeploymentValidationRule = {
  field: string;
  condition: string;
  expectedValue?: string;
};

export type DeploymentInput = {
  userId: string;
  workflowId: string;
  testData: Record<string, unknown>;
  validationRules?: DeploymentValidationRule[];
  confirmationToken?: string;
};

type ValidationResult = {
  ok: boolean;
  errors?: Array<string | { message?: string }>;
  warnings?: Array<string | { message?: string }>;
  knowledgeMode?: "authoritative" | "degraded";
};

type SmokeExecution = {
  finished?: boolean;
  error?: unknown;
  output?: Record<string, unknown> | null;
};

export interface DeploymentConfirmationService {
  requireOrConsume(input: {
    userId: string;
    action: string;
    scope: unknown;
    confirmationToken?: string;
  }): Promise<void>;
}

export type WorkflowDeploymentDependencies = {
  loadWorkflow(workflowId: string): Promise<WorkflowLike & Record<string, unknown>>;
  validateWorkflow(workflow: WorkflowLike): Promise<ValidationResult>;
  confirmation: DeploymentConfirmationService;
  runWorkflow(
    workflowId: string,
    workflow: WorkflowLike,
    testData: Record<string, unknown>,
  ): Promise<SmokeExecution>;
  activateWorkflow(workflowId: string): Promise<void>;
  deactivateWorkflow(workflowId: string): Promise<void>;
  /**
   * Smoke-tests the inactive draft without activating it (n8n instance-level
   * MCP, `manual` mode). Returns null when that is not possible for this
   * instance or workflow, in which case the pipeline falls back to activating
   * first and testing through the production webhook.
   */
  runManualSmoke?(
    workflowId: string,
    workflow: WorkflowLike,
    testData: Record<string, unknown>,
  ): Promise<SmokeExecution | null>;
};

export type DeploymentResult = {
  success: boolean;
  message: string;
  workflowFingerprint: string;
  results: {
    validation: { passed: boolean; errors: string[]; warnings: string[] };
    test: {
      success: boolean;
      output: Record<string, unknown> | null;
      error: string | null;
      /** "manual": inactive draft via native MCP; "production": live webhook. */
      mode?: "manual" | "production";
      executionSource?: "native_mcp" | "webhook";
    };
    activation: { success: boolean; error: string | null; rolledBack: boolean };
  };
};

export class WorkflowDeploymentPipeline {
  constructor(private readonly dependencies: WorkflowDeploymentDependencies) {}

  async deploy(input: DeploymentInput): Promise<DeploymentResult> {
    const workflow = await this.dependencies.loadWorkflow(input.workflowId);
    const workflowFingerprint = digest(stableStringify(workflow));
    const result = emptyResult(workflowFingerprint);

    if (workflow.active === true) {
      result.message = "Deployment requires an inactive draft.";
      return result;
    }

    const validation = await this.dependencies.validateWorkflow(workflow);
    result.results.validation = {
      passed: validation.ok,
      errors: messages(validation.errors),
      warnings: messages(validation.warnings),
    };

    if (validation.knowledgeMode === "degraded") {
      result.message = "Knowledge validation is degraded; deployment is blocked.";
      return result;
    }
    if (!validation.ok) {
      result.message = "Validation failed.";
      return result;
    }
    if (result.results.validation.warnings.length > 0) {
      result.message = "Validation warnings block automatic activation.";
      return result;
    }

    const rules = input.validationRules ?? [];
    await this.dependencies.confirmation.requireOrConsume({
      userId: input.userId,
      action: "deploy_and_test_workflow",
      scope: {
        workflowId: input.workflowId,
        workflowVersion: typeof workflow.versionId === "string" ? workflow.versionId : null,
        workflowFingerprint,
        testDataDigest: digest(stableStringify(input.testData)),
        outputRulesDigest: digest(stableStringify(rules)),
        activate: true,
      },
      confirmationToken: input.confirmationToken,
    });

    // Preferred: test the inactive draft through n8n's instance-level MCP and
    // only activate once it passed, so a failing test never touches production.
    if (this.dependencies.runManualSmoke) {
      let manual: SmokeExecution | null;
      try {
        manual = await this.dependencies.runManualSmoke(input.workflowId, workflow, input.testData);
      } catch (error) {
        result.results.test = {
          ...result.results.test,
          mode: "manual",
          executionSource: "native_mcp",
        };
        result.results.test.error = errorMessage(error);
        result.message = "Smoke test failed; the workflow was not activated.";
        return result;
      }
      if (manual) {
        result.results.test = {
          ...result.results.test,
          mode: "manual",
          executionSource: "native_mcp",
        };
        const testError = applySmokeExecution(result, manual, rules);
        if (testError) {
          result.message = `${testError}; the workflow was not activated.`;
          return result;
        }
        try {
          await this.dependencies.activateWorkflow(input.workflowId);
          result.results.activation.success = true;
        } catch (error) {
          result.results.activation.error = errorMessage(error);
          try {
            await this.dependencies.deactivateWorkflow(input.workflowId);
          } catch (deactivationError) {
            result.results.activation.error += `; safety deactivation failed: ${errorMessage(deactivationError)}`;
          }
          result.message =
            "Activation failed after a passing smoke test; a safety deactivation was attempted.";
          return result;
        }
        result.success = true;
        result.message = "Workflow passed a smoke test as an inactive draft and was activated.";
        return result;
      }
    }

    // Fallback: the n8n Public API cannot start an execution; the smoke test goes
    // through the workflow's production webhook, which n8n only registers while the
    // workflow is active. So activate first, smoke-test, and deactivate again on
    // any failure.
    result.results.test = {
      ...result.results.test,
      mode: "production",
      executionSource: "webhook",
    };
    try {
      await this.dependencies.activateWorkflow(input.workflowId);
      result.results.activation.success = true;
    } catch (error) {
      result.results.activation.error = errorMessage(error);
      try {
        await this.dependencies.deactivateWorkflow(input.workflowId);
      } catch (deactivationError) {
        result.results.activation.error += `; safety deactivation failed: ${errorMessage(deactivationError)}`;
      }
      result.message = "Activation failed; a safety deactivation was attempted.";
      return result;
    }

    let execution: SmokeExecution;
    try {
      execution = await this.dependencies.runWorkflow(input.workflowId, workflow, input.testData);
    } catch (error) {
      result.results.test.error = errorMessage(error);
      return this.deactivateAfterFailure(result, input.workflowId, "Smoke test failed");
    }

    const testError = applySmokeExecution(result, execution, rules);
    if (testError) return this.deactivateAfterFailure(result, input.workflowId, testError);

    result.success = true;
    result.message = "Workflow activated and smoke-tested successfully.";
    return result;
  }

  private async deactivateAfterFailure(
    result: DeploymentResult,
    workflowId: string,
    reason: string,
  ): Promise<DeploymentResult> {
    try {
      await this.dependencies.deactivateWorkflow(workflowId);
      result.results.activation.success = false;
      result.results.activation.rolledBack = true;
      result.message = `${reason}; workflow was deactivated.`;
    } catch (error) {
      result.results.activation.error = `safety deactivation failed: ${errorMessage(error)}`;
      result.message = `${reason}; safety deactivation failed, the workflow is still active.`;
    }
    return result;
  }
}

/**
 * Records a smoke execution on the result. Returns the failure reason, or null
 * when the run finished cleanly and its output satisfied every rule.
 */
function applySmokeExecution(
  result: DeploymentResult,
  execution: SmokeExecution,
  rules: DeploymentValidationRule[],
): string | null {
  result.results.test.output = execution.output ?? null;
  result.results.test.success = execution.finished === true && execution.error === undefined;
  if (!result.results.test.success) {
    result.results.test.error = errorMessage(
      execution.error ?? "Workflow execution did not finish",
    );
    return "Smoke test failed";
  }
  const ruleError = evaluateRules(result.results.test.output, rules);
  if (ruleError) {
    result.results.test.success = false;
    result.results.test.error = ruleError;
    return "Smoke-test output validation failed";
  }
  return null;
}

function emptyResult(workflowFingerprint: string): DeploymentResult {
  return {
    success: false,
    message: "Deployment did not complete.",
    workflowFingerprint,
    results: {
      validation: { passed: false, errors: [], warnings: [] },
      test: { success: false, output: null, error: null },
      activation: { success: false, error: null, rolledBack: false },
    },
  };
}

function messages(values: ValidationResult["errors"]): string[] {
  return (values ?? []).map((value) =>
    typeof value === "string" ? value : (value.message ?? "Validation issue"),
  );
}

function evaluateRules(
  output: Record<string, unknown> | null,
  rules: DeploymentValidationRule[],
): string | null {
  for (const rule of rules) {
    const value = output?.[rule.field];
    const valid =
      rule.condition === "exists"
        ? value !== undefined && value !== null
        : rule.condition === "equals"
          ? String(value) === String(rule.expectedValue)
          : rule.condition === "not_equals"
            ? String(value) !== String(rule.expectedValue)
            : false;
    if (!valid) {
      return `Validation failed for field '${rule.field}': expected ${rule.condition}${rule.expectedValue === undefined ? "" : ` ${rule.expectedValue}`}`;
    }
  }
  return null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
