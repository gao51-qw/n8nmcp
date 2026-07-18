import {
  auditN8nAgentRules,
  type N8nAgentRuleAudit,
  type N8nAgentRuleWarning,
} from "./n8n-agent-rules";

export type WorkflowNodeShape = {
  id?: string;
  name: string;
  type: string;
  typeVersion?: number;
  position?: [number, number] | number[];
  parameters?: Record<string, unknown>;
  [key: string]: unknown;
};

export type WorkflowConnectionTarget = {
  node: string;
  type: string;
  index: number;
};

export type WorkflowConnections = Record<
  string,
  { main?: Array<Array<WorkflowConnectionTarget>>; [key: string]: unknown }
>;

export type WorkflowShape = {
  id?: string | number;
  name?: string;
  nodes: WorkflowNodeShape[];
  connections: WorkflowConnections;
  settings?: Record<string, unknown>;
  [key: string]: unknown;
};

export type BrokenConnection = {
  from: string;
  to: string;
  path: string;
};

export type WorkflowGraphAnalysis = {
  summary: {
    nodeCount: number;
    connectionCount: number;
    triggerCount: number;
    orphanCount: number;
    brokenConnectionCount: number;
    duplicateNameCount: number;
  };
  triggerNodes: string[];
  terminalNodes: string[];
  orphanNodes: string[];
  duplicateNames: string[];
  brokenConnections: BrokenConnection[];
  modules: Array<{ root: string; nodes: string[] }>;
};

export type WorkflowPatchOperation =
  | {
      op: "updateNodeParameters";
      node: string;
      parameters: Record<string, unknown>;
    }
  | {
      op: "replaceNodeParameters";
      node: string;
      parameters: Record<string, unknown>;
    }
  | {
      op: "addConnection";
      from: string;
      to: string;
      outputIndex?: number;
    }
  | {
      op: "removeConnection";
      from: string;
      to: string;
    };

export type WorkflowPatch = {
  operations: WorkflowPatchOperation[];
};

export type WorkflowPatchProposal = {
  patch: WorkflowPatch;
  confidence: "high" | "medium" | "low";
  rationale: string[];
  skipped: Array<{
    reason: string;
    nodes?: string[];
    connections?: BrokenConnection[];
  }>;
};

export type WorkflowSimplificationProposal = {
  mode: "conservative";
  confidence: "high" | "medium" | "low";
  safePatch: WorkflowPatch;
  removableNodes: Array<{
    node: string;
    action: "removeNode";
    confidence: "high";
    reason: string;
    safetyChecks: {
      reachableFromTrigger: boolean;
      referencedByExpression: boolean;
      hasExternalSideEffect: boolean;
      hasConnections: boolean;
    };
  }>;
  skippedNodes: Array<{
    node: string;
    reason: string;
    safetyChecks: {
      reachableFromTrigger: boolean;
      referencedByExpression: boolean;
      hasExternalSideEffect: boolean;
      hasConnections: boolean;
    };
  }>;
  warnings: string[];
};

export type WorkflowSimplificationPreview = {
  valid: boolean;
  requestedNodes: string[];
  approvedNodes: string[];
  rejectedNodes: Array<{
    node: string;
    reason: string;
  }>;
  nodeCountBefore: number;
  nodeCountAfter: number;
  removedNodeCount: number;
  safePatch: WorkflowPatch;
  warnings: string[];
};

export type WorkflowModuleSummary = {
  root: string;
  nodeCount: number;
  nodes: string[];
  terminalNodes: string[];
  nodeTypes: string[];
  brokenConnections: BrokenConnection[];
};

export type ExpressionDependency = {
  fromNode: string;
  toNode: string;
  path: string;
  expression: string;
  exists: boolean;
};

export type ExpressionDependencyAudit = {
  dependencyCount: number;
  missingCount: number;
  dependencies: ExpressionDependency[];
  missingReferences: Array<{
    fromNode: string;
    toNode: string;
    path: string;
  }>;
  warningCount: number;
  syntaxWarnings: N8nAgentRuleWarning[];
};

export type WorkflowSemanticModule = {
  id: string;
  label: string;
  root: string;
  role: "ingress" | "transform" | "branch" | "notification" | "external";
  nodeCount: number;
  nodes: string[];
  entryNodes: string[];
  exitNodes: string[];
  nodeTypes: string[];
  risks: string[];
};

export type WorkflowPatchDiff = {
  changed: boolean;
  before: WorkflowShape;
  after: WorkflowShape;
  summary: {
    addedNodes: number;
    removedNodes: number;
    updatedNodes: number;
    addedConnections: number;
    removedConnections: number;
  };
  nodeChanges: Array<{
    node: string;
    change: "added" | "removed" | "updated";
    beforeParameters?: Record<string, unknown>;
    afterParameters?: Record<string, unknown>;
  }>;
  connectionChanges: Array<{
    change: "added" | "removed";
    from: string;
    to: string;
  }>;
};

export type WorkflowReviewBatch = {
  index: number;
  nodeCount: number;
  startNode: string;
  endNode: string;
  nodes: string[];
  risks: string[];
};

export type WorkflowBusinessDomain =
  "advertising" | "orders" | "inventory" | "notifications" | "crm" | "finance" | "data" | "unknown";

