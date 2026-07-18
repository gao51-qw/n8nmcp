import { NODE_REGISTRY } from "../node-registry";
import {
  type WorkflowLike,
  type WorkflowValidationIssue,
  type WorkflowValidationResult,
  WorkflowValidationService,
} from "../workflow-agent";
import {
  KnowledgeUnavailableError,
  type KnowledgeClient,
  type KnowledgeTemplateHit,
  type KnowledgeValidation,
} from "./knowledge-client.server";

const TEMPLATE_SEARCH_LIMIT = 3;
const MAX_METADATA_TEXT = 200;

export type TemplateSelectionMetadata = {
  source: "template" | "fallback";
  compatible: boolean;
  id?: string | number;
  name?: string;
  candidatesConsidered: number;
  fallbackReason?: "no_template" | "no_compatible_template" | "knowledge_unavailable";
};

export type CreationPipelineResult = {
  success: boolean;
  workflow?: WorkflowLike;
  knowledgeMode: "authoritative" | "degraded";
  knowledgeFailure?: "unavailable";
  activationEligible: boolean;
  activationIntent: boolean;
  template: TemplateSelectionMetadata;
  validation: WorkflowValidationResult;
  nextAction: "deploy_and_test_workflow";
};

export type CreationPipelineInput = {
  intent: string;
  activateIntent: boolean;
  buildFallback: () => WorkflowLike | Promise<WorkflowLike>;
  templateCompatibility: (workflow: WorkflowLike) => boolean;
};

export type WorkflowCreationPipelineDependencies = {
  knowledge: KnowledgeClient;
  createDraft: (workflow: WorkflowLike) => Promise<WorkflowLike>;
  localValidation?: Pick<WorkflowValidationService, "validateWorkflow">;
  reviewedNodeTypes?: ReadonlySet<string>;
};

type SelectedWorkflow = {
  workflow: WorkflowLike;
  reviewedFallback: WorkflowLike;
  template: TemplateSelectionMetadata;
};

type KnowledgeNodeIdentifier = {
  nodeType: string;
  packageName: string;
};

const DEFAULT_REVIEWED_NODE_TYPES = new Set(
  Object.values(NODE_REGISTRY).map((node) => node.n8nType),
);

function normalizeIntent(intent: string): string {
  const normalized = intent.trim().replace(/\s+/g, " ");
  if (!normalized) throw new Error("intent is required");
  return normalized;
}

function safeMetadataText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized ? normalized.slice(0, MAX_METADATA_TEXT) : undefined;
}

function deepClone<T>(value: T): T {
  return structuredClone(value);
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, stableValue(nested)]),
  );
}

function workflowSemanticSignature(workflow: WorkflowLike): string {
  const nodes = (Array.isArray(workflow.nodes) ? workflow.nodes : []).map((node) => {
    const { id: _id, position: _position, ...semanticNode } = node;
    return semanticNode;
  });
  return JSON.stringify(
    stableValue({
      nodes,
      connections:
        workflow.connections && typeof workflow.connections === "object"
          ? workflow.connections
          : {},
      settings: workflow.settings && typeof workflow.settings === "object" ? workflow.settings : {},
    }),
  );
}

const CANONICAL_OFFICIAL_NODE_NAME = /^[a-z][a-zA-Z0-9]*$/;

function isCanonicalOfficialNodeName(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value === value.trim() &&
    CANONICAL_OFFICIAL_NODE_NAME.test(value)
  );
}

function resolveKnowledgeNodeIdentifier(nodeType: unknown): KnowledgeNodeIdentifier | undefined {
  if (typeof nodeType !== "string" || !nodeType || nodeType !== nodeType.trim()) {
    return undefined;
  }
  const registryNode = Object.values(NODE_REGISTRY).find(
    (candidate) => candidate.n8nType === nodeType,
  );
  if (
    isCanonicalOfficialNodeName(registryNode?.officialName) &&
    typeof registryNode.packageName === "string" &&
    registryNode.packageName.length > 0 &&
    registryNode.packageName === registryNode.packageName.trim()
  ) {
    return { nodeType: registryNode.officialName, packageName: registryNode.packageName };
  }

  // Some reviewed orchestrated builders predate the blueprint registry. Keep their
  // official package/type protocol explicit without ever sending the full n8n type.
  for (const packageName of ["n8n-nodes-base", "@n8n/n8n-nodes-langchain"] as const) {
    const prefix = `${packageName}.`;
    if (nodeType.startsWith(prefix)) {
      const officialName = nodeType.slice(prefix.length);
      if (isCanonicalOfficialNodeName(officialName)) {
        return { nodeType: officialName, packageName };
      }
    }
  }
  return undefined;
}

function sanitizeForCreate(workflow: WorkflowLike): WorkflowLike {
  return {
    name: typeof workflow.name === "string" ? workflow.name : "Untitled workflow",
    nodes: deepClone(Array.isArray(workflow.nodes) ? workflow.nodes : []),
    connections: deepClone(
      workflow.connections && typeof workflow.connections === "object" ? workflow.connections : {},
    ),
    settings: deepClone(
      workflow.settings && typeof workflow.settings === "object" ? workflow.settings : {},
    ),
    active: false,
  };
}

