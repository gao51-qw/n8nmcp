import type {
  NormalizedTemplateEnvelope,
  OfficialTemplateDetail,
  OfficialTemplateSummary,
} from "./types.js";

export const PROHIBITED_TEMPLATE_NODE_TYPES = new Set([
  "n8n-nodes-base.executeCommand",
  "n8n-nodes-base.executeWorkflow",
  "n8n-nodes-base.function",
  "n8n-nodes-base.functionItem",
]);

export const SENSITIVE_TEMPLATE_KEYS = new Set([
  "credentials",
  "credential",
  "authentication",
  "authorization",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "clientsecret",
  "password",
  "privatekey",
]);

const SENSITIVE_NAME_VALUE_PARAMETERS = new Set([
  ...SENSITIVE_TEMPLATE_KEYS,
  "token",
  "xapikey",
]);

const SECRET_PATTERNS = [
  /-----BEGIN(?: [A-Z0-9]+)* PRIVATE KEY-----/i,
  /\bBearer\s+[A-Z0-9._~+/=-]{20,}/i,
  /\bsk-(?:proj-)?[A-Z0-9_-]{20,}\b/i,
  /\bxox[baprs]-[A-Z0-9-]{10,}\b/i,
  /\bxapp-\d+-A[A-Z0-9]+-\d+-[A-Za-z0-9]+(?![A-Za-z0-9-])/,
  /\bAIza[A-Z0-9_-]{30,}\b/i,
  /\beyJ[A-Z0-9_-]{5,}\.[A-Z0-9_-]{5,}\.[A-Z0-9_-]{5,}\b/i,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedCredentialName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSensitiveKey(value: string): boolean {
  return SENSITIVE_TEMPLATE_KEYS.has(normalizedCredentialName(value));
}

function isSensitiveNameValueParameter(value: Record<string, unknown>): boolean {
  return typeof value.name === "string"
    && SENSITIVE_NAME_VALUE_PARAMETERS.has(normalizedCredentialName(value.name))
    && Object.keys(value).some((key) => key.toLowerCase() === "value");
}

function removeSensitiveKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(removeSensitiveKeys);
  }
  if (!isRecord(value)) {
    return value;
  }

  const sensitiveNameValueParameter = isSensitiveNameValueParameter(value);

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !isSensitiveKey(key)
        && !(sensitiveNameValueParameter && key.toLowerCase() === "value"))
      .map(([key, child]) => [key, removeSensitiveKeys(child)]),
  );
}

export function assertTemplateContainsNoSecrets(workflow: unknown): void {
  const pending: unknown[] = [workflow];
  const visited = new WeakSet<object>();

  while (pending.length > 0) {
    const value = pending.pop();
    if (typeof value === "string") {
      if (SECRET_PATTERNS.some((pattern) => pattern.test(value))) {
        throw new Error("Template contains an embedded secret");
      }
      continue;
    }
    if (typeof value !== "object" || value === null || visited.has(value)) {
      continue;
    }
    visited.add(value);
    if (isRecord(value) && isSensitiveNameValueParameter(value)) {
      throw new Error(`Template contains sensitive name/value parameter: ${String(value.name)}`);
    }
    for (const [key, child] of Object.entries(value)) {
      if (isSensitiveKey(key)) {
        throw new Error(`Template contains sensitive key: ${key}`);
      }
      pending.push(key, child);
    }
  }
}

function sanitizeNodes(nodes: unknown[]): Array<Record<string, unknown>> {
  const retained: Array<Record<string, unknown>> = [];
  const retainedNodeNames = new Set<string>();

  for (const node of nodes) {
    if (!isRecord(node)) {
      throw new Error("Workflow nodes must be objects");
    }
    if (typeof node.type === "string" && PROHIBITED_TEMPLATE_NODE_TYPES.has(node.type)) {
      continue;
    }
    if (typeof node.name !== "string"
      || node.name.trim().length === 0
      || typeof node.type !== "string"
      || node.type.trim().length === 0) {
      throw new Error("Workflow nodes must have names and types");
    }
    if (retainedNodeNames.has(node.name)) {
      throw new Error(`Workflow contains duplicate node name ${node.name}`);
    }
    retainedNodeNames.add(node.name);
    retained.push(node);
  }

  if (retained.length === 0) {
    throw new Error("Workflow must contain retained nodes");
  }
  return retained;
}

