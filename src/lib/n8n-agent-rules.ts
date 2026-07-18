type RuleNode = {
  name: string;
  type: string;
  parameters?: Record<string, unknown>;
  credentials?: unknown;
};

type RuleWorkflow = {
  nodes: RuleNode[];
  connections?: unknown;
};

export type N8nAgentRuleCategory = "expression" | "code" | "node-config" | "workflow-pattern";

export type N8nAgentRuleWarning = {
  code:
    | "EXPRESSION_MISSING_BRACES"
    | "EXPRESSION_NESTED_BRACES"
    | "EXPRESSION_UNQUOTED_NODE_REFERENCE"
    | "WEBHOOK_ROOT_ACCESS"
    | "CODE_NODE_USES_EXPRESSIONS"
    | "CODE_NODE_MISSING_RETURN"
    | "CODE_NODE_SUSPICIOUS_RETURN"
    | "PYTHON_EXTERNAL_IMPORT"
    | "HTTP_BODY_MISSING_FOR_WRITE_METHOD"
    | "IF_OPERATOR_SINGLE_VALUE_MISMATCH"
    | "GOOGLE_SHEETS_APPEND_FORMULA_RISK";
  category: N8nAgentRuleCategory;
  severity: "high" | "medium" | "low";
  node: string;
  path: string;
  message: string;
  recommendation: string;
  source: "n8n-skills";
};

export type WorkflowPatternInference = {
  patterns: Array<
    | "webhook_processing"
    | "scheduled_task"
    | "http_api_integration"
    | "database_operation"
    | "ai_agent"
    | "batch_processing"
  >;
  evidence: string[];
};

export type N8nAgentRuleAudit = {
  warningCount: number;
  warnings: N8nAgentRuleWarning[];
  patternInference: WorkflowPatternInference;
};

const WRITE_HTTP_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const UNARY_OPERATORS = new Set(["isEmpty", "isNotEmpty", "true", "false", "exists", "notExists"]);
const BINARY_OPERATORS = new Set([
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "gt",
  "gte",
  "lt",
  "lte",
  "larger",
  "largerEqual",
  "smaller",
  "smallerEqual",
]);
const PYTHON_EXTERNAL_IMPORTS = [
  "requests",
  "pandas",
  "numpy",
  "scipy",
  "bs4",
  "lxml",
  "beautifulsoup4",
];
const PYTHON_UNSAFE_IMPORTS = [
  "ctypes",
  "marshal",
  "os",
  "pickle",
  "shlex",
  "socket",
  "subprocess",
  "sys",
  "urllib",
];
const CODE_FIELD_NAMES = new Set([
  "jsCode",
  "pythonCode",
  "code",
  "functionCode",
  "codeString",
  "script",
]);

function nodeTypeIncludes(node: RuleNode, fragment: string): boolean {
  return node.type.toLowerCase().includes(fragment.toLowerCase());
}

function pathLooksLikeCodeField(path: string): boolean {
  return /\.(jsCode|pythonCode|code|functionCode|codeString|script)$/i.test(path);
}

function nodeCodeLanguage(node: RuleNode): "javascript" | "python" | null {
  const language = String(node.parameters?.language ?? node.parameters?.mode ?? "").toLowerCase();
  const text = JSON.stringify(node.parameters ?? {}).toLowerCase();
  if (language.includes("python") || text.includes("python")) return "python";
  if (nodeTypeIncludes(node, "code")) return "javascript";
  return null;
}

function scanStrings(
  value: unknown,
  path: string,
  visit: (value: string, path: string) => void,
): void {
  if (typeof value === "string") {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanStrings(item, `${path}[${index}]`, visit));
    return;
  }
  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) =>
      scanStrings(child, `${path}.${key}`, visit),
    );
  }
}

function flattenText(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(flattenText).join(" ");
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, child]) => `${key} ${flattenText(child)}`)
      .join(" ");
  }
  return "";
}

function addWarning(warnings: N8nAgentRuleWarning[], warning: Omit<N8nAgentRuleWarning, "source">) {
  warnings.push({ ...warning, source: "n8n-skills" });
}