export type WorkflowBusinessIntent = {
  summary: {
    primaryIntent: string;
    confidence: "high" | "medium" | "low";
    domains: WorkflowBusinessDomain[];
    systems: string[];
  };
  nodeIntents: Array<{
    node: string;
    businessDomain: WorkflowBusinessDomain;
    system: string;
    entity: string;
    action: string;
    confidence: "high" | "medium" | "low";
    evidence: string[];
  }>;
  dataFlows: Array<{
    from: string;
    to: string;
    fromDomain: WorkflowBusinessDomain;
    toDomain: WorkflowBusinessDomain;
    inferredPurpose: string;
  }>;
  agentRules: N8nAgentRuleAudit;
};

export type WorkflowPatchValidationError = {
  code:
    | "PATCH_TARGET_NOT_FOUND"
    | "PATCH_SOURCE_NOT_FOUND"
    | "PATCH_CONNECTION_TARGET_NOT_FOUND"
    | "PATCH_INVALID_OPERATION";
  path: string;
  message: string;
};

export type WorkflowPatchValidationResult = {
  valid: boolean;
  errors: WorkflowPatchValidationError[];
};

function cloneWorkflow(workflow: WorkflowShape): WorkflowShape {
  return JSON.parse(JSON.stringify(workflow)) as WorkflowShape;
}

function nodeNames(workflow: WorkflowShape): Set<string> {
  return new Set(workflow.nodes.map((node) => node.name));
}

function isTriggerNode(node: WorkflowNodeShape): boolean {
  return node.type.toLowerCase().includes("trigger");
}

function outgoingTargets(workflow: WorkflowShape, source: string): string[] {
  const main = workflow.connections[source]?.main ?? [];
  return main.flatMap((output) => output.map((target) => target.node));
}

function outgoingConnections(workflow: WorkflowShape): Array<{ from: string; to: string }> {
  return Object.entries(workflow.connections).flatMap(([from, connection]) =>
    (connection.main ?? []).flatMap((output) =>
      output.map((target) => ({ from, to: target.node })),
    ),
  );
}

function incomingCounts(workflow: WorkflowShape): Map<string, number> {
  const counts = new Map<string, number>();
  for (const node of workflow.nodes) counts.set(node.name, 0);
  for (const connection of Object.values(workflow.connections)) {
    for (const output of connection.main ?? []) {
      for (const target of output) {
        counts.set(target.node, (counts.get(target.node) ?? 0) + 1);
      }
    }
  }
  return counts;
}

function connectionCount(connections: WorkflowConnections): number {
  return Object.values(connections).reduce((count, connection) => {
    return count + (connection.main ?? []).reduce((sum, output) => sum + output.length, 0);
  }, 0);
}

function findBrokenConnections(workflow: WorkflowShape): BrokenConnection[] {
  const names = nodeNames(workflow);
  const broken: BrokenConnection[] = [];

  Object.entries(workflow.connections).forEach(([source, connection]) => {
    connection.main?.forEach((output, outputIndex) => {
      output.forEach((target, targetIndex) => {
        if (!names.has(target.node)) {
          broken.push({
            from: source,
            to: target.node,
            path: `connections.${source}.main[${outputIndex}][${targetIndex}].node`,
          });
        }
      });
    });
  });

  return broken;
}

function findBrokenConnectionsInNodes(
  workflow: WorkflowShape,
  moduleNodes: Set<string>,
): BrokenConnection[] {
  return findBrokenConnections(workflow).filter(
    (connection) => moduleNodes.has(connection.from) || moduleNodes.has(connection.to),
  );
}

function findDuplicateNames(workflow: WorkflowShape): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const node of workflow.nodes) {
    if (seen.has(node.name)) duplicates.add(node.name);
    seen.add(node.name);
  }
  return [...duplicates];
}

function reachableFrom(workflow: WorkflowShape, root: string): string[] {
  const names = nodeNames(workflow);
  const visited = new Set<string>();
  const queue = [root];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current) || !names.has(current)) continue;
    visited.add(current);
    for (const target of outgoingTargets(workflow, current)) {
      if (!visited.has(target)) queue.push(target);
    }
  }

  return [...visited];
}

function reachableFromAnyTrigger(workflow: WorkflowShape): Set<string> {
  const triggerNodes = workflow.nodes.filter(isTriggerNode).map((node) => node.name);
  const roots =
    triggerNodes.length > 0 ? triggerNodes : workflow.nodes.slice(0, 1).map((n) => n.name);
  return new Set(roots.flatMap((root) => reachableFrom(workflow, root)));
}

export function analyzeWorkflowGraph(workflow: WorkflowShape): WorkflowGraphAnalysis {
  const incoming = incomingCounts(workflow);
  const triggerNodes = workflow.nodes.filter(isTriggerNode).map((node) => node.name);
  const terminalNodes = workflow.nodes
    .filter((node) => outgoingTargets(workflow, node.name).length === 0)
    .map((node) => node.name);
  const orphanNodes = workflow.nodes
    .filter((node) => !isTriggerNode(node) && (incoming.get(node.name) ?? 0) === 0)
    .map((node) => node.name);
  const brokenConnections = findBrokenConnections(workflow);
  const duplicateNames = findDuplicateNames(workflow);
  const roots =
    triggerNodes.length > 0 ? triggerNodes : workflow.nodes.slice(0, 1).map((n) => n.name);
  const modules = roots.map((root) => ({ root, nodes: reachableFrom(workflow, root) }));

  return {
    summary: {
      nodeCount: workflow.nodes.length,
      connectionCount: connectionCount(workflow.connections),
      triggerCount: triggerNodes.length,
      orphanCount: orphanNodes.length,
      brokenConnectionCount: brokenConnections.length,
      duplicateNameCount: duplicateNames.length,
    },
    triggerNodes,
    terminalNodes,
    orphanNodes,
    duplicateNames,
    brokenConnections,
    modules,
  };
}

