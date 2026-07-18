import {
  getNodeTemplate,
  isNodeKind,
  isTriggerNodeKind,
  type ActionNodeKind,
  type NodeActionTemplate,
  type TriggerNodeKind,
} from "./node-registry";

export type WorkflowBlueprint = {
  name: string;
  trigger: TriggerStep;
  steps: ActionStep[];
  settings?: {
    executionOrder?: "v0" | "v1";
    saveExecutionProgress?: boolean;
  };
};

export type TriggerStep = {
  kind: TriggerNodeKind;
  config: Record<string, unknown>;
};

export type ActionStep = {
  kind: ActionNodeKind;
  action?: string;
  config: Record<string, unknown>;
};

export type CompiledNode = {
  id: string;
  name: string;
  type: string;
  typeVersion: number;
  position: [number, number];
  parameters: Record<string, unknown>;
};

export type CompiledWorkflow = {
  name: string;
  nodes: CompiledNode[];
  connections: Record<string, { main: Array<Array<{ node: string; type: "main"; index: 0 }>> }>;
  settings: Record<string, unknown>;
};

export type BlueprintValidationError = {
  code:
    | "INVALID_BLUEPRINT"
    | "BLUEPRINT_TOO_DEEP"
    | "INVALID_NAME"
    | "INVALID_TRIGGER"
    | "INVALID_STEP"
    | "INVALID_ACTION"
    | "MISSING_REQUIRED_PARAMETER"
    | "BROKEN_CONNECTION";
  path: string;
  message: string;
  repairHint: string;
};

export type BlueprintValidationResult = {
  valid: boolean;
  errors: BlueprintValidationError[];
};

export type CredentialRequirement = {
  path: string;
  kind: ActionNodeKind;
  credentialType: string;
};

export type BlueprintRepair = {
  path: string;
  message: string;
};

export type BlueprintRepairResult = {
  blueprint: unknown;
  repairs: BlueprintRepair[];
};

const MAX_BLUEPRINT_DEPTH = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function blueprintDepthError(input: unknown): BlueprintValidationError | null {
  const stack: Array<{ value: unknown; path: string; depth: number }> = [
    { value: input, path: "", depth: 0 },
  ];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) continue;

    if (current.depth > MAX_BLUEPRINT_DEPTH) {
      return {
        code: "BLUEPRINT_TOO_DEEP",
        path: current.path,
        message: "Blueprint nesting too deep.",
        repairHint: `Keep blueprint payload nesting to ${MAX_BLUEPRINT_DEPTH} levels or fewer.`,
      };
    }

    if (Array.isArray(current.value)) {
      current.value.forEach((item, index) => {
        stack.push({
          value: item,
          path: current.path ? `${current.path}[${index}]` : `[${index}]`,
          depth: current.depth + 1,
        });
      });
      continue;
    }

    if (isRecord(current.value)) {
      Object.entries(current.value).forEach(([key, value]) => {
        stack.push({
          value,
          path: current.path ? `${current.path}.${key}` : key,
          depth: current.depth + 1,
        });
      });
    }
  }

  return null;
}

function nodeName(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }

  let suffix = 2;
  while (used.has(`${base} ${suffix}`)) suffix++;
  const name = `${base} ${suffix}`;
  used.add(name);
  return name;
}

function actionRequiredParams(
  action: NodeActionTemplate | undefined,
  fallback: string[] | undefined,
): string[] {
  return action?.requiredParams ?? fallback ?? [];
}

function actionLabel(action: NodeActionTemplate | undefined): string {
  if (action?.label) return action.label;
  return "";
}

function mergedParameters(step: ActionStep): Record<string, unknown> {
  const template = getNodeTemplate(step.kind);
  const action = step.action ? template.actions?.[step.action] : undefined;

  return {
    ...(action?.params ?? {}),
    ...(action?.resource ? { resource: action.resource } : {}),
    ...(action?.operation ? { operation: action.operation } : {}),
    ...step.config,
  };
}

function cloneJson<T>(input: T): T {
  return JSON.parse(JSON.stringify(input)) as T;
}

function defaultAction(kind: ActionNodeKind): string | undefined {
  const actions = getNodeTemplate(kind).actions;
  if (!actions) return undefined;
  if ("get" in actions) return "get";
  return Object.keys(actions)[0];
}

export function getCredentialRequirements(blueprint: WorkflowBlueprint): CredentialRequirement[] {
  return blueprint.steps.flatMap((step, index) => {
    const credentialType = getNodeTemplate(step.kind).credentialType;
    return credentialType ? [{ path: `steps[${index}]`, kind: step.kind, credentialType }] : [];
  });
}