function issue(
  severity: "error" | "warning",
  code: string,
  message: string,
  node?: { id?: unknown; name?: unknown },
): WorkflowValidationIssue {
  return {
    severity,
    code,
    message,
    ...(typeof node?.id === "string" ? { nodeId: node.id } : {}),
    ...(typeof node?.name === "string" ? { nodeName: node.name } : {}),
  };
}

function hasKnowledgeWarnings(validation: KnowledgeValidation): boolean {
  return Array.isArray(validation.warnings) && validation.warnings.length > 0;
}

function validationFrom(
  local: WorkflowValidationResult,
  authoritativeErrors: WorkflowValidationIssue[],
  authoritativeWarnings: WorkflowValidationIssue[],
): WorkflowValidationResult {
  const errors = [...local.errors, ...authoritativeErrors];
  const warnings = [...local.warnings, ...authoritativeWarnings];
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    riskLevel: errors.length > 0 ? "high" : warnings.length > 0 ? "medium" : local.riskLevel,
    canActivate: errors.length === 0 && warnings.length === 0 && local.canActivate,
  };
}

export class WorkflowCreationPipeline {
  private readonly localValidation: Pick<WorkflowValidationService, "validateWorkflow">;
  private readonly reviewedNodeTypes: ReadonlySet<string>;

  constructor(private readonly dependencies: WorkflowCreationPipelineDependencies) {
    this.localValidation = dependencies.localValidation ?? new WorkflowValidationService();
    this.reviewedNodeTypes = dependencies.reviewedNodeTypes ?? DEFAULT_REVIEWED_NODE_TYPES;
  }

  async create(input: CreationPipelineInput): Promise<CreationPipelineResult> {
    const intent = normalizeIntent(input.intent);
    let expectedWorkflow: Promise<WorkflowLike> | undefined;
    const loadExpectedWorkflow = () =>
      (expectedWorkflow ??= Promise.resolve(input.buildFallback()).then(sanitizeForCreate));
    const selected = await this.selectWorkflow(intent, input, loadExpectedWorkflow);
    if (!selected) {
      return this.createDegraded(input, expectedWorkflow ? await expectedWorkflow : undefined);
    }
    return this.createAuthoritative(input, selected);
  }

  private async selectWorkflow(
    intent: string,
    input: CreationPipelineInput,
    loadExpectedWorkflow: () => Promise<WorkflowLike>,
  ): Promise<SelectedWorkflow | undefined> {
    let candidates: KnowledgeTemplateHit[];
    try {
      candidates = await this.dependencies.knowledge.searchTemplates(intent, TEMPLATE_SEARCH_LIMIT);
    } catch (error) {
      if (error instanceof KnowledgeUnavailableError) return undefined;
      throw error;
    }

    for (const [index, candidate] of candidates.entries()) {
      let detail;
      try {
        detail = await this.dependencies.knowledge.getTemplate(candidate.id ?? "");
      } catch (error) {
        if (error instanceof KnowledgeUnavailableError) return undefined;
        throw error;
      }
      if (!detail.workflow || !input.templateCompatibility(detail.workflow)) continue;
      const expected = await loadExpectedWorkflow();
      if (workflowSemanticSignature(detail.workflow) !== workflowSemanticSignature(expected)) {
        continue;
      }
      const templateWorkflow = sanitizeForCreate(detail.workflow);
      return {
        workflow: { ...templateWorkflow, name: expected.name },
        reviewedFallback: expected,
        template: this.selectedTemplateMetadata(candidate, index + 1),
      };
    }

    const reviewedFallback = await loadExpectedWorkflow();
    return {
      workflow: reviewedFallback,
      reviewedFallback,
      template: {
        source: "fallback",
        compatible: false,
        candidatesConsidered: candidates.length,
        fallbackReason: candidates.length === 0 ? "no_template" : "no_compatible_template",
      },
    };
  }

  private selectedTemplateMetadata(
    candidate: KnowledgeTemplateHit,
    candidatesConsidered: number,
  ): TemplateSelectionMetadata {
    const id =
      typeof candidate.id === "string" || typeof candidate.id === "number"
        ? candidate.id
        : undefined;
    return {
      source: "template",
      compatible: true,
      ...(id !== undefined ? { id } : {}),
      ...(safeMetadataText(candidate.name) ? { name: safeMetadataText(candidate.name) } : {}),
      candidatesConsidered,
    };
  }

  private async createAuthoritative(
    input: CreationPipelineInput,
    selected: SelectedWorkflow,
  ): Promise<CreationPipelineResult> {
    const workflow = sanitizeForCreate(selected.workflow);
    let authoritative: {
      errors: WorkflowValidationIssue[];
      warnings: WorkflowValidationIssue[];
    };
    try {
      authoritative = await this.validateWithKnowledge(workflow);
    } catch (error) {
      if (!(error instanceof KnowledgeUnavailableError)) throw error;
      return this.createDegraded(input, selected.reviewedFallback);
    }

    const local = await this.localValidation.validateWorkflow(workflow);
    const validation = validationFrom(local, authoritative.errors, authoritative.warnings);
    const base = this.baseResult(input, "authoritative", selected.template, validation);
    if (!validation.ok) return base;

    const created = await this.dependencies.createDraft(workflow);
    return {
      ...base,
      success: true,
      workflow: { ...created, active: false },
      activationEligible: validation.canActivate,
    };
  }

