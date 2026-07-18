import type { NodeKind, NodeTemplate } from "./node-registry";

export type OfficialNodeRule = {
  n8nType: string;
  packageName: NodeTemplate["packageName"];
  officialName: string;
  officialDefaultVersion: number;
  connectionProfile: "main" | "trigger" | "aiTool" | "mcpServerTrigger";
  blueprintSupport: "linear" | "requires-special-connections" | "not-user-facing";
};

export type NodeRegistryValidationIssue = {
  code:
    | "KIND_MISMATCH"
    | "UNKNOWN_KIND"
    | "INVALID_TEMPLATE"
    | "INVALID_LABEL"
    | "INVALID_N8N_TYPE"
    | "INVALID_VERSION"
    | "INVALID_REQUIRED_PARAM"
    | "INVALID_ACTION"
    | "OFFICIAL_TYPE_MISMATCH"
    | "OFFICIAL_PACKAGE_MISMATCH";
  severity: "error" | "warning";
  kind: string;
  path: string;
  message: string;
};

export type NodeRegistryValidationResult = {
  valid: boolean;
  errors: NodeRegistryValidationIssue[];
  warnings: NodeRegistryValidationIssue[];
};

const SUPPORTED_NODE_KINDS = new Set<string>([
  "schedule",
  "webhook",
  "manual",
  "slack",
  "http",
  "email",
  "googleSheets",
  "openai",
  "mcpClient",
  "code",
  "if",
  "set",
]);

export const OFFICIAL_NODE_RULES: Partial<Record<NodeKind, OfficialNodeRule>> & {
  mcpClientTool: OfficialNodeRule;
  mcpTrigger: OfficialNodeRule;
} = {
  schedule: {
    n8nType: "n8n-nodes-base.scheduleTrigger",
    packageName: "n8n-nodes-base",
    officialName: "scheduleTrigger",
    officialDefaultVersion: 1.3,
    connectionProfile: "trigger",
    blueprintSupport: "linear",
  },
  webhook: {
    n8nType: "n8n-nodes-base.webhook",
    packageName: "n8n-nodes-base",
    officialName: "webhook",
    officialDefaultVersion: 2.1,
    connectionProfile: "trigger",
    blueprintSupport: "linear",
  },
  manual: {
    n8nType: "n8n-nodes-base.manualTrigger",
    packageName: "n8n-nodes-base",
    officialName: "manualTrigger",
    officialDefaultVersion: 1,
    connectionProfile: "trigger",
    blueprintSupport: "linear",
  },
  slack: {
    n8nType: "n8n-nodes-base.slack",
    packageName: "n8n-nodes-base",
    officialName: "slack",
    officialDefaultVersion: 2.5,
    connectionProfile: "main",
    blueprintSupport: "linear",
  },
  http: {
    n8nType: "n8n-nodes-base.httpRequest",
    packageName: "n8n-nodes-base",
    officialName: "httpRequest",
    officialDefaultVersion: 4.4,
    connectionProfile: "main",
    blueprintSupport: "linear",
  },
  googleSheets: {
    n8nType: "n8n-nodes-base.googleSheets",
    packageName: "n8n-nodes-base",
    officialName: "googleSheets",
    officialDefaultVersion: 4.7,
    connectionProfile: "main",
    blueprintSupport: "linear",
  },
  openai: {
    n8nType: "@n8n/n8n-nodes-langchain.openAi",
    packageName: "@n8n/n8n-nodes-langchain",
    officialName: "openAi",
    officialDefaultVersion: 1,
    connectionProfile: "main",
    blueprintSupport: "linear",
  },
  mcpClient: {
    n8nType: "@n8n/n8n-nodes-langchain.mcpClient",
    packageName: "@n8n/n8n-nodes-langchain",
    officialName: "mcpClient",
    officialDefaultVersion: 1.1,
    connectionProfile: "main",
    blueprintSupport: "linear",
  },
  code: {
    n8nType: "n8n-nodes-base.code",
    packageName: "n8n-nodes-base",
    officialName: "code",
    officialDefaultVersion: 2,
    connectionProfile: "main",
    blueprintSupport: "linear",
  },
  mcpClientTool: {
    n8nType: "@n8n/n8n-nodes-langchain.mcpClientTool",
    packageName: "@n8n/n8n-nodes-langchain",
    officialName: "mcpClientTool",
    officialDefaultVersion: 1.3,
    connectionProfile: "aiTool",
    blueprintSupport: "requires-special-connections",
  },
  mcpTrigger: {
    n8nType: "@n8n/n8n-nodes-langchain.mcpTrigger",
    packageName: "@n8n/n8n-nodes-langchain",
    officialName: "mcpTrigger",
    officialDefaultVersion: 2,
    connectionProfile: "mcpServerTrigger",
    blueprintSupport: "requires-special-connections",
  },
};

function issue(
  issues: NodeRegistryValidationIssue[],
  severity: NodeRegistryValidationIssue["severity"],
  code: NodeRegistryValidationIssue["code"],
  kind: string,
  path: string,
  message: string,
) {
  issues.push({ severity, code, kind, path, message });
}

