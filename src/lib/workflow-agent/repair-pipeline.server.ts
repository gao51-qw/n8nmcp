import { createHash } from "node:crypto";

import { WorkflowDiffService, type WorkflowLike, type WorkflowOperation } from "../workflow-agent";
import type { DeploymentConfirmationService } from "./deployment-pipeline.server";

type FailedExecution = { error: string; node?: string };
type Validation = { ok: boolean; errors?: unknown[]; warnings?: unknown[] };

export type RepairPipelineDependencies = {
  loadWorkflow(workflowId: string): Promise<WorkflowLike>;
  loadFailedExecutions(workflowId: string): Promise<FailedExecution[]>;
  validateProposal(workflow: WorkflowLike): Promise<Validation>;
  savePreview(input: {
    userId: string;
    workflowId: string;
    operations: WorkflowOperation[];
    baseVersionId?: string;
    baseFingerprint: string;
    validation: Validation;
  }): Promise<string>;
  confirmation: DeploymentConfirmationService;
  applyPartialUpdate(input: {
    userId: string;
    workflowId: string;
    sourcePreviewCallId: string;
    operations: WorkflowOperation[];
  }): Promise<{ workflow: WorkflowLike; auditLogId: string }>;
  smokeTest(input: {
    workflowId: string;
    workflow: WorkflowLike;
    testData: Record<string, unknown>;
  }): Promise<{ success: boolean; error?: string }>;
  rollback(input: {
    userId: string;
    workflowId: string;
    auditLogId: string;
  }): Promise<{ success: boolean; error?: string }>;
};

export class WorkflowRepairPipeline {
  private readonly diff = new WorkflowDiffService();

  constructor(private readonly dependencies: RepairPipelineDependencies) {}

  async propose(input: { userId: string; workflowId: string }) {
    const [workflow, executions] = await Promise.all([
      this.dependencies.loadWorkflow(input.workflowId),
      this.dependencies.loadFailedExecutions(input.workflowId),
    ]);
    const { operations, recommendations } = classifyRepairEvidence(executions);
    const proposed = this.diff.applyOperations(workflow, operations).workflow;
    const validation = await this.dependencies.validateProposal(proposed);
    if (!validation.ok) {
      return { success: false, operations: [], recommendations, validation };
    }

    const baseFingerprint = fingerprint(workflow);
    const previewCallId = operations.length
      ? await this.dependencies.savePreview({
          userId: input.userId,
          workflowId: input.workflowId,
          operations,
          ...(typeof workflow.versionId === "string" ? { baseVersionId: workflow.versionId } : {}),
          baseFingerprint,
          validation,
        })
      : undefined;

    return {
      success: true,
      workflowId: input.workflowId,
      operations,
      recommendations,
      validation,
      previewCallId,
      baseFingerprint,
    };
  }

  async apply(input: {
    userId: string;
    workflowId: string;
    sourcePreviewCallId: string;
    operations: WorkflowOperation[];
    testData: Record<string, unknown>;
    confirmationToken?: string;
  }) {
    await this.dependencies.confirmation.requireOrConsume({
      userId: input.userId,
      action: "fix_workflow_errors",
      scope: {
        workflowId: input.workflowId,
        sourcePreviewCallId: input.sourcePreviewCallId,
        operationsDigest: digest(stableStringify(input.operations)),
        testDataDigest: digest(stableStringify(input.testData)),
      },
      confirmationToken: input.confirmationToken,
    });

    const applied = await this.dependencies.applyPartialUpdate({
      userId: input.userId,
      workflowId: input.workflowId,
      sourcePreviewCallId: input.sourcePreviewCallId,
      operations: input.operations,
    });
    const test = await this.dependencies.smokeTest({
      workflowId: input.workflowId,
      workflow: applied.workflow,
      testData: input.testData,
    });
    if (test.success) {
      return {
        success: true,
        retained: true,
        rolledBack: false,
        auditLogId: applied.auditLogId,
        test,
      };
    }

    const rollback = await this.dependencies.rollback({
      userId: input.userId,
      workflowId: input.workflowId,
      auditLogId: applied.auditLogId,
    });
    return rollback.success
      ? {
          success: false,
          retained: false,
          rolledBack: true,
          auditLogId: applied.auditLogId,
          test,
          rollback,
        }
      : {
          success: false,
          retained: false,
          rolledBack: false,
          severity: "high" as const,
          auditLogId: applied.auditLogId,
          test,
          rollback,
        };
  }
}

export function classifyRepairEvidence(executions: FailedExecution[]): {
  operations: WorkflowOperation[];
  recommendations: Array<{ node?: string; category: string; message: string }>;
} {
  const operations: WorkflowOperation[] = [];
  const recommendations: Array<{ node?: string; category: string; message: string }> = [];
  const seen = new Set<string>();

  for (const execution of executions) {
    const message = execution.error.toLowerCase();
    const node = execution.node?.trim();
    if ((message.includes("timeout") || message.includes("timed out")) && node) {
      const key = `timeout:${node}`;
      if (!seen.has(key)) {
        seen.add(key);
        operations.push({
          type: "updateNode",
          nodeId: node,
          changes: { parameters: { options: { timeout: 30_000 } } },
        });
      }
    } else if ((message.includes("rate limit") || message.includes("too many requests")) && node) {
      const key = `retry:${node}`;
      if (!seen.has(key)) {
        seen.add(key);
        operations.push({
          type: "updateNode",
          nodeId: node,
          changes: {
            parameters: {
              options: { retry: { enabled: true, maxRetries: 3, waitBetween: 5_000 } },
            },
          },
        });
      }
    } else {
      const category =
        message.includes("unauthorized") || message.includes("api key")
          ? "credentials"
          : message.includes("404") || message.includes("endpoint")
            ? "endpoint"
            : "manual";
      recommendations.push({
        ...(node ? { node } : {}),
        category,
        message: execution.error,
      });
    }
  }
  return { operations, recommendations };
}

function fingerprint(workflow: WorkflowLike): string {
  return digest(
    stableStringify({
      name: workflow.name ?? null,
      nodes: workflow.nodes ?? [],
      connections: workflow.connections ?? {},
      settings: workflow.settings ?? {},
      versionId: workflow.versionId ?? null,
    }),
  );
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