export function proposeWorkflowPatch(workflow: WorkflowShape): WorkflowPatchProposal {
  const analysis = analyzeWorkflowGraph(workflow);
  const operations: WorkflowPatchOperation[] = analysis.brokenConnections.map((connection) => ({
    op: "removeConnection",
    from: connection.from,
    to: connection.to,
  }));

  const skipped: WorkflowPatchProposal["skipped"] = [];
  if (analysis.orphanNodes.length > 0) {
    skipped.push({
      reason: "Orphan nodes require semantic review before reconnecting.",
      nodes: analysis.orphanNodes,
    });
  }
  if (analysis.duplicateNames.length > 0) {
    skipped.push({
      reason: "Duplicate node names require human review before renaming.",
      nodes: analysis.duplicateNames,
    });
  }

  return {
    patch: { operations },
    confidence: operations.length > 0 ? "high" : "medium",
    rationale: analysis.brokenConnections.map(
      (connection) =>
        `Remove broken connection from "${connection.from}" to missing node "${connection.to}".`,
    ),
    skipped,
  };
}

function hasExternalSideEffect(node: WorkflowNodeShape): boolean {
  const text = JSON.stringify({
    name: node.name,
    type: node.type,
    parameters: node.parameters ?? {},
    credentials: node.credentials ?? {},
  }).toLowerCase();

  const method =
    typeof node.parameters?.method === "string" ? node.parameters.method.toLowerCase() : "";
  const operation =
    typeof node.parameters?.operation === "string" ? node.parameters.operation.toLowerCase() : "";

  if (isTriggerNode(node)) return true;
  if (text.includes("webhook")) return true;
  if (text.includes("slack") || text.includes("email") || text.includes("telegram")) return true;
  if (text.includes("postgres") || text.includes("mysql") || text.includes("supabase")) return true;
  if (node.type.toLowerCase().includes("httprequest") && method && method !== "get") return true;
  if (
    ["post", "send", "create", "update", "delete", "append", "upsert"].some((keyword) =>
      operation.includes(keyword),
    )
  ) {
    return true;
  }

  return false;
}

export function proposeWorkflowSimplification(
  workflow: WorkflowShape,
): WorkflowSimplificationProposal {
  const analysis = analyzeWorkflowGraph(workflow);
  const reachable = reachableFromAnyTrigger(workflow);
  const expressionAudit = auditExpressionDependencies(workflow);
  const referencedNodes = new Set(
    expressionAudit.dependencies.map((dependency) => dependency.toNode),
  );
  const incoming = incomingCounts(workflow);
  const removableNodes: WorkflowSimplificationProposal["removableNodes"] = [];
  const skippedNodes: WorkflowSimplificationProposal["skippedNodes"] = [];
  const safePatch: WorkflowPatch = {
    operations: analysis.brokenConnections.map((connection) => ({
      op: "removeConnection",
      from: connection.from,
      to: connection.to,
    })),
  };

  for (const node of workflow.nodes) {
    const safetyChecks = {
      reachableFromTrigger: reachable.has(node.name),
      referencedByExpression: referencedNodes.has(node.name),
      hasExternalSideEffect: hasExternalSideEffect(node),
      hasConnections:
        (incoming.get(node.name) ?? 0) > 0 || outgoingTargets(workflow, node.name).length > 0,
    };

    if (safetyChecks.reachableFromTrigger) continue;

    if (
      !safetyChecks.referencedByExpression &&
      !safetyChecks.hasExternalSideEffect &&
      !safetyChecks.hasConnections
    ) {
      removableNodes.push({
        node: node.name,
        action: "removeNode",
        confidence: "high",
        reason:
          "Node is unreachable from all triggers, has no incoming/outgoing connections, is not referenced by expressions, and has no detected external side effects.",
        safetyChecks,
      });
      continue;
    }

    const reason = safetyChecks.referencedByExpression
      ? "Node is referenced by an expression."
      : safetyChecks.hasExternalSideEffect
        ? "Node may have external side effects."
        : "Node has existing connections.";
    skippedNodes.push({ node: node.name, reason, safetyChecks });
  }

  return {
    mode: "conservative",
    confidence: removableNodes.length > 0 || safePatch.operations.length > 0 ? "high" : "medium",
    safePatch,
    removableNodes,
    skippedNodes,
    warnings: [
      "Node removal is proposed only as a review candidate; apply it through a dedicated simplification workflow after cloning or previewing a draft.",
    ],
  };
}