function isValidN8nType(value: string): boolean {
  return (
    /^n8n-nodes-base\.[a-z][a-zA-Z0-9]*$/.test(value) ||
    /^@n8n\/n8n-nodes-langchain\.[a-z][a-zA-Z0-9]*$/.test(value)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRequiredParams(
  issues: NodeRegistryValidationIssue[],
  kind: string,
  path: string,
  requiredParams: string[] | undefined,
) {
  if (!requiredParams) return;
  requiredParams.forEach((param, index) => {
    if (typeof param !== "string" || param.trim().length === 0) {
      issue(
        issues,
        "error",
        "INVALID_REQUIRED_PARAM",
        kind,
        `${path}[${index}]`,
        "requiredParams entries must be non-empty strings.",
      );
    }
  });
}

export function validateNodeRegistry(
  registry: Record<string, NodeTemplate>,
): NodeRegistryValidationResult {
  const issues: NodeRegistryValidationIssue[] = [];

  Object.entries(registry).forEach(([kind, template]) => {
    if (!SUPPORTED_NODE_KINDS.has(kind)) {
      issue(
        issues,
        "error",
        "UNKNOWN_KIND",
        kind,
        kind,
        `Unsupported node registry key "${kind}".`,
      );
    }

    if (!isRecord(template)) {
      issue(
        issues,
        "error",
        "INVALID_TEMPLATE",
        kind,
        kind,
        "Node registry entries must be template objects.",
      );
      return;
    }

    if (template.kind !== kind) {
      issue(
        issues,
        "error",
        "KIND_MISMATCH",
        kind,
        `${kind}.kind`,
        `Template kind "${template.kind}" must match registry key "${kind}".`,
      );
    }
    if (typeof template.label !== "string" || template.label.trim().length === 0) {
      issue(issues, "error", "INVALID_LABEL", kind, `${kind}.label`, "Label is required.");
    }
    if (!isValidN8nType(template.n8nType)) {
      issue(
        issues,
        "error",
        "INVALID_N8N_TYPE",
        kind,
        `${kind}.n8nType`,
        `Unsupported n8n type "${template.n8nType}". Use n8n-nodes-base.* or @n8n/n8n-nodes-langchain.*.`,
      );
    }
    if (
      typeof template.defaultTypeVersion !== "number" ||
      !Number.isFinite(template.defaultTypeVersion) ||
      template.defaultTypeVersion <= 0
    ) {
      issue(
        issues,
        "error",
        "INVALID_VERSION",
        kind,
        `${kind}.defaultTypeVersion`,
        "defaultTypeVersion must be a positive number.",
      );
    }

    validateRequiredParams(issues, kind, `${kind}.requiredParams`, template.requiredParams);

    Object.entries(template.actions ?? {}).forEach(([actionName, action]) => {
      if (typeof actionName !== "string" || actionName.trim().length === 0) {
        issue(
          issues,
          "error",
          "INVALID_ACTION",
          kind,
          `${kind}.actions`,
          "Action names must be non-empty strings.",
        );
      }
      if (action.resource !== undefined && typeof action.resource !== "string") {
        issue(
          issues,
          "error",
          "INVALID_ACTION",
          kind,
          `${kind}.actions.${actionName}.resource`,
          "Action resource must be a string when provided.",
        );
      }
      if (action.operation !== undefined && typeof action.operation !== "string") {
        issue(
          issues,
          "error",
          "INVALID_ACTION",
          kind,
          `${kind}.actions.${actionName}.operation`,
          "Action operation must be a string when provided.",
        );
      }
      validateRequiredParams(
        issues,
        kind,
        `${kind}.actions.${actionName}.requiredParams`,
        action.requiredParams,
      );
    });

    const official = OFFICIAL_NODE_RULES[kind as NodeKind];
    if (!official) return;
    if (template.n8nType !== official.n8nType) {
      issue(
        issues,
        "error",
        "OFFICIAL_TYPE_MISMATCH",
        kind,
        `${kind}.n8nType`,
        `Expected official type "${official.n8nType}".`,
      );
    }
    if (template.packageName && template.packageName !== official.packageName) {
      issue(
        issues,
        "error",
        "OFFICIAL_PACKAGE_MISMATCH",
        kind,
        `${kind}.packageName`,
        `Expected official package "${official.packageName}".`,
      );
    }
    if (template.defaultTypeVersion < official.officialDefaultVersion) {
      issue(
        issues,
        "warning",
        "INVALID_VERSION",
        kind,
        `${kind}.defaultTypeVersion`,
        `Template uses ${template.defaultTypeVersion}; official default is ${official.officialDefaultVersion}.`,
      );
    }
  });

  const errors = issues.filter((item) => item.severity === "error");
  const warnings = issues.filter((item) => item.severity === "warning");
  return { valid: errors.length === 0, errors, warnings };
}

export function assertValidNodeRegistry(registry: Record<string, NodeTemplate>): void {
  const result = validateNodeRegistry(registry);
  if (!result.valid) {
    throw new Error(
      `Invalid node registry:\n${result.errors
        .map((error) => `${error.path}: ${error.message}`)
        .join("\n")}`,
    );
  }
}
