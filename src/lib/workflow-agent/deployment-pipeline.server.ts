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
    };
    activation: { success: boolean; error: string | null };
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

    let execution: SmokeExecution;
    try {
      execution = await this.dependencies.runWorkflow(input.workflowId, workflow, input.testData);
    } catch (error) {
      result.results.test.error = errorMessage(error);
      result.message = "Smoke test failed; workflow was not activated.";
      return result;
    }

    result.results.test.output = execution.output ?? null;
    result.results.test.success = execution.finished === true && execution.error === undefined;
    if (!result.results.test.success) {
      result.results.test.error = errorMessage(
        execution.error ?? "Workflow execution did not finish",
      );
      result.message = "Smoke test failed; workflow was not activated.";
      return result;
    }

    const ruleError = evaluateRules(result.results.test.output, rules);
    if (ruleError) {
      result.results.test.success = false;
      result.results.test.error = ruleError;
      result.message = "Smoke-test output validation failed; workflow was not activated.";
      return result;
    }

    try {
      await this.dependencies.activateWorkflow(input.workflowId);
      result.results.activation.success = true;
      result.success = true;
      result.message = "Workflow tested and activated successfully.";
      return result;
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
  }
}

function emptyResult(workflowFingerprint: string): DeploymentResult {
  return {
    success: false,
    message: "Deployment did not complete.",
    workflowFingerprint,
    results: {
      validation: { passed: false, errors: [], warnings: [] },
      test: { success: false, output: null, error: null },
      activation: { success: false, error: null },
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