export function previewWorkflowSimplification(
  workflow: WorkflowShape,
  candidateNodeNames: string[],
): WorkflowSimplificationPreview {
  const proposal = proposeWorkflowSimplification(workflow);
  const approvedCandidateNames = new Set(
    proposal.removableNodes.map((candidate) => candidate.node),
  );
  const requestedNodes = [...new Set(candidateNodeNames)];
  const approvedNodes = requestedNodes.filter((node) => approvedCandidateNames.has(node));
  const rejectedNodes = requestedNodes
    .filter((node) => !approvedCandidateNames.has(node))
    .map((node) => ({
      node,
      reason: "Requested node is not an approved conservative simplification candidate.",
    }));

  return {
    valid: rejectedNodes.length === 0,
    requestedNodes,
    approvedNodes,
    rejectedNodes,
    nodeCountBefore: workflow.nodes.length,
    nodeCountAfter: workflow.nodes.length - approvedNodes.length,
    removedNodeCount: approvedNodes.length,
    safePatch: proposal.safePatch,
    warnings: [
      "Simplification preview does not mutate the source workflow.",
      ...(rejectedNodes.length > 0 ? ["Rejected nodes must not be removed automatically."] : []),
    ],
  };
}

export function simplifyWorkflowAsDraft(
  workflow: WorkflowShape,
  candidateNodeNames: string[],
  name = `Simplified ${workflow.name ?? "workflow"}`,
): WorkflowShape {
  const preview = previewWorkflowSimplification(workflow, candidateNodeNames);
  if (!preview.valid) {
    throw new Error(
      `Invalid simplification candidates: ${preview.rejectedNodes.map((node) => node.node).join(", ")}`,
    );
  }

  const removed = new Set(preview.approvedNodes);
  let draft = cloneWorkflowAsDraft(workflow, name);
  draft.nodes = draft.nodes.filter((node) => !removed.has(node.name));

  const cleanedConnections: WorkflowConnections = {};
  for (const [source, connection] of Object.entries(draft.connections ?? {})) {
    if (removed.has(source)) continue;
    cleanedConnections[source] = {
      ...connection,
      main: (connection.main ?? []).map((output) =>
        output.filter((target) => !removed.has(target.node)),
      ),
    };
  }
  draft.connections = cleanedConnections;

  if (preview.safePatch.operations.length > 0) {
    draft = applyWorkflowPatch(draft, preview.safePatch).workflow;
  }

  draft.active = false;
  return draft;
}

export function summarizeWorkflowModules(workflow: WorkflowShape): WorkflowModuleSummary[] {
  const analysis = analyzeWorkflowGraph(workflow);
  const nodeByName = new Map(workflow.nodes.map((node) => [node.name, node]));

  return analysis.modules.map((module) => {
    const moduleNodeSet = new Set(module.nodes);
    const terminalNodes = analysis.terminalNodes.filter((name) => moduleNodeSet.has(name));
    const nodeTypes = [
      ...new Set(
        module.nodes
          .map((name) => nodeByName.get(name)?.type)
          .filter((type): type is string => typeof type === "string"),
      ),
    ];

    return {
      root: module.root,
      nodeCount: module.nodes.length,
      nodes: module.nodes,
      terminalNodes,
      nodeTypes,
      brokenConnections: findBrokenConnectionsInNodes(workflow, moduleNodeSet),
    };
  });
}

function classifyNodeRole(node: WorkflowNodeShape): WorkflowSemanticModule["role"] {
  const haystack = `${node.type} ${node.name}`.toLowerCase();
  if (haystack.includes("trigger") || haystack.includes("webhook")) return "ingress";
  if (haystack.includes("if") || haystack.includes("switch")) return "branch";
  if (
    haystack.includes("slack") ||
    haystack.includes("email") ||
    haystack.includes("telegram") ||
    haystack.includes("discord")
  ) {
    return "notification";
  }
  if (haystack.includes("http") || haystack.includes("postgres") || haystack.includes("mysql")) {
    return "external";
  }
  return "transform";
}

function moduleLabel(role: WorkflowSemanticModule["role"], root: string): string {
  if (role === "ingress") return "Ingress and preparation";
  if (role === "notification") {
    if (root.toLowerCase().includes("slack")) return "Slack branch";
    if (root.toLowerCase().includes("email")) return "Email branch";
    return "Notification branch";
  }
  if (role === "external") return "External data access";
  if (role === "branch") return "Branching logic";
  return "Transform segment";
}

export function summarizeWorkflowSemanticModules(
  workflow: WorkflowShape,
): WorkflowSemanticModule[] {
  const names = nodeNames(workflow);
  const incoming = incomingCounts(workflow);
  const nodeByName = new Map(workflow.nodes.map((node) => [node.name, node]));
  const roots = workflow.nodes
    .filter((node) => isTriggerNode(node) || (incoming.get(node.name) ?? 0) === 0)
    .map((node) => node.name);
  const modules: WorkflowSemanticModule[] = [];
  const assigned = new Set<string>();
  const queue = roots.length > 0 ? [...roots] : workflow.nodes.slice(0, 1).map((node) => node.name);

  while (queue.length > 0) {
    const root = queue.shift()!;
    if (assigned.has(root) || !names.has(root)) continue;

    const nodes: string[] = [];
    let current: string | undefined = root;
    const exits = new Set<string>();

    while (current && !assigned.has(current) && names.has(current)) {
      nodes.push(current);
      assigned.add(current);

      const targets: string[] = outgoingTargets(workflow, current).filter((target) =>
        names.has(target),
      );
      if (targets.length !== 1) {
        targets.forEach((target) => {
          exits.add(target);
          if (!assigned.has(target)) queue.push(target);
        });
        break;
      }

      const [next] = targets;
      if ((incoming.get(next) ?? 0) > 1) {
        exits.add(next);
        if (!assigned.has(next)) queue.push(next);
        break;
      }

      const nextRole = classifyNodeRole(nodeByName.get(next)!);
      const currentRole = classifyNodeRole(nodeByName.get(current)!);
      if (nodes.length > 1 && nextRole !== currentRole && nextRole === "notification") {
        exits.add(next);
        if (!assigned.has(next)) queue.push(next);
        break;
      }

      current = next;
    }

    const rootNode = nodeByName.get(root);
    const role = rootNode ? classifyNodeRole(rootNode) : "transform";
    const nodeTypes = [
      ...new Set(
        nodes
          .map((name) => nodeByName.get(name)?.type)
          .filter((type): type is string => typeof type === "string"),
      ),
    ];

    modules.push({
      id: `module-${modules.length + 1}`,
      label: moduleLabel(role, root),
      root,
      role,
      nodeCount: nodes.length,
      nodes,
      entryNodes: [root],
      exitNodes: [...exits],
      nodeTypes,
      risks: findBrokenConnectionsInNodes(workflow, new Set(nodes)).map(
        (connection) => `Broken connection to missing node "${connection.to}".`,
      ),
    });
  }

  return modules;
}

