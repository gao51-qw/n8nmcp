import { describe, expect, it, vi } from "vitest";
import type { WorkflowLike, WorkflowValidationResult } from "../../workflow-agent";
import {
  WorkflowCreationPipeline,
  type WorkflowCreationPipelineDependencies,
} from "../creation-pipeline.server";
import {
  KnowledgeConfigurationError,
  KnowledgeResponseError,
  KnowledgeUnavailableError,
  createKnowledgeClient,
  type KnowledgeClient,
} from "../knowledge-client.server";

const cleanLocalValidation: WorkflowValidationResult = {
  ok: true,
  errors: [],
  warnings: [],
  riskLevel: "low",
  canActivate: true,
};

const reviewedWorkflow: WorkflowLike = {
  name: "Reviewed daily report",
  active: true,
  nodes: [
    {
      id: "schedule",
      name: "Schedule",
      type: "n8n-nodes-base.scheduleTrigger",
      parameters: { rule: { interval: [{ field: "hours", hoursInterval: 24 }] } },
    },
    {
      id: "email",
      name: "Email",
      type: "n8n-nodes-base.emailSend",
      parameters: { toEmail: "team@example.com", subject: "Report" },
    },
  ],
  connections: {},
  settings: { executionOrder: "v1" },
};

function createHarness(overrides: Partial<WorkflowCreationPipelineDependencies> = {}): {
  pipeline: WorkflowCreationPipeline;
  knowledge: KnowledgeClient;
  createDraft: ReturnType<typeof vi.fn>;
  localValidation: ReturnType<typeof vi.fn>;
} {
  const knowledge = {
    searchTemplates: vi.fn().mockResolvedValue([]),
    getTemplate: vi.fn(),
    searchNodes: vi.fn(),
    getNode: vi.fn().mockResolvedValue({}),
    validateNode: vi.fn().mockResolvedValue({ ok: true }),
    validateWorkflow: vi.fn().mockResolvedValue({ ok: true }),
  } satisfies KnowledgeClient;
  const createDraft = vi
    .fn()
    .mockImplementation(async (workflow: WorkflowLike) => ({ ...workflow, id: "draft-1" }));
  const localValidation = vi.fn().mockResolvedValue(cleanLocalValidation);
  const dependencies: WorkflowCreationPipelineDependencies = {
    knowledge,
    createDraft,
    localValidation: { validateWorkflow: localValidation },
    reviewedNodeTypes: new Set(["n8n-nodes-base.scheduleTrigger", "n8n-nodes-base.emailSend"]),
    ...overrides,
  };

  return {
    pipeline: new WorkflowCreationPipeline(dependencies),
    knowledge: dependencies.knowledge,
    createDraft,
    localValidation,
  };
}

function createLazyRealKnowledgeClient(
  config: { url: string; token: string },
  networkFetch: typeof fetch,
): KnowledgeClient {
  const createClient = () => createKnowledgeClient(config, { fetch: networkFetch });
  return {
    searchTemplates: (...args) => createClient().searchTemplates(...args),
    getTemplate: (...args) => createClient().getTemplate(...args),
    searchNodes: (...args) => createClient().searchNodes(...args),
    getNode: (...args) => createClient().getNode(...args),
    validateNode: (...args) => createClient().validateNode(...args),
    validateWorkflow: (...args) => createClient().validateWorkflow(...args),
  };
}

