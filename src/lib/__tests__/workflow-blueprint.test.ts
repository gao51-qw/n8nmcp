import { describe, expect, it } from "vitest";
import {
  getCredentialRequirements,
  compileBlueprint,
  repairBlueprint,
  validateCompiledWorkflow,
  validateBlueprint,
  type CompiledWorkflow,
  type WorkflowBlueprint,
} from "../workflow-blueprint";

function compiled(blueprint: WorkflowBlueprint): CompiledWorkflow {
  return compileBlueprint(blueprint);
}

function nestedObject(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: "value" };
  for (let index = 0; index < depth; index++) {
    value = { nested: value };
  }
  return value;
}

describe("workflow blueprint compiler", () => {
  it("compiles a linear blueprint using n8n node names in connections", () => {
    const workflow = compiled({
      name: "Daily Slack Report",
      trigger: {
        kind: "schedule",
        config: { rule: { interval: [{ cronExpression: "0 9 * * *" }] } },
      },
      steps: [
        {
          kind: "http",
          action: "get",
          config: { url: "https://api.example.com/sales" },
        },
        {
          kind: "slack",
          action: "sendMessage",
          config: { channel: "#sales", text: "Sales report: {{ $json.total }}" },
        },
      ],
    });

    expect(workflow.nodes.map((node) => node.name)).toEqual([
      "Schedule Trigger",
      "HTTP Request",
      "Slack Send Message",
    ]);
    expect(workflow.connections).toEqual({
      "Schedule Trigger": {
        main: [[{ node: "HTTP Request", type: "main", index: 0 }]],
      },
      "HTTP Request": {
        main: [[{ node: "Slack Send Message", type: "main", index: 0 }]],
      },
    });
    expect(workflow.nodes[1].parameters).toMatchObject({
      method: "GET",
      url: "https://api.example.com/sales",
    });
    expect(workflow.nodes[2].parameters).toMatchObject({
      resource: "message",
      operation: "post",
      channel: "#sales",
      text: "Sales report: {{ $json.total }}",
    });
  });

  it("validates trigger and action required parameters with structured repair hints", () => {
    const validation = validateBlueprint({
      name: "Broken",
      trigger: { kind: "webhook", config: {} },
      steps: [{ kind: "slack", action: "sendMessage", config: { channel: "#ops" } }],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "MISSING_REQUIRED_PARAMETER",
          path: "trigger.config.path",
          repairHint: "Provide path for the webhook trigger.",
        }),
        expect.objectContaining({
          code: "MISSING_REQUIRED_PARAMETER",
          path: "steps[0].config.text",
          repairHint: "Provide text for the slack step.",
        }),
      ]),
    );
  });

  it("reports credential requirements from credentialed nodes", () => {
    const requirements = getCredentialRequirements({
      name: "Notify",
      trigger: { kind: "manual", config: {} },
      steps: [
        {
          kind: "slack",
          action: "sendMessage",
          config: { channel: "#ops", text: "Hello" },
        },
        {
          kind: "email",
          config: { toEmail: "ops@example.com", subject: "Heads up" },
        },
      ],
    });

    expect(requirements).toEqual([
      { path: "steps[0]", kind: "slack", credentialType: "slackApi" },
      { path: "steps[1]", kind: "email", credentialType: "smtp" },
    ]);
  });

  it("validates the compiled n8n workflow shape and connection targets", () => {
    const workflow = compiled({
      name: "Duplicate",
      trigger: { kind: "manual", config: {} },
      steps: [{ kind: "set", config: {} }],
    });
    workflow.connections["Manual Trigger"] = {
      main: [[{ node: "Missing Node", type: "main", index: 0 }]],
    };

    const validation = validateCompiledWorkflow(workflow);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BROKEN_CONNECTION",
          path: "connections.Manual Trigger.main[0][0].node",
        }),
      ]),
    );
  });

  it("repairs safe structural blueprint issues without guessing business parameters", () => {
    const repair = repairBlueprint({
      name: "  Daily report  ",
      trigger: { kind: "manual" },
      steps: [{ kind: "http", config: { url: "https://api.example.com" } }],
    });

    expect(repair.repairs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "name" }),
        expect.objectContaining({ path: "trigger.config" }),
        expect.objectContaining({ path: "steps[0].action" }),
      ]),
    );
    expect(repair.blueprint).toMatchObject({
      name: "Daily report",
      trigger: { kind: "manual", config: {} },
      steps: [{ kind: "http", action: "get", config: { url: "https://api.example.com" } }],
    });
    expect(validateBlueprint(repair.blueprint).valid).toBe(true);
  });

  it("rejects blueprint payloads nested beyond the maximum safe depth", () => {
    const validation = validateBlueprint({
      name: "Deep payload",
      trigger: { kind: "manual", config: {} },
      steps: [{ kind: "set", config: nestedObject(51) }],
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: "BLUEPRINT_TOO_DEEP",
          path: expect.stringMatching(/^steps\[0\]\.config\.nested/),
        }),
      ]),
    );
  });

  it("does not repair blueprint payloads nested beyond the maximum safe depth", () => {
    expect(() =>
      repairBlueprint({
        name: "Deep payload",
        trigger: { kind: "manual", config: {} },
        steps: [{ kind: "set", config: nestedObject(51) }],
      }),
    ).toThrow("Blueprint nesting too deep");
  });
});