function scanParameterExpressions(
  value: unknown,
  path: string,
  visit: (expression: string, path: string) => void,
) {
  if (typeof value === "string") {
    if (value.includes("$node[") || value.includes("$(") || value.includes("$items(")) {
      visit(value, path);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => scanParameterExpressions(item, `${path}[${index}]`, visit));
    return;
  }

  if (value && typeof value === "object") {
    Object.entries(value as Record<string, unknown>).forEach(([key, child]) => {
      scanParameterExpressions(child, `${path}.${key}`, visit);
    });
  }
}

export function auditExpressionDependencies(workflow: WorkflowShape): ExpressionDependencyAudit {
  const names = nodeNames(workflow);
  const dependencies: ExpressionDependency[] = [];
  const syntaxWarnings = auditN8nAgentRules(workflow).warnings.filter(
    (warning) => warning.category === "expression" || warning.category === "code",
  );
  const dependencyPatterns = [
    /\$node\[['"]([^'"]+)['"]\]/g,
    /\$\(['"]([^'"]+)['"]\)/g,
    /\$items\(['"]([^'"]+)['"]\)/g,
  ];

  workflow.nodes.forEach((node, index) => {
    scanParameterExpressions(
      node.parameters ?? {},
      `nodes[${index}].parameters`,
      (expression, path) => {
        for (const pattern of dependencyPatterns) {
          for (const match of expression.matchAll(pattern)) {
            const toNode = match[1];
            dependencies.push({
              fromNode: node.name,
              toNode,
              path,
              expression,
              exists: names.has(toNode),
            });
          }
        }
      },
    );
  });

  const missingReferences = dependencies
    .filter((dependency) => !dependency.exists)
    .map((dependency) => ({
      fromNode: dependency.fromNode,
      toNode: dependency.toNode,
      path: dependency.path,
    }));

  return {
    dependencyCount: dependencies.length,
    missingCount: missingReferences.length,
    dependencies,
    missingReferences,
    warningCount: syntaxWarnings.length,
    syntaxWarnings,
  };
}

export function cloneWorkflowAsDraft(
  workflow: WorkflowShape,
  name = `Copy of ${workflow.name ?? "workflow"}`,
): WorkflowShape {
  const clone = cloneWorkflow(workflow);
  delete clone.id;
  delete clone.versionId;
  delete clone.createdAt;
  delete clone.updatedAt;
  clone.name = name;
  clone.active = false;
  return clone;
}