  private async validateWithKnowledge(workflow: WorkflowLike): Promise<{
    errors: WorkflowValidationIssue[];
    warnings: WorkflowValidationIssue[];
  }> {
    const nodes = workflow.nodes ?? [];
    const identifiers = new Map<string, KnowledgeNodeIdentifier>();
    const authoritativeErrors: WorkflowValidationIssue[] = [];
    const authoritativeWarnings: WorkflowValidationIssue[] = [];

    for (const node of nodes) {
      const nodeType = typeof node.type === "string" ? node.type : undefined;
      if (!nodeType?.trim()) {
        authoritativeErrors.push(
          issue(
            "error",
            "knowledge.node_identifier",
            "The node type cannot be resolved to a reviewed Knowledge identifier.",
            node,
          ),
        );
        continue;
      }
      const identifier = resolveKnowledgeNodeIdentifier(nodeType);
      if (!identifier) {
        authoritativeErrors.push(
          issue(
            "error",
            "knowledge.node_identifier",
            "The node type cannot be resolved to a reviewed Knowledge identifier.",
            node,
          ),
        );
        continue;
      }
      identifiers.set(nodeType, identifier);
    }

    if (authoritativeErrors.length > 0) {
      return { errors: authoritativeErrors, warnings: authoritativeWarnings };
    }

    for (const identifier of identifiers.values()) {
      await this.dependencies.knowledge.getNode(identifier.nodeType, identifier.packageName);
    }

    for (const node of nodes) {
      const nodeType = typeof node.type === "string" ? node.type : "";
      const parameters =
        node.parameters && typeof node.parameters === "object" ? node.parameters : {};
      const identifier = identifiers.get(nodeType);
      if (!identifier) continue;
      const validation = await this.dependencies.knowledge.validateNode({
        nodeType: identifier.nodeType,
        parameters,
        packageName: identifier.packageName,
      });
      if (!validation.ok) {
        authoritativeErrors.push(
          issue(
            "error",
            "knowledge.node_validation",
            "Authoritative node validation failed.",
            node,
          ),
        );
      }
      if (hasKnowledgeWarnings(validation)) {
        authoritativeWarnings.push(
          issue(
            "warning",
            "knowledge.node_warning",
            "Authoritative node validation requires review.",
            node,
          ),
        );
      }
    }

    const authoritativeWorkflow = await this.dependencies.knowledge.validateWorkflow(workflow);
    if (!authoritativeWorkflow.ok) {
      authoritativeErrors.push(
        issue(
          "error",
          "knowledge.workflow_validation",
          "Authoritative workflow validation failed.",
        ),
      );
    }
    if (hasKnowledgeWarnings(authoritativeWorkflow)) {
      authoritativeWarnings.push(
        issue(
          "warning",
          "knowledge.workflow_warning",
          "Authoritative workflow validation requires review.",
        ),
      );
    }
    return { errors: authoritativeErrors, warnings: authoritativeWarnings };
  }

  private async createDegraded(
    input: CreationPipelineInput,
    alreadyBuilt?: WorkflowLike,
  ): Promise<CreationPipelineResult> {
    const workflow = sanitizeForCreate(alreadyBuilt ?? (await input.buildFallback()));
    const unsupportedNodes = (workflow.nodes ?? []).filter(
      (node) => typeof node.type !== "string" || !this.reviewedNodeTypes.has(node.type),
    );
    const local = await this.localValidation.validateWorkflow(workflow);
    const degradedErrors = unsupportedNodes.map((node) =>
      issue(
        "error",
        "knowledge.degraded_unsupported_node",
        "Knowledge is unavailable and the workflow contains a node outside the reviewed registry.",
        node,
      ),
    );
    const validation = validationFrom(local, degradedErrors, [
      issue(
        "warning",
        "knowledge.degraded",
        "Knowledge is unavailable; authoritative validation is required before deployment.",
      ),
    ]);
    const template: TemplateSelectionMetadata = {
      source: "fallback",
      compatible: false,
      candidatesConsidered: 0,
      fallbackReason: "knowledge_unavailable",
    };
    const base = {
      ...this.baseResult(input, "degraded", template, validation),
      knowledgeFailure: "unavailable" as const,
      activationEligible: false,
    };
    if (!validation.ok) return base;

    const created = await this.dependencies.createDraft(workflow);
    return { ...base, success: true, workflow: { ...created, active: false } };
  }

  private baseResult(
    input: CreationPipelineInput,
    knowledgeMode: "authoritative" | "degraded",
    template: TemplateSelectionMetadata,
    validation: WorkflowValidationResult,
  ): CreationPipelineResult {
    return {
      success: false,
      knowledgeMode,
      activationEligible: false,
      activationIntent: input.activateIntent,
      template,
      validation,
      nextAction: "deploy_and_test_workflow",
    };
  }
}
