import { describe, expect, it, vi } from "vitest";

import { WorkflowDeploymentPipeline } from "../deployment-pipeline.server";

const draft = {
  id: "wf-1",
  name: "Daily report",
  active: false,
  versionId: "version-1",
  nodes: [{ id: "trigger", name: "Trigger", type: "n8n-nodes-base.manualTrigger", parameters: {} }],
  connections: {},
};

function createHarness(overrides: Record<string, unknown> = {}) {
  const events: string[] = [];
  const dependencies = {
    loadWorkflow: vi.fn(async () => {
      events.push("load-draft");
      return draft;
    }),
    validateWorkflow: vi.fn(async () => {
      events.push("knowledge-validate");
      return { ok: true, errors: [], warnings: [] };
    }),
    confirmation: {
      requireOrConsume: vi.fn(async () => {
        events.push("consume-confirmation");
      }),
    },
    runWorkflow: vi.fn(async () => {
      events.push("smoke-test");
      return { finished: true, output: { status: "ok" } };
    }),
    activateWorkflow: vi.fn(async () => {
      events.push("activate");
    }),
    deactivateWorkflow: vi.fn(async () => {
      events.push("deactivate");
    }),
    ...overrides,
  };
  return { pipeline: new WorkflowDeploymentPipeline(dependencies as never), dependencies, events };
}

describe("WorkflowDeploymentPipeline", () => {
  it("loads, validates, confirms, smoke-tests, evaluates, then activates", async () => {
    const { pipeline, events } = createHarness();

    const result = await pipeline.deploy({
      userId: "user-1",
      workflowId: "wf-1",
      testData: { sample: true },
      validationRules: [{ field: "status", condition: "equals", expectedValue: "ok" }],
      confirmationToken: "token-1",
    });

    expect(result.success).toBe(true);
    expect(events).toEqual([
      "load-draft",
      "knowledge-validate",
      "consume-confirmation",
      "smoke-test",
      "activate",
    ]);
  });

  it("binds confirmation to workflow fingerprint, test data, rules, and activation", async () => {
    const { pipeline, dependencies } = createHarness();

    await pipeline.deploy({
      userId: "user-1",
      workflowId: "wf-1",
      testData: { sample: true },
      validationRules: [{ field: "status", condition: "exists" }],
      confirmationToken: "token-1",
    });

    expect(dependencies.confirmation.requireOrConsume).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        action: "deploy_and_test_workflow",
        confirmationToken: "token-1",
        scope: expect.objectContaining({
          workflowId: "wf-1",
          workflowFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
          testDataDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          outputRulesDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
          activate: true,
        }),
      }),
    );
  });

  it("rejects active drafts and validation warnings before confirmation or execution", async () => {
    const { pipeline, dependencies } = createHarness({
      loadWorkflow: vi.fn(async () => ({ ...draft, active: true })),
    });

    const result = await pipeline.deploy({
      userId: "user-1",
      workflowId: "wf-1",
      testData: { sample: true },
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/inactive draft/i);
    expect(dependencies.confirmation.requireOrConsume).not.toHaveBeenCalled();
    expect(dependencies.runWorkflow).not.toHaveBeenCalled();
  });

  it("does not activate when smoke output rules fail", async () => {
    const { pipeline, dependencies } = createHarness();

    const result = await pipeline.deploy({
      userId: "user-1",
      workflowId: "wf-1",
      testData: { sample: true },
      validationRules: [{ field: "status", condition: "equals", expectedValue: "success" }],
    });

    expect(result.success).toBe(false);
    expect(result.results.test.error).toMatch(/Validation failed/);
    expect(dependencies.activateWorkflow).not.toHaveBeenCalled();
  });

  it("deactivates after an activation error to preserve a safe inactive state", async () => {
    const { pipeline, dependencies, events } = createHarness({
      activateWorkflow: vi.fn(async () => {
        events.push("activate");
        throw new Error("activation unavailable");
      }),
    });

    const result = await pipeline.deploy({
      userId: "user-1",
      workflowId: "wf-1",
      testData: { sample: true },
    });

    expect(result.success).toBe(false);
    expect(dependencies.deactivateWorkflow).toHaveBeenCalledWith("wf-1");
    expect(events.at(-1)).toBe("deactivate");
  });
});