describe("WorkflowCreationPipeline", () => {
  it("uses Root registry Knowledge identifiers for essentials and operation validation", async () => {
    const { pipeline, knowledge } = createHarness();

    await pipeline.create({
      intent: "daily report",
      activateIntent: false,
      buildFallback: () => reviewedWorkflow,
      templateCompatibility: () => false,
    });

    expect(knowledge.getNode).toHaveBeenNthCalledWith(1, "scheduleTrigger", "n8n-nodes-base");
    expect(knowledge.getNode).toHaveBeenNthCalledWith(2, "emailSend", "n8n-nodes-base");
    expect(knowledge.validateNode).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        nodeType: "scheduleTrigger",
        packageName: "n8n-nodes-base",
      }),
    );
  });

  it("counts only template candidates inspected before a compatible selection", async () => {
    const { pipeline, knowledge } = createHarness();
    vi.mocked(knowledge.searchTemplates).mockResolvedValue([
      { id: 1, name: "Webhook" },
      { id: 2, name: "Daily report" },
      { id: 3, name: "Unused" },
    ]);
    vi.mocked(knowledge.getTemplate).mockImplementation(async (id) => ({
      id,
      workflow:
        id === 1
          ? {
              name: "Webhook",
              nodes: [
                {
                  id: "hook",
                  name: "Webhook",
                  type: "n8n-nodes-base.webhook",
                  parameters: {},
                },
              ],
              connections: {},
            }
          : reviewedWorkflow,
    }));

    const result = await pipeline.create({
      intent: "daily report",
      activateIntent: false,
      buildFallback: () => reviewedWorkflow,
      templateCompatibility: (workflow) => workflow.name === reviewedWorkflow.name,
    });

    expect(knowledge.getTemplate).toHaveBeenCalledTimes(2);
    expect(result.template).toMatchObject({ source: "template", candidatesConsidered: 2 });
  });

  it("selects and sanitizes a compatible template before ordered authoritative validation", async () => {
    const events: string[] = [];
    const { pipeline, knowledge, createDraft, localValidation } = createHarness();
    vi.mocked(knowledge.searchTemplates).mockImplementation(async (query) => {
      events.push(`search:${query}`);
      return [
        { id: 41, name: "Wrong webhook" },
        { id: 42, name: "Daily email" },
        { id: 43, name: "Unused candidate" },
      ];
    });
    vi.mocked(knowledge.getTemplate).mockImplementation(async (id) => {
      events.push(`template:${id}`);
      if (id === 41) {
        return {
          id: 41,
          workflow: {
            name: "Wrong webhook",
            nodes: [
              { id: "hook", name: "Webhook", type: "n8n-nodes-base.webhook", parameters: {} },
            ],
            connections: {},
          },
        };
      }
      return {
        id: 42,
        workflow: {
          id: "source-id",
          name: "Knowledge daily email",
          active: true,
          tags: [{ id: "secret-tag" }],
          nodes: reviewedWorkflow.nodes,
          connections: {},
          settings: { executionOrder: "v1" },
        },
      };
    });
    vi.mocked(knowledge.getNode).mockImplementation(async (nodeType) => {
      events.push(`essentials:${nodeType}`);
      return {};
    });
    vi.mocked(knowledge.validateNode).mockImplementation(async ({ nodeType }) => {
      events.push(`node:${nodeType}`);
      return { ok: true };
    });
    vi.mocked(knowledge.validateWorkflow).mockImplementation(async () => {
      events.push("authoritative-workflow");
      return { ok: true };
    });
    localValidation.mockImplementation(async () => {
      events.push("local-workflow");
      return cleanLocalValidation;
    });
    createDraft.mockImplementation(async (workflow: WorkflowLike) => {
      events.push("create-draft");
      return { ...workflow, id: "draft-42" };
    });
    const buildFallback = vi.fn(() => reviewedWorkflow);

    const result = await pipeline.create({
      intent: "  Daily   report  ",
      activateIntent: true,
      buildFallback,
      templateCompatibility: (workflow) =>
        workflow.nodes?.[0]?.type === "n8n-nodes-base.scheduleTrigger",
    });

    expect(buildFallback).toHaveBeenCalledOnce();
    expect(createDraft).toHaveBeenCalledWith({
      name: "Reviewed daily report",
      nodes: reviewedWorkflow.nodes,
      connections: reviewedWorkflow.connections,
      settings: reviewedWorkflow.settings,
      active: false,
    });
    expect(createDraft.mock.calls[0][0]).not.toHaveProperty("id");
    expect(createDraft.mock.calls[0][0]).not.toHaveProperty("tags");
    expect(knowledge.getNode).toHaveBeenCalledTimes(2);
    expect(knowledge.validateNode).toHaveBeenCalledTimes(2);
    expect(knowledge.getNode).toHaveBeenNthCalledWith(1, "scheduleTrigger", "n8n-nodes-base");
    expect(knowledge.getNode).toHaveBeenNthCalledWith(2, "emailSend", "n8n-nodes-base");
    expect(knowledge.validateNode).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        nodeType: "scheduleTrigger",
        packageName: "n8n-nodes-base",
      }),
    );
    expect(knowledge.validateNode).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ nodeType: "emailSend", packageName: "n8n-nodes-base" }),
    );
    expect(events).toEqual([
      "search:Daily report",
      "template:41",
      "template:42",
      "essentials:scheduleTrigger",
      "essentials:emailSend",
      "node:scheduleTrigger",
      "node:emailSend",
      "authoritative-workflow",
      "local-workflow",
      "create-draft",
    ]);
    expect(result).toMatchObject({
      success: true,
      knowledgeMode: "authoritative",
      activationIntent: true,
      activationEligible: true,
      template: {
        source: "template",
        id: 42,
        name: "Daily email",
        compatible: true,
        candidatesConsidered: 2,
      },
      nextAction: "deploy_and_test_workflow",
      workflow: { id: "draft-42", name: "Reviewed daily report", active: false },
    });
  });

  it("falls back when matching node types have different request-specific semantics", async () => {
    const { pipeline, knowledge, createDraft } = createHarness();
    vi.mocked(knowledge.searchTemplates).mockResolvedValue([{ id: "7", name: "Stale report" }]);
    vi.mocked(knowledge.getTemplate).mockResolvedValue({
      id: "7",
      workflow: {
        ...reviewedWorkflow,
        name: "Stale report",
        nodes: [
          reviewedWorkflow.nodes![0],
          {
            ...reviewedWorkflow.nodes![1],
            parameters: { toEmail: "other@example.com", subject: "A different report" },
          },
        ],
        connections: {},
      },
    });
    const buildFallback = vi.fn(() => reviewedWorkflow);

    const result = await pipeline.create({
      intent: "daily report",
      activateIntent: false,
      buildFallback,
      templateCompatibility: () => true,
    });

    expect(buildFallback).toHaveBeenCalledOnce();
    expect(createDraft.mock.calls[0][0]).toMatchObject({
      name: "Reviewed daily report",
      active: false,
    });
    expect(result.template).toEqual({
      source: "fallback",
      compatible: false,
      candidatesConsidered: 1,
      fallbackReason: "no_compatible_template",
    });
  });

  it("prevents mutation when authoritative node validation returns an error", async () => {
    const { pipeline, knowledge, createDraft } = createHarness();
    vi.mocked(knowledge.validateNode).mockResolvedValue({ ok: false });

    const result = await pipeline.create({
      intent: "daily report",
      activateIntent: false,
      buildFallback: () => reviewedWorkflow,
      templateCompatibility: () => false,
    });

    expect(result.success).toBe(false);
    expect(result.validation.errors).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "knowledge.node_validation" })]),
    );
    expect(knowledge.validateWorkflow).toHaveBeenCalledOnce();
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("blocks every missing, blank, non-canonical, or untrimmed node type", async () => {
    const { pipeline, knowledge, createDraft } = createHarness();

    const result = await pipeline.create({
      intent: "invalid node identifiers",
      activateIntent: false,
      buildFallback: () => ({
        name: "Invalid node identifiers",
        nodes: [
          { id: "missing", name: "Missing Type", parameters: {} },
          { id: "empty", name: "Empty Type", type: "  ", parameters: {} },
          { id: "unknown", name: "Unknown Type", type: "community.unknown", parameters: {} },
          {
            id: "blank-suffix",
            name: "Blank Official Suffix",
            type: "n8n-nodes-base. ",
            parameters: {},
          },
          {
            id: "surrounding-space",
            name: "Surrounding Space",
            type: " n8n-nodes-base.webhook ",
            parameters: {},
          },
          {
            id: "non-canonical",
            name: "Non Canonical",
            type: "n8n-nodes-base.Webhook",
            parameters: {},
          },
        ],
        connections: {},
      }),
      templateCompatibility: () => false,
    });

    expect(result.success).toBe(false);
    expect(result.validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "knowledge.node_identifier", nodeId: "missing" }),
        expect.objectContaining({ code: "knowledge.node_identifier", nodeId: "empty" }),
        expect.objectContaining({ code: "knowledge.node_identifier", nodeId: "unknown" }),
        expect.objectContaining({ code: "knowledge.node_identifier", nodeId: "blank-suffix" }),
        expect.objectContaining({
          code: "knowledge.node_identifier",
          nodeId: "surrounding-space",
        }),
        expect.objectContaining({ code: "knowledge.node_identifier", nodeId: "non-canonical" }),
      ]),
    );
    expect(
      result.validation.errors.filter((item) => item.code === "knowledge.node_identifier"),
    ).toHaveLength(6);
    expect(knowledge.getNode).not.toHaveBeenCalled();
    expect(knowledge.validateNode).not.toHaveBeenCalled();
    expect(knowledge.validateWorkflow).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("creates an inactive draft with warnings but makes it activation-ineligible", async () => {
    const { pipeline, knowledge, createDraft } = createHarness();
    vi.mocked(knowledge.validateWorkflow).mockResolvedValue({
      ok: true,
      warnings: [{ message: "Credential must be reviewed" }],
    });

    const result = await pipeline.create({
      intent: "daily report",
      activateIntent: true,
      buildFallback: () => reviewedWorkflow,
      templateCompatibility: () => false,
    });

    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
    expect(result.success).toBe(true);
    expect(result.activationIntent).toBe(true);
    expect(result.activationEligible).toBe(false);
    expect(result.validation.warnings).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "knowledge.workflow_warning" })]),
    );
  });

  it("combines local safety errors and blocks draft mutation", async () => {
    const localError: WorkflowValidationResult = {
      ok: false,
      errors: [{ code: "workflow.unsafe", message: "Unsafe local workflow", severity: "error" }],
      warnings: [],
      riskLevel: "high",
      canActivate: false,
    };
    const { pipeline, knowledge, createDraft } = createHarness({
      localValidation: { validateWorkflow: vi.fn().mockResolvedValue(localError) },
    });

    const result = await pipeline.create({
      intent: "daily report",
      activateIntent: false,
      buildFallback: () => reviewedWorkflow,
      templateCompatibility: () => false,
    });

    expect(knowledge.validateWorkflow).toHaveBeenCalledOnce();
    expect(result.validation.errors).toContainEqual(localError.errors[0]);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("allows an inactive degraded draft only when every node is reviewed", async () => {
    const { pipeline, knowledge, createDraft } = createHarness();
    vi.mocked(knowledge.searchTemplates).mockRejectedValue(new KnowledgeUnavailableError());

    const result = await pipeline.create({
      intent: "daily report",
      activateIntent: true,
      buildFallback: () => reviewedWorkflow,
      templateCompatibility: () => false,
    });

    expect(knowledge.getNode).not.toHaveBeenCalled();
    expect(createDraft).toHaveBeenCalledWith(expect.objectContaining({ active: false }));
    expect(result).toMatchObject({
      success: true,
      knowledgeMode: "degraded",
      activationEligible: false,
      activationIntent: true,
      knowledgeFailure: "unavailable",
      template: { source: "fallback", fallbackReason: "knowledge_unavailable" },
    });
  });

  it("rejects degraded creation when any fallback node is outside the reviewed registry", async () => {
    const { pipeline, knowledge, createDraft } = createHarness();
    vi.mocked(knowledge.searchTemplates).mockRejectedValue(new KnowledgeUnavailableError());

    const result = await pipeline.create({
      intent: "unknown integration",
      activateIntent: false,
      buildFallback: () => ({
        ...reviewedWorkflow,
        nodes: [
          ...reviewedWorkflow.nodes!,
          { id: "unknown", type: "community.unknown", parameters: {} },
        ],
      }),
      templateCompatibility: () => false,
    });

    expect(result.success).toBe(false);
    expect(result.validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "knowledge.degraded_unsupported_node" }),
      ]),
    );
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("does not silently degrade Knowledge response errors", async () => {
    const { pipeline, knowledge, createDraft } = createHarness();
    vi.mocked(knowledge.searchTemplates).mockRejectedValue(new KnowledgeResponseError());

    await expect(
      pipeline.create({
        intent: "daily report",
        activateIntent: false,
        buildFallback: () => reviewedWorkflow,
        templateCompatibility: () => false,
      }),
    ).rejects.toBeInstanceOf(KnowledgeResponseError);
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("does not retry a draft mutation when createDraft throws KnowledgeUnavailableError", async () => {
    const outage = new KnowledgeUnavailableError();
    const createDraft = vi.fn().mockRejectedValue(outage);
    const { pipeline } = createHarness({ createDraft });

    await expect(
      pipeline.create({
        intent: "daily report",
        activateIntent: false,
        buildFallback: () => reviewedWorkflow,
        templateCompatibility: () => false,
      }),
    ).rejects.toBe(outage);
    expect(createDraft).toHaveBeenCalledOnce();
  });

  it("does not reinterpret reviewed-builder KnowledgeUnavailableError as degradation", async () => {
    const outage = new KnowledgeUnavailableError();
    const buildFallback = vi.fn().mockRejectedValue(outage);
    const { pipeline, createDraft } = createHarness();

    await expect(
      pipeline.create({
        intent: "daily report",
        activateIntent: false,
        buildFallback,
        templateCompatibility: () => false,
      }),
    ).rejects.toBe(outage);
    expect(buildFallback).toHaveBeenCalledOnce();
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("does not reinterpret local-validator KnowledgeUnavailableError as degradation", async () => {
    const outage = new KnowledgeUnavailableError();
    const localValidation = vi.fn().mockRejectedValue(outage);
    const { pipeline, createDraft } = createHarness({
      localValidation: { validateWorkflow: localValidation },
    });

    await expect(
      pipeline.create({
        intent: "daily report",
        activateIntent: false,
        buildFallback: () => reviewedWorkflow,
        templateCompatibility: () => false,
      }),
    ).rejects.toBe(outage);
    expect(localValidation).toHaveBeenCalledOnce();
    expect(createDraft).not.toHaveBeenCalled();
  });

  it("propagates real header-control configuration errors without degraded creation", async () => {
    const config = {
      url: "http://knowledge:3000/mcp",
      token: "valid-prefix\r\nX-Canary-Secret: task-3-header-injection",
    };
    const createClient = () => createKnowledgeClient(config);
    const knowledge: KnowledgeClient = {
      searchTemplates: (...args) => createClient().searchTemplates(...args),
      getTemplate: (...args) => createClient().getTemplate(...args),
      searchNodes: (...args) => createClient().searchNodes(...args),
      getNode: (...args) => createClient().getNode(...args),
      validateNode: (...args) => createClient().validateNode(...args),
      validateWorkflow: (...args) => createClient().validateWorkflow(...args),
    };
    const buildFallback = vi.fn(() => reviewedWorkflow);
    const { pipeline, createDraft } = createHarness({ knowledge });

    await expect(
      pipeline.create({
        intent: "daily report",
        activateIntent: false,
        buildFallback,
        templateCompatibility: () => false,
      }),
    ).rejects.toBeInstanceOf(KnowledgeConfigurationError);
    expect(buildFallback).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });

  it.each([
    {
      label: "401 authentication response",
      expectedFetches: 1,
      fetch: vi.fn(
        async () => new Response("unauthorized canary", { status: 401 }),
      ) as typeof fetch,
    },
    {
      label: "header-unencodable Unicode token",
      expectedFetches: 0,
      token: "token-密钥",
      fetch: vi.fn(async () => {
        throw new TypeError("Cannot convert authorization to a ByteString canary");
      }) as typeof fetch,
    },
    {
      label: "unexpected final response URL",
      expectedFetches: 1,
      fetch: vi.fn(async () => {
        const response = new Response("ignored", { status: 200 });
        Object.defineProperty(response, "url", { value: "http://other:3000/mcp" });
        return response;
      }) as typeof fetch,
    },
  ])("does not degrade a real Knowledge client $label", async (scenario) => {
    const config = {
      url: "http://knowledge:3000/mcp",
      token: scenario.token ?? "valid-token",
    };
    const knowledge = createLazyRealKnowledgeClient(config, scenario.fetch);
    const buildFallback = vi.fn(() => reviewedWorkflow);
    const { pipeline, createDraft } = createHarness({ knowledge });

    await expect(
      pipeline.create({
        intent: "daily report",
        activateIntent: false,
        buildFallback,
        templateCompatibility: () => false,
      }),
    ).rejects.toBeInstanceOf(KnowledgeConfigurationError);
    expect(scenario.fetch).toHaveBeenCalledTimes(scenario.expectedFetches);
    expect(buildFallback).not.toHaveBeenCalled();
    expect(createDraft).not.toHaveBeenCalled();
  });
});