function parameterEquals(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

function connectionKey(connection: { from: string; to: string }) {
  return `${connection.from}\u0000${connection.to}`;
}

export function createPatchDiff(workflow: WorkflowShape, patch: WorkflowPatch): WorkflowPatchDiff {
  const before = cloneWorkflow(workflow);
  const { workflow: after, changed } = applyWorkflowPatch(workflow, patch);
  const beforeNodes = new Map(before.nodes.map((node) => [node.name, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.name, node]));
  const nodeChanges: WorkflowPatchDiff["nodeChanges"] = [];

  for (const [name, node] of afterNodes) {
    const previous = beforeNodes.get(name);
    if (!previous) {
      nodeChanges.push({ node: name, change: "added", afterParameters: node.parameters });
      continue;
    }
    if (!parameterEquals(previous.parameters, node.parameters)) {
      nodeChanges.push({
        node: name,
        change: "updated",
        beforeParameters: previous.parameters ?? {},
        afterParameters: node.parameters ?? {},
      });
    }
  }

  for (const [name, node] of beforeNodes) {
    if (!afterNodes.has(name)) {
      nodeChanges.push({ node: name, change: "removed", beforeParameters: node.parameters });
    }
  }

  const beforeConnections = new Map(
    outgoingConnections(before).map((connection) => [connectionKey(connection), connection]),
  );
  const afterConnections = new Map(
    outgoingConnections(after).map((connection) => [connectionKey(connection), connection]),
  );
  const connectionChanges: WorkflowPatchDiff["connectionChanges"] = [];

  for (const [key, connection] of afterConnections) {
    if (!beforeConnections.has(key)) connectionChanges.push({ change: "added", ...connection });
  }
  for (const [key, connection] of beforeConnections) {
    if (!afterConnections.has(key)) connectionChanges.push({ change: "removed", ...connection });
  }

  return {
    changed,
    before,
    after,
    summary: {
      addedNodes: nodeChanges.filter((change) => change.change === "added").length,
      removedNodes: nodeChanges.filter((change) => change.change === "removed").length,
      updatedNodes: nodeChanges.filter((change) => change.change === "updated").length,
      addedConnections: connectionChanges.filter((change) => change.change === "added").length,
      removedConnections: connectionChanges.filter((change) => change.change === "removed").length,
    },
    nodeChanges,
    connectionChanges,
  };
}

export function createWorkflowRollbackPatch(
  before: WorkflowShape,
  after: WorkflowShape,
): WorkflowPatch {
  const beforeNodes = new Map(before.nodes.map((node) => [node.name, node]));
  const afterNodes = new Map(after.nodes.map((node) => [node.name, node]));
  const operations: WorkflowPatchOperation[] = [];

  for (const [name, node] of beforeNodes) {
    const changedNode = afterNodes.get(name);
    if (changedNode && !parameterEquals(node.parameters, changedNode.parameters)) {
      operations.push({
        op: "replaceNodeParameters",
        node: name,
        parameters: (node.parameters ?? {}) as Record<string, unknown>,
      });
    }
  }

  const beforeConnections = new Map(
    outgoingConnections(before).map((connection) => [connectionKey(connection), connection]),
  );
  const afterConnections = new Map(
    outgoingConnections(after).map((connection) => [connectionKey(connection), connection]),
  );

  for (const [key, connection] of afterConnections) {
    if (!beforeConnections.has(key)) {
      operations.push({ op: "removeConnection", from: connection.from, to: connection.to });
    }
  }
  for (const [key, connection] of beforeConnections) {
    if (!afterConnections.has(key)) {
      operations.push({ op: "addConnection", from: connection.from, to: connection.to });
    }
  }

  return { operations };
}

export function createWorkflowReviewBatches(
  workflow: WorkflowShape,
  options: { batchSize?: number; overlap?: number } = {},
): WorkflowReviewBatch[] {
  const batchSize = Math.max(1, options.batchSize ?? 50);
  const overlap = Math.max(0, Math.min(options.overlap ?? 3, batchSize - 1));
  const orderedNodes = workflow.nodes.map((node) => node.name);
  const batches: WorkflowReviewBatch[] = [];
  let start = 0;

  while (start < orderedNodes.length) {
    const nodes = orderedNodes.slice(start, start + batchSize);
    const nodeSet = new Set(nodes);
    batches.push({
      index: batches.length + 1,
      nodeCount: nodes.length,
      startNode: nodes[0],
      endNode: nodes[nodes.length - 1],
      nodes,
      risks: findBrokenConnectionsInNodes(workflow, nodeSet).map(
        (connection) => `Broken connection from "${connection.from}" to "${connection.to}".`,
      ),
    });

    if (start + batchSize >= orderedNodes.length) break;
    start += batchSize - overlap;
  }

  return batches;
}

function flattenText(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") return [String(value)];
  if (Array.isArray(value)) return value.flatMap(flattenText);
  if (value && typeof value === "object") {
    return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => [
      key,
      ...flattenText(child),
    ]);
  }
  return [];
}

function nodeEvidenceText(node: WorkflowNodeShape): string {
  return [node.name, node.type, ...flattenText(node.parameters), ...flattenText(node.credentials)]
    .join(" ")
    .toLowerCase();
}

function includesAny(text: string, keywords: string[]): string | null {
  return keywords.find((keyword) => text.includes(keyword)) ?? null;
}

function inferNodeSystem(
  node: WorkflowNodeShape,
  text: string,
): { system: string; evidence: string[] } {
  const evidence: string[] = [];
  const nodeType = node.type.toLowerCase();

  if (nodeType.includes("googlesheets")) {
    return { system: "Google Sheets", evidence: ["Node type is Google Sheets"] };
  }
  if (nodeType.includes("slack")) {
    return { system: "Slack", evidence: ["Node type or name mentions Slack"] };
  }

  const checks: Array<{ system: string; keyword: string; label: string }> = [
    {
      system: "Amazon Ads",
      keyword: "advertising-api.amazon",
      label: "URL contains advertising-api.amazon",
    },
    { system: "Amazon Ads", keyword: "amazonads", label: "Credentials mention Amazon Ads" },
    { system: "Shopify", keyword: "shopify.com", label: "URL contains shopify.com" },
    { system: "Shopify", keyword: "shopify", label: 'Matched keyword "shopify"' },
    { system: "Google Sheets", keyword: "googlesheets", label: "Node type is Google Sheets" },
    { system: "Google Sheets", keyword: "google sheets", label: 'Matched keyword "google sheets"' },
    { system: "Google Sheets", keyword: "sheet", label: 'Matched keyword "sheet"' },
    { system: "Slack", keyword: "slack", label: "Node type or name mentions Slack" },
    { system: "HubSpot", keyword: "hubspot", label: 'Matched keyword "hubspot"' },
    { system: "Stripe", keyword: "stripe", label: 'Matched keyword "stripe"' },
  ];

  for (const check of checks) {
    if (text.includes(check.keyword)) {
      evidence.push(check.label);
      return { system: check.system, evidence };
    }
  }

  if (node.type.toLowerCase().includes("httprequest")) return { system: "HTTP API", evidence };
  return { system: "n8n", evidence };
}