export function repairBlueprint(input: unknown): BlueprintRepairResult {
  if (blueprintDepthError(input)) {
    throw new Error("Blueprint nesting too deep");
  }

  const repairs: BlueprintRepair[] = [];
  if (!isRecord(input)) return { blueprint: input, repairs };

  const draft = cloneJson(input) as Record<string, unknown>;

  if (typeof draft.name === "string") {
    const trimmed = draft.name.trim();
    if (trimmed !== draft.name) {
      draft.name = trimmed;
      repairs.push({ path: "name", message: "Trimmed workflow name whitespace." });
    }
  }

  if (isRecord(draft.trigger) && !isRecord(draft.trigger.config)) {
    draft.trigger.config = {};
    repairs.push({ path: "trigger.config", message: "Added empty trigger config object." });
  }

  if (Array.isArray(draft.steps)) {
    draft.steps = draft.steps.map((rawStep, index) => {
      if (!isRecord(rawStep)) return rawStep;
      const step = { ...rawStep };

      if (!isRecord(step.config)) {
        step.config = {};
        repairs.push({
          path: `steps[${index}].config`,
          message: "Added empty step config object.",
        });
      }

      if (isNodeKind(step.kind) && !isTriggerNodeKind(step.kind) && step.action === undefined) {
        const action = defaultAction(step.kind);
        if (action) {
          step.action = action;
          repairs.push({
            path: `steps[${index}].action`,
            message: `Defaulted ${step.kind} action to "${action}".`,
          });
        }
      }

      return step;
    });
  }

  return { blueprint: draft, repairs };
}

export function compileBlueprint(blueprint: WorkflowBlueprint): CompiledWorkflow {
  const nodes: CompiledNode[] = [];
  const connections: CompiledWorkflow["connections"] = {};
  const usedNames = new Set<string>();
  let xPosition = 250;

  const triggerTemplate = getNodeTemplate(blueprint.trigger.kind);
  const triggerName = nodeName(triggerTemplate.label, usedNames);
  nodes.push({
    id: "trigger",
    name: triggerName,
    type: triggerTemplate.n8nType,
    typeVersion: triggerTemplate.defaultTypeVersion,
    position: [xPosition, 300],
    parameters: blueprint.trigger.config,
  });

  let previousNodeName = triggerName;
  xPosition += 220;

  blueprint.steps.forEach((step, index) => {
    const template = getNodeTemplate(step.kind);
    const action = step.action ? template.actions?.[step.action] : undefined;
    const label = actionLabel(action);
    const baseName = label ? `${template.label} ${label}` : template.label;
    const name = nodeName(baseName, usedNames);

    nodes.push({
      id: `step_${index + 1}`,
      name,
      type: template.n8nType,
      typeVersion: template.defaultTypeVersion,
      position: [xPosition, 300],
      parameters: mergedParameters(step),
    });

    connections[previousNodeName] = {
      main: [[{ node: name, type: "main", index: 0 }]],
    };
    previousNodeName = name;
    xPosition += 220;
  });

  return {
    name: blueprint.name,
    nodes,
    connections,
    settings: blueprint.settings ?? { executionOrder: "v1" },
  };
}

function pushMissingParams(
  errors: BlueprintValidationError[],
  pathPrefix: string,
  kind: string,
  config: Record<string, unknown>,
  requiredParams: string[],
): void {
  for (const param of requiredParams) {
    const subject = kind.endsWith("trigger") ? kind : `${kind} step`;
    if (!(param in config)) {
      errors.push({
        code: "MISSING_REQUIRED_PARAMETER",
        path: `${pathPrefix}.${param}`,
        message: `${kind} is missing required parameter "${param}".`,
        repairHint: `Provide ${param} for the ${subject}.`,
      });
    }
  }
}