function sanitizeConnections(
  connections: Record<string, unknown>,
  retainedNodeNames: ReadonlySet<string>,
): Record<string, unknown> {
  const retainedSources: Array<[string, unknown]> = [];

  for (const [sourceName, sourceValue] of Object.entries(connections)) {
    if (!retainedNodeNames.has(sourceName)) {
      continue;
    }
    if (!isRecord(sourceValue)) {
      throw new Error("Workflow connections must contain source objects");
    }

    const retainedConnectionTypes: Array<[string, unknown]> = [];
    for (const [connectionType, outputBranches] of Object.entries(sourceValue)) {
      if (!Array.isArray(outputBranches)) {
        throw new Error("Workflow connection outputs must be arrays");
      }

      const retainedBranches = outputBranches.map((branch) => {
        if (branch === null) {
          return [];
        }
        if (!Array.isArray(branch)) {
          throw new Error("Workflow connection branches must be arrays");
        }
        return branch.filter((target) => {
          if (!isRecord(target)
            || typeof target.node !== "string"
            || target.node.trim().length === 0
            || typeof target.type !== "string"
            || target.type.trim().length === 0
            || typeof target.index !== "number"
            || !Number.isInteger(target.index)
            || target.index < 0) {
            throw new Error("Workflow connection descriptor is malformed");
          }
          return retainedNodeNames.has(target.node);
        });
      });

      while (retainedBranches.at(-1)?.length === 0) {
        retainedBranches.pop();
      }

      if (retainedBranches.length > 0) {
        retainedConnectionTypes.push([connectionType, retainedBranches]);
      }
    }

    if (retainedConnectionTypes.length > 0) {
      retainedSources.push([sourceName, Object.fromEntries(retainedConnectionTypes)]);
    }
  }

  return Object.fromEntries(retainedSources);
}

export function normalizeAndSanitizeTemplate(
  detail: OfficialTemplateDetail,
  summary?: OfficialTemplateSummary,
): NormalizedTemplateEnvelope {
  if (!isRecord(detail.workflow)
    || !Array.isArray(detail.workflow.nodes)
    || !isRecord(detail.workflow.connections)) {
    throw new Error("Workflow nodes and connections are malformed");
  }

  const sanitizedWorkflow = removeSensitiveKeys(detail.workflow);
  if (!isRecord(sanitizedWorkflow)
    || !Array.isArray(sanitizedWorkflow.nodes)
    || !isRecord(sanitizedWorkflow.connections)) {
    throw new Error("Workflow nodes and connections are malformed");
  }
  assertTemplateContainsNoSecrets(sanitizedWorkflow);

  const nodes = sanitizeNodes(sanitizedWorkflow.nodes);
  const retainedNodeNames = new Set(nodes.map((node) => node.name as string));
  const connections = sanitizeConnections(sanitizedWorkflow.connections, retainedNodeNames);
  const totalViews = detail.totalViews ?? summary?.totalViews ?? 0;
  const user = detail.user ?? summary?.user ?? null;

  return {
    source: "official",
    curated: false,
    views: totalViews,
    workflow: {
      id: detail.id,
      name: detail.name,
      description: detail.description ?? summary?.description ?? "",
      totalViews,
      createdAt: summary?.createdAt ?? null,
      user: user === null ? null : { ...user },
      workflow: {
        ...sanitizedWorkflow,
        nodes,
        connections,
      },
    },
    sourceUrl: `https://n8n.io/workflows/${detail.id}`,
  };
}