function inferNodeDomain(text: string): {
  businessDomain: WorkflowBusinessDomain;
  entity: string;
  evidence: string[];
} {
  const evidence: string[] = [];
  const domainRules: Array<{
    domain: WorkflowBusinessDomain;
    entity: string;
    keywords: string[];
  }> = [
    {
      domain: "inventory",
      entity: "inventory",
      keywords: ["inventory", "stock", "sku", "line_items"],
    },
    {
      domain: "notifications",
      entity: "message",
      keywords: ["slack", "email", "alert", "message", "notification"],
    },
    {
      domain: "advertising",
      entity: "campaign_report",
      keywords: ["campaign", "ads", "advertising", "reporting/reports", "spend"],
    },
    { domain: "orders", entity: "order", keywords: ["orders", "order", "checkout"] },
    {
      domain: "crm",
      entity: "contact",
      keywords: ["hubspot", "salesforce", "contact", "lead", "deal"],
    },
    { domain: "finance", entity: "payment", keywords: ["stripe", "invoice", "payment", "revenue"] },
  ];

  for (const rule of domainRules) {
    const keyword = includesAny(text, rule.keywords);
    if (keyword) {
      evidence.push(`Matched keyword "${keyword}"`);
      return { businessDomain: rule.domain, entity: rule.entity, evidence };
    }
  }

  return { businessDomain: "unknown", entity: "data", evidence };
}

function inferNodeAction(
  node: WorkflowNodeShape,
  text: string,
): { action: string; evidence: string[] } {
  const evidence: string[] = [];
  const operation =
    typeof node.parameters?.operation === "string" ? node.parameters.operation.toLowerCase() : "";
  const method =
    typeof node.parameters?.method === "string" ? node.parameters.method.toLowerCase() : "";

  if (["post", "send", "sendmessage"].some((keyword) => operation.includes(keyword))) {
    evidence.push(`Operation is ${operation}`);
    return { action: "send", evidence };
  }
  if (["append", "update", "upsert"].some((keyword) => operation.includes(keyword))) {
    evidence.push(`Operation is ${operation}`);
    return { action: "update", evidence };
  }
  if (method === "post" && !text.includes("message")) {
    evidence.push("HTTP method is POST");
    return { action: "create", evidence };
  }
  if (method === "get" || text.includes("fetch") || text.includes("get ")) {
    if (method === "get") evidence.push("HTTP method is GET");
    return { action: "fetch", evidence };
  }
  if (text.includes("slack") || text.includes("alert")) return { action: "send", evidence };
  return { action: "process", evidence };
}

function confidenceFromEvidence(evidence: string[]): "high" | "medium" | "low" {
  if (evidence.length >= 2) return "high";
  if (evidence.length === 1) return "medium";
  return "low";
}

function primaryIntent(domains: WorkflowBusinessDomain[]): string {
  const domainSet = new Set(domains);
  if (domainSet.has("advertising") && (domainSet.has("orders") || domainSet.has("inventory"))) {
    return "Advertising performance and commerce operations reporting";
  }
  if (domainSet.has("orders") && domainSet.has("notifications"))
    return "Order notification automation";
  if (domainSet.has("inventory")) return "Inventory operations automation";
  if (domainSet.has("advertising")) return "Advertising performance reporting";
  if (domainSet.has("crm")) return "CRM workflow automation";
  return "General workflow automation";
}

function flowPurpose(fromDomain: WorkflowBusinessDomain, toDomain: WorkflowBusinessDomain): string {
  if (fromDomain === "orders" && toDomain === "advertising") {
    return "combines order data with advertising performance";
  }
  if (fromDomain === "advertising" && toDomain === "inventory") {
    return "updates inventory planning with advertising performance";
  }
  if (toDomain === "notifications") return `sends ${fromDomain} updates to notification channel`;
  if (fromDomain !== toDomain) return `passes ${fromDomain} data into ${toDomain} step`;
  return `continues ${fromDomain} processing`;
}