export function validateBlueprint(input: unknown): BlueprintValidationResult {
  const errors: BlueprintValidationError[] = [];
  const depthError = blueprintDepthError(input);
  if (depthError) {
    errors.push(depthError);
  }

  if (!isRecord(input)) {
    return {
      valid: false,
      errors: [
        {
          code: "INVALID_BLUEPRINT",
          path: "",
          message: "Blueprint must be an object.",
          repairHint: "Provide an object with name, trigger, and steps.",
        },
      ],
    };
  }

  if (typeof input.name !== "string" || input.name.trim().length === 0) {
    errors.push({
      code: "INVALID_NAME",
      path: "name",
      message: "Blueprint name is required and must be a non-empty string.",
      repairHint: "Provide a descriptive workflow name.",
    });
  }

  if (!isRecord(input.trigger)) {
    errors.push({
      code: "INVALID_TRIGGER",
      path: "trigger",
      message: "Blueprint trigger is required.",
      repairHint: "Provide trigger.kind and trigger.config.",
    });
  } else if (!isTriggerNodeKind(input.trigger.kind)) {
    errors.push({
      code: "INVALID_TRIGGER",
      path: "trigger.kind",
      message: `Invalid trigger kind "${String(input.trigger.kind)}".`,
      repairHint: "Use one of: schedule, webhook, manual.",
    });
  } else {
    const config = isRecord(input.trigger.config) ? input.trigger.config : {};
    const template = getNodeTemplate(input.trigger.kind);
    pushMissingParams(
      errors,
      "trigger.config",
      `${input.trigger.kind} trigger`,
      config,
      template.requiredParams ?? [],
    );
  }

  if (!Array.isArray(input.steps)) {
    errors.push({
      code: "INVALID_STEP",
      path: "steps",
      message: "Blueprint steps must be an array.",
      repairHint: "Provide steps as an array of action nodes.",
    });
  } else {
    input.steps.forEach((step, index) => {
      const path = `steps[${index}]`;
      if (!isRecord(step)) {
        errors.push({
          code: "INVALID_STEP",
          path,
          message: "Step must be an object.",
          repairHint: "Provide a step with kind and config.",
        });
        return;
      }

      if (!isNodeKind(step.kind) || isTriggerNodeKind(step.kind)) {
        errors.push({
          code: "INVALID_STEP",
          path: `${path}.kind`,
          message: `Invalid action kind "${String(step.kind)}".`,
          repairHint:
            "Use an action kind such as http, slack, email, googleSheets, openai, code, if, or set.",
        });
        return;
      }

      const config = isRecord(step.config) ? step.config : {};
      const template = getNodeTemplate(step.kind);
      const actionName = typeof step.action === "string" ? step.action : undefined;
      const action = actionName ? template.actions?.[actionName] : undefined;

      if (actionName && template.actions && !action) {
        errors.push({
          code: "INVALID_ACTION",
          path: `${path}.action`,
          message: `Unknown action "${actionName}" for ${step.kind}.`,
          repairHint: `Use one of: ${Object.keys(template.actions).join(", ")}.`,
        });
      }

      pushMissingParams(
        errors,
        `${path}.config`,
        String(step.kind),
        config,
        actionRequiredParams(action, template.requiredParams),
      );
    });
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

export function isWorkflowBlueprint(input: unknown): input is WorkflowBlueprint {
  return validateBlueprint(input).valid;
}

export function validateCompiledWorkflow(workflow: CompiledWorkflow): BlueprintValidationResult {
  const errors: BlueprintValidationError[] = [];

  if (!workflow.name || workflow.name.trim().length === 0) {
    errors.push({
      code: "INVALID_NAME",
      path: "name",
      message: "Compiled workflow name is required.",
      repairHint: "Provide a workflow name before creating the workflow.",
    });
  }

  if (workflow.nodes.length === 0) {
    errors.push({
      code: "INVALID_BLUEPRINT",
      path: "nodes",
      message: "Compiled workflow must contain at least one node.",
      repairHint: "Add a trigger node before compiling.",
    });
  }

  const nodeNames = new Set<string>();
  workflow.nodes.forEach((node, index) => {
    if (!node.name) {
      errors.push({
        code: "INVALID_STEP",
        path: `nodes[${index}].name`,
        message: "Compiled node is missing a name.",
        repairHint: "Give every node a unique name.",
      });
    }
    if (nodeNames.has(node.name)) {
      errors.push({
        code: "INVALID_STEP",
        path: `nodes[${index}].name`,
        message: `Duplicate node name "${node.name}".`,
        repairHint: "Use unique node names because n8n connections reference names.",
      });
    }
    nodeNames.add(node.name);
    if (!node.type) {
      errors.push({
        code: "INVALID_STEP",
        path: `nodes[${index}].type`,
        message: "Compiled node is missing n8n type.",
        repairHint: "Use a registered node kind with an n8n node type.",
      });
    }
  });

  Object.entries(workflow.connections).forEach(([sourceName, connection]) => {
    if (!nodeNames.has(sourceName)) {
      errors.push({
        code: "INVALID_STEP",
        path: `connections.${sourceName}`,
        message: `Connection source "${sourceName}" does not match a node name.`,
        repairHint: "Use compiled n8n node names as connection keys.",
      });
    }

    connection.main.forEach((output, outputIndex) => {
      output.forEach((target, targetIndex) => {
        if (!nodeNames.has(target.node)) {
          errors.push({
            code: "BROKEN_CONNECTION",
            path: `connections.${sourceName}.main[${outputIndex}][${targetIndex}].node`,
            message: `Connection target "${target.node}" does not match a node name.`,
            repairHint: "Point the connection to an existing compiled node name.",
          });
        }
      });
    });
  });

  return { valid: errors.length === 0, errors };
}