function referencesRuntimeData(value: string): boolean {
  return (
    /\$+\s*(?:json|node|items|input|now|env)\b/i.test(value) ||
    /\$\s*\[['"](?:json|node|items|input|now|env)['"]\]/i.test(value) ||
    /\$\s*\(\s*['"][^'"]+['"]\s*\)/.test(value)
  );
}

function referencesWebhookRootJson(value: string): boolean {
  return (
    /\$+\s*json\s*\.\s*(?!body\b|headers\b|params\b|query\b)[A-Za-z_$][\w$]*/i.test(value) ||
    /\$\s*\[['"]json['"]\]\s*\[\s*['"](?!body\b|headers\b|params\b|query\b)[A-Za-z_$][\w$]*['"]\s*\]/i.test(
      value,
    ) ||
    /\$\s*\[['"]json['"]\]\s*\.\s*(?!body\b|headers\b|params\b|query\b)[A-Za-z_$][\w$]*/i.test(
      value,
    )
  );
}

function hasN8nExpressionBraces(code: string): boolean {
  return /{{[\s\S]*?}}/.test(code);
}

function codeFields(node: RuleNode): Array<{
  code: string;
  path: string;
  language: "javascript" | "python" | null;
}> {
  const fields: Array<{ code: string; path: string; language: "javascript" | "python" | null }> =
    [];
  const parameters = node.parameters ?? {};
  for (const [key, value] of Object.entries(parameters)) {
    if (!CODE_FIELD_NAMES.has(key) || typeof value !== "string") continue;
    fields.push({
      code: value,
      path: `node(${node.name}).parameters.${key}`,
      language:
        key === "pythonCode" ? "python" : key === "jsCode" ? "javascript" : nodeCodeLanguage(node),
    });
  }
  return fields;
}

function disallowedPythonImports(code: string): string[] {
  const disallowed = new Set([...PYTHON_EXTERNAL_IMPORTS, ...PYTHON_UNSAFE_IMPORTS]);
  const modules = new Set<string>();
  const importPattern = /^\s*(?:from\s+([A-Za-z_][\w.]*)\s+import\b|import\s+([^#\n]+))/gm;
  let match: RegExpExecArray | null;
  while ((match = importPattern.exec(code)) !== null) {
    if (match[1]) {
      const moduleName = match[1].split(".")[0];
      if (disallowed.has(moduleName)) modules.add(moduleName);
      continue;
    }
    for (const importPart of (match[2] ?? "").split(",")) {
      const moduleName = importPart
        .trim()
        .split(/\s+as\s+|\s+/i)[0]
        ?.split(".")[0];
      if (moduleName && disallowed.has(moduleName)) modules.add(moduleName);
    }
  }
  return [...modules];
}

function scanExpressionRules(
  node: RuleNode,
  warnings: N8nAgentRuleWarning[],
  workflowHasWebhook: boolean,
): void {
  scanStrings(node.parameters ?? {}, `node(${node.name}).parameters`, (value, path) => {
    if (pathLooksLikeCodeField(path)) return;

    if (referencesRuntimeData(value) && !value.includes("{{")) {
      addWarning(warnings, {
        code: "EXPRESSION_MISSING_BRACES",
        category: "expression",
        severity: "medium",
        node: node.name,
        path,
        message: "Dynamic n8n data reference appears outside {{ }} expression braces.",
        recommendation: "Wrap dynamic field references as {{$json.field}} or ={{$json.field}}.",
      });
    }

    if (/{{{[^}]+}}}/.test(value)) {
      addWarning(warnings, {
        code: "EXPRESSION_NESTED_BRACES",
        category: "expression",
        severity: "high",
        node: node.name,
        path,
        message: "Expression appears to use nested triple braces.",
        recommendation: "Use exactly double braces: {{$json.field}}.",
      });
    }

    if (/\$node\.[A-Za-z_]/.test(value)) {
      addWarning(warnings, {
        code: "EXPRESSION_UNQUOTED_NODE_REFERENCE",
        category: "expression",
        severity: "high",
        node: node.name,
        path,
        message: "Node reference uses dot notation, which breaks for node names with spaces.",
        recommendation: 'Use quoted node references such as $node["HTTP Request"].json.field.',
      });
    }

    if (workflowHasWebhook && referencesWebhookRootJson(value)) {
      addWarning(warnings, {
        code: "WEBHOOK_ROOT_ACCESS",
        category: "expression",
        severity: "low",
        node: node.name,
        path,
        message: "Expression reads $json.<field>; webhook payloads usually live under $json.body.",
        recommendation:
          "If this workflow starts from a Webhook node, prefer {{$json.body.field}} for request payload fields.",
      });
    }
  });
}

function scanCodeNodeRules(node: RuleNode, warnings: N8nAgentRuleWarning[]): void {
  if (!nodeTypeIncludes(node, "code")) return;

  for (const field of codeFields(node)) {
    const code = field.code;
    if (!code.trim()) continue;

    if (hasN8nExpressionBraces(code)) {
      addWarning(warnings, {
        code: "CODE_NODE_USES_EXPRESSIONS",
        category: "code",
        severity: "high",
        node: node.name,
        path: field.path,
        message: "Code node contains n8n expression braces.",
        recommendation:
          'Use direct Code node APIs instead, for example $input.first().json.field in JavaScript or _input.first()["json"] in Python.',
      });
    }

    if (!/\breturn\b/.test(code)) {
      addWarning(warnings, {
        code: "CODE_NODE_MISSING_RETURN",
        category: "code",
        severity: "high",
        node: node.name,
        path: field.path,
        message: "Code node has no return statement.",
        recommendation: "Return an array of items, for example return [{ json: { result } }].",
      });
    }

    if (/return\s+\{(?!\s*json\s*:)/.test(code) || /return\s+['"`\d]/.test(code)) {
      addWarning(warnings, {
        code: "CODE_NODE_SUSPICIOUS_RETURN",
        category: "code",
        severity: "high",
        node: node.name,
        path: field.path,
        message: "Code node appears to return a non-n8n item shape.",
        recommendation: "Return an array where each item has a json property: [{ json: {...} }].",
      });
    }

    if (field.language === "python") {
      for (const moduleName of disallowedPythonImports(code)) {
        addWarning(warnings, {
          code: "PYTHON_EXTERNAL_IMPORT",
          category: "code",
          severity: "high",
          node: node.name,
          path: field.path,
          message: `Python Code node imports module "${moduleName}", which is unsafe or unavailable in n8n Code nodes.`,
          recommendation:
            "Use safe Python standard library modules only, switch to JavaScript, or move network/process/file operations to dedicated n8n nodes.",
        });
      }
    }
  }
}

function hasBodyLikeParameter(parameters: Record<string, unknown>): boolean {
  const text = flattenText(parameters).toLowerCase();
  return (
    parameters.sendBody === true ||
    "body" in parameters ||
    "jsonBody" in parameters ||
    "bodyParameters" in parameters ||
    text.includes("sendbody true") ||
    text.includes("bodyparameters") ||
    text.includes("jsonbody")
  );
}

function scanIfOperatorRules(
  node: RuleNode,
  warnings: N8nAgentRuleWarning[],
  value: unknown = node.parameters,
  path = `node(${node.name}).parameters`,
): void {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanIfOperatorRules(node, warnings, item, `${path}[${index}]`));
    return;
  }

  const record = value as Record<string, unknown>;
  const operation = typeof record.operation === "string" ? record.operation : "";
  if (operation) {
    const singleValue = record.singleValue;
    if (UNARY_OPERATORS.has(operation) && singleValue === false) {
      addWarning(warnings, {
        code: "IF_OPERATOR_SINGLE_VALUE_MISMATCH",
        category: "node-config",
        severity: "medium",
        node: node.name,
        path,
        message: `Unary IF/Switch operator "${operation}" should not be configured as a two-value comparison.`,
        recommendation:
          "Let n8n auto-sanitize singleValue for unary operators, or set singleValue to true.",
      });
    }
    if (BINARY_OPERATORS.has(operation) && singleValue === true) {
      addWarning(warnings, {
        code: "IF_OPERATOR_SINGLE_VALUE_MISMATCH",
        category: "node-config",
        severity: "medium",
        node: node.name,
        path,
        message: `Binary IF/Switch operator "${operation}" is marked singleValue.`,
        recommendation: "Remove singleValue for binary operators that compare value1 and value2.",
      });
    }
  }

  Object.entries(record).forEach(([key, child]) =>
    scanIfOperatorRules(node, warnings, child, `${path}.${key}`),
  );
}

function scanNodeConfigRules(node: RuleNode, warnings: N8nAgentRuleWarning[]): void {
  const parameters = node.parameters ?? {};
  if (nodeTypeIncludes(node, "httpRequest")) {
    const method = String(parameters.method ?? "GET").toUpperCase();
    if (WRITE_HTTP_METHODS.has(method) && !hasBodyLikeParameter(parameters)) {
      addWarning(warnings, {
        code: "HTTP_BODY_MISSING_FOR_WRITE_METHOD",
        category: "node-config",
        severity: "medium",
        node: node.name,
        path: `node(${node.name}).parameters`,
        message: `HTTP Request uses ${method} without an obvious request body configuration.`,
        recommendation:
          "For write methods, configure sendBody/body/bodyParameters when the API expects JSON or form data.",
      });
    }
  }

  if (nodeTypeIncludes(node, "if") || nodeTypeIncludes(node, "switch")) {
    scanIfOperatorRules(node, warnings);
  }

  if (nodeTypeIncludes(node, "googleSheets")) {
    const operation = String(parameters.operation ?? "").toLowerCase();
    const text = flattenText(parameters).toLowerCase();
    if (
      operation.includes("append") &&
      (text.includes("formula") || text.includes("inventory") || text.includes("report"))
    ) {
      addWarning(warnings, {
        code: "GOOGLE_SHEETS_APPEND_FORMULA_RISK",
        category: "node-config",
        severity: "low",
        node: node.name,
        path: `node(${node.name}).parameters.operation`,
        message:
          "Google Sheets append can break formula-dependent sheets or create per-item write pressure.",
        recommendation:
          "For sheets with formula columns or bulk reports, prefer range update / values.update after aggregating rows.",
      });
    }
  }
}

export function inferWorkflowPatterns(workflow: RuleWorkflow): WorkflowPatternInference {
  const nodeTypes = workflow.nodes.map((node) => node.type.toLowerCase());
  const text = workflow.nodes
    .map((node) => `${node.name} ${node.type} ${flattenText(node.parameters)}`)
    .join(" ")
    .toLowerCase();
  const patterns: WorkflowPatternInference["patterns"] = [];
  const evidence: string[] = [];

  if (nodeTypes.some((type) => type.includes("webhook"))) {
    patterns.push("webhook_processing");
    evidence.push("Workflow contains a Webhook node");
  }
  if (nodeTypes.some((type) => type.includes("schedule") || type.includes("cron"))) {
    patterns.push("scheduled_task");
    evidence.push("Workflow contains a Schedule/Cron trigger");
  }
  if (nodeTypes.some((type) => type.includes("httprequest"))) {
    patterns.push("http_api_integration");
    evidence.push("Workflow contains HTTP Request nodes");
  }
  if (nodeTypes.some((type) => /(postgres|mysql|mongodb|database)/.test(type))) {
    patterns.push("database_operation");
    evidence.push("Workflow contains database nodes");
  }
  if (
    nodeTypes.some((type) => type.includes("langchain") || type.includes("openai")) ||
    text.includes("ai agent")
  ) {
    patterns.push("ai_agent");
    evidence.push("Workflow contains AI/agent-related nodes");
  }
  if (nodeTypes.some((type) => type.includes("splitinbatches")) || text.includes("pagination")) {
    patterns.push("batch_processing");
    evidence.push("Workflow contains Split In Batches or pagination signals");
  }

  return { patterns, evidence };
}

export function auditN8nAgentRules(workflow: RuleWorkflow): N8nAgentRuleAudit {
  const warnings: N8nAgentRuleWarning[] = [];
  const workflowHasWebhook = workflow.nodes.some((node) => nodeTypeIncludes(node, "webhook"));
  for (const node of workflow.nodes) {
    scanExpressionRules(node, warnings, workflowHasWebhook);
    scanCodeNodeRules(node, warnings);
    scanNodeConfigRules(node, warnings);
  }

  return {
    warningCount: warnings.length,
    warnings,
    patternInference: inferWorkflowPatterns(workflow),
  };
}