export function inferWorkflowBusinessIntent(workflow: WorkflowShape): WorkflowBusinessIntent {
  const expressionAudit = auditExpressionDependencies(workflow);
  const agentRules = auditN8nAgentRules(workflow);
  const expressionEvidenceByNode = new Map<string, string[]>();
  for (const dependency of expressionAudit.dependencies) {
    const evidence = expressionEvidenceByNode.get(dependency.fromNode) ?? [];
    evidence.push(`Expression references node "${dependency.toNode}"`);
    expressionEvidenceByNode.set(dependency.fromNode, evidence);
  }

  const nodeIntents = workflow.nodes.map((node) => {
    const text = nodeEvidenceText(node);
    const system = inferNodeSystem(node, text);
    const domain = inferNodeDomain(text);
    const action = inferNodeAction(node, text);
    const expressionEvidence = expressionEvidenceByNode.get(node.name) ?? [];
    const evidence = [
      ...system.evidence,
      ...domain.evidence,
      ...action.evidence,
      ...expressionEvidence,
    ];

    return {
      node: node.name,
      businessDomain: domain.businessDomain,
      system: system.system,
      entity: domain.entity,
      action: action.action,
      confidence: confidenceFromEvidence(evidence),
      evidence,
    };
  });

  const intentByNode = new Map(nodeIntents.map((intent) => [intent.node, intent]));
  const dataFlows = outgoingConnections(workflow)
    .filter((connection) => intentByNode.has(connection.from) && intentByNode.has(connection.to))
    .map((connection) => {
      const from = intentByNode.get(connection.from)!;
      const to = intentByNode.get(connection.to)!;
      return {
        from: connection.from,
        to: connection.to,
        fromDomain: from.businessDomain,
        toDomain: to.businessDomain,
        inferredPurpose: flowPurpose(from.businessDomain, to.businessDomain),
      };
    });

  const domainPriority: Exclude<WorkflowBusinessDomain, "unknown">[] = [
    "advertising",
    "orders",
    "inventory",
    "notifications",
    "crm",
    "finance",
    "data",
  ];
  const domainSet = new Set(
    nodeIntents
      .map((intent) => intent.businessDomain)
      .filter(
        (domain): domain is Exclude<WorkflowBusinessDomain, "unknown"> => domain !== "unknown",
      ),
  );
  const domains = domainPriority.filter((domain) => domainSet.has(domain));
  const systems = [
    ...new Set(nodeIntents.map((intent) => intent.system).filter((system) => system !== "n8n")),
  ].sort();
  const highConfidenceCount = nodeIntents.filter((intent) => intent.confidence === "high").length;

  return {
    summary: {
      primaryIntent: primaryIntent(domains),
      confidence: highConfidenceCount >= Math.ceil(nodeIntents.length / 2) ? "high" : "medium",
      domains,
      systems,
    },
    nodeIntents,
    dataFlows,
    agentRules,
  };
}

export function validateWorkflowPatch(
  workflow: WorkflowShape,
  patch: WorkflowPatch,
): WorkflowPatchValidationResult {
  const names = nodeNames(workflow);
  const errors: WorkflowPatchValidationError[] = [];

  patch.operations.forEach((operation, index) => {
    const path = `operations[${index}]`;
    switch (operation.op) {
      case "updateNodeParameters":
        if (!names.has(operation.node)) {
          errors.push({
            code: "PATCH_TARGET_NOT_FOUND",
            path: `${path}.node`,
            message: `Node "${operation.node}" does not exist.`,
          });
        }
        break;
      case "replaceNodeParameters":
        if (!names.has(operation.node)) {
          errors.push({
            code: "PATCH_TARGET_NOT_FOUND",
            path: `${path}.node`,
            message: `Node "${operation.node}" does not exist.`,
          });
        }
        break;
      case "addConnection":
        if (!names.has(operation.from)) {
          errors.push({
            code: "PATCH_SOURCE_NOT_FOUND",
            path: `${path}.from`,
            message: `Connection source "${operation.from}" does not exist.`,
          });
        }
        if (!names.has(operation.to)) {
          errors.push({
            code: "PATCH_CONNECTION_TARGET_NOT_FOUND",
            path: `${path}.to`,
            message: `Connection target "${operation.to}" does not exist.`,
          });
        }
        break;
      case "removeConnection":
        if (!names.has(operation.from)) {
          errors.push({
            code: "PATCH_SOURCE_NOT_FOUND",
            path: `${path}.from`,
            message: `Connection source "${operation.from}" does not exist.`,
          });
        }
        break;
      default:
        errors.push({
          code: "PATCH_INVALID_OPERATION",
          path,
          message: "Unsupported workflow patch operation.",
        });
    }
  });

  return { valid: errors.length === 0, errors };
}

function ensureConnectionSource(
  workflow: WorkflowShape,
  source: string,
): { main: WorkflowConnectionTarget[][] } {
  const existing = workflow.connections[source];
  if (existing?.main) return existing as { main: WorkflowConnectionTarget[][] };
  workflow.connections[source] = { ...(existing ?? {}), main: [[]] };
  return workflow.connections[source] as { main: WorkflowConnectionTarget[][] };
}

export function applyWorkflowPatch(
  workflow: WorkflowShape,
  patch: WorkflowPatch,
): { workflow: WorkflowShape; changed: boolean } {
  const validation = validateWorkflowPatch(workflow, patch);
  if (!validation.valid) {
    throw new Error(
      `Invalid workflow patch: ${validation.errors.map((e) => e.message).join("; ")}`,
    );
  }

  const next = cloneWorkflow(workflow);
  let changed = false;

  for (const operation of patch.operations) {
    switch (operation.op) {
      case "updateNodeParameters": {
        const node = next.nodes.find((candidate) => candidate.name === operation.node);
        if (!node) break;
        node.parameters = { ...(node.parameters ?? {}), ...operation.parameters };
        changed = true;
        break;
      }
      case "replaceNodeParameters": {
        const node = next.nodes.find((candidate) => candidate.name === operation.node);
        if (!node) break;
        node.parameters = { ...operation.parameters };
        changed = true;
        break;
      }
      case "removeConnection": {
        const source = next.connections[operation.from];
        if (!source?.main) break;
        source.main = source.main.map((output) =>
          output.filter((target) => target.node !== operation.to),
        );
        changed = true;
        break;
      }
      case "addConnection": {
        const source = ensureConnectionSource(next, operation.from);
        const outputIndex = operation.outputIndex ?? 0;
        while (source.main.length <= outputIndex) source.main.push([]);
        const output = source.main[outputIndex];
        if (!output.some((target) => target.node === operation.to)) {
          output.push({ node: operation.to, type: "main", index: 0 });
          changed = true;
        }
        break;
      }
    }
  }

  return { workflow: next, changed };
}
