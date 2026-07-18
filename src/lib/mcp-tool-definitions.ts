import { orchestratedTools } from "./orchestrated-tools";

type ToolAnnotations = {
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint?: boolean;
  openWorldHint: boolean;
  [key: string]: unknown;
};

type ToolDescriptor = {
  name: string;
  description?: string;
  inputSchema?: {
    type: string;
    required?: readonly string[];
    properties?: Record<string, unknown>;
    [key: string]: unknown;
  };
  annotations?: Record<string, unknown>;
};

const READ_ONLY_TOOLS = new Set([
  "list_workflows",
  "get_workflow",
  "list_executions",
  "validate_workflow",
  "search_nodes",
  "get_node",
  "validate_node",
  "search_templates",
  "get_template",
  "preview_workflow_diff",
  "analyze_workflow_graph",
  "preview_workflow_patch",
  "propose_workflow_patch",
  "propose_workflow_simplification",
  "preview_workflow_simplification",
  "summarize_workflow_modules",
  "summarize_workflow_semantic_modules",
  "infer_workflow_business_intent",
  "create_workflow_review_batches",
  "audit_expression_dependencies",
  "get_workflow_history",
  "get_audit_statistics",
  "detect_suspicious_activity",
]);

const DESTRUCTIVE_TOOLS = new Set([
  "delete_workflow",
  "apply_workflow_patch",
  "safe_apply_workflow_patch",
  "update_partial_workflow",
  "rollback_workflow",
  "deploy_and_test_workflow",
]);

const IDEMPOTENT_MUTATIONS = new Set([
  "safe_apply_workflow_simplification",
  "clone_workflow_as_draft",
]);

function standardAnnotations(tool: ToolDescriptor): ToolAnnotations {
  const readOnlyHint =
    READ_ONLY_TOOLS.has(tool.name) || Boolean(tool.annotations?.readOnly === true);
  return {
    ...tool.annotations,
    readOnlyHint,
    destructiveHint: DESTRUCTIVE_TOOLS.has(tool.name),
    idempotentHint: readOnlyHint || IDEMPOTENT_MUTATIONS.has(tool.name),
    openWorldHint: !["get_audit_statistics", "detect_suspicious_activity"].includes(tool.name),
  };
}

function withStandardAnnotations<T extends ToolDescriptor>(
  tools: readonly T[],
): Array<T & { annotations: ToolAnnotations }> {
  return tools.map((tool) => ({
    ...tool,
    annotations: standardAnnotations(tool),
  }));
}

const RAW_LOCAL_TOOLS = [
  {
    name: "list_workflows",
    description:
      "List workflows from the user's n8n instance. Returns workflow IDs, names, and active status.",
    inputSchema: {
      type: "object",
      properties: {
        active: { type: "boolean", description: "Filter by active state" },
        limit: { type: "number", default: 50, description: "Max number of workflows to return" },
      },
    },
  },
  {
    name: "get_workflow",
    description:
      "Get detailed information about a specific workflow including its nodes and connections.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "string", description: "Workflow ID" } },
    },
  },
  {
    name: "execute_workflow",
    description: "Trigger a workflow execution. Returns execution ID for tracking.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Workflow ID to execute" },
        data: { type: "object", description: "Optional input data passed to the workflow" },
        confirm: {
          type: "boolean",
          description: "Required: set to true to confirm this workflow execution.",
        },
      },
    },
  },
  {
    name: "list_executions",
    description:
      "List recent workflow executions with their status and timestamps. Use to check execution history or debug failed runs.",
    inputSchema: {
      type: "object",
      properties: {
        workflowId: { type: "string", description: "Optional: Filter by specific workflow ID" },
        limit: { type: "number", default: 20, description: "Max number of executions to return" },
      },
    },
  },
  {
    name: "import_workflow_template",
    description:
      "Import a workflow template into the user's n8n instance. Returns the created workflow ID. Use search_workflow_templates to find templates first.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "number", description: "Template id from search_workflow_templates" },
        name: { type: "string", description: "Optional: Override workflow name on import" },
        activate: {
          type: "boolean",
          default: false,
          description: "Activate the workflow after import",
        },
      },
    },
  },
  {
    name: "create_workflow",
    description:
      "Create a new workflow in the user's n8n instance. Returns the created workflow with ID.",
    inputSchema: {
      type: "object",
      required: ["name", "nodes", "connections"],
      properties: {
        name: { type: "string", description: "Workflow name" },
        nodes: { type: "array", description: "Array of workflow nodes" },
        connections: { type: "object", description: "Node connections object" },
        settings: { type: "object", description: "Optional workflow settings" },
        staticData: { type: "object", description: "Optional static data" },
        tags: { type: "array", description: "Optional workflow tags" },
      },
    },
  },
  {
    name: "update_workflow",
    description:
      "Update an existing workflow. Supports full or partial updates. Returns the updated workflow.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Workflow ID to update" },
        name: { type: "string", description: "Optional: New workflow name" },
        nodes: { type: "array", description: "Optional: Updated nodes array" },
        connections: { type: "object", description: "Optional: Updated connections" },
        settings: { type: "object", description: "Optional: Updated settings" },
        staticData: { type: "object", description: "Optional: Updated static data" },
        tags: { type: "array", description: "Optional: Updated tags" },
        active: { type: "boolean", description: "Optional: Activate or deactivate" },
        confirm: {
          type: "boolean",
          description: "Required: set to true to confirm this workflow-changing operation.",
        },
      },
    },
  },
  {
    name: "delete_workflow",
    description: "Delete a workflow from the user's n8n instance. This action cannot be undone.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Workflow ID to delete" },
        confirm: {
          type: "boolean",
          description: "Required with confirmationToken to confirm this irreversible operation.",
        },
        confirmationToken: {
          type: "string",
          description:
            "Short-lived token returned by the previous delete_workflow confirmation challenge.",
        },
      },
    },
  },
  {
    name: "activate_workflow",
    description:
      "Activate or deactivate a workflow. Active workflows can be triggered by their trigger nodes.",
    inputSchema: {
      type: "object",
      required: ["id", "active"],
      properties: {
        id: { type: "string", description: "Workflow ID" },
        active: {
          type: "boolean",
          description: "true to activate, false to deactivate",
        },
        confirm: {
          type: "boolean",
          description: "Required: set to true to confirm this activation state change.",
        },
      },
    },
  },
  {
    name: "validate_workflow",
    description:
      "Validate a workflow for errors, missing connections, and configuration issues. Returns detailed validation results.",
    inputSchema: {
      type: "object",
      required: ["workflow"],
      properties: {
        workflow: {
          type: "object",
          description: "Workflow object with nodes and connections to validate",
        },
      },
    },
  },
  {
    name: "search_nodes",
    description:
      "Search local n8n node knowledge before drafting or changing a workflow. Read-only.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Node type, display name, or capability to search" },
        limit: { type: "number", default: 20, description: "Max number of nodes to return" },
      },
    },
    annotations: { readOnly: true },
  },
  {
    name: "get_node",
    description:
      "Get local n8n node essentials, operations, and credential hints for a node type. Read-only.",
    inputSchema: {
      type: "object",
      required: ["nodeType"],
      properties: {
        nodeType: { type: "string", description: "n8n node type or short suffix" },
      },
    },
    annotations: { readOnly: true },
  },
  {
    name: "validate_node",
    description: "Validate one n8n node configuration before placing it in a workflow. Read-only.",
    inputSchema: {
      type: "object",
      required: ["nodeType"],
      properties: {
        nodeType: { type: "string", description: "n8n node type or short suffix" },
        parameters: { type: "object", description: "Node parameters to validate" },
        credentials: {
          type: "object",
          description: "Structured n8n credential references attached to the candidate node",
        },
      },
    },
    annotations: { readOnly: true },
  },
  {
    name: "search_templates",
    description:
      "Search local workflow templates before constructing a workflow from scratch. Read-only.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Workflow intent or template search query" },
        limit: { type: "number", default: 10, description: "Max number of templates to return" },
      },
    },
    annotations: { readOnly: true },
  },
  {
    name: "get_template",
    description: "Get a local workflow template by id. Read-only.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Template id from search_templates" },
      },
    },
    annotations: { readOnly: true },
  },
  {
    name: "preview_workflow_diff",
    description:
      "Preview partial workflow operations in memory, including validation and diff metadata. Does not mutate n8n.",
    inputSchema: {
      type: "object",
      required: ["workflowId", "operations"],
      properties: {
        workflowId: { type: "string", description: "Workflow ID to preview" },
        operations: {
          type: "array",
          description:
            "Operations such as updateNode, addNode, addConnection, removeConnection, cleanStaleConnections",
        },
        policy: { type: "object", description: "Optional operation policy context" },
      },
    },
    annotations: { readOnly: true },
  },
  {
    name: "update_partial_workflow",
    description:
      "Apply validated partial workflow operations after policy checks and diff preview. Prefer this over full workflow JSON updates.",
    inputSchema: {
      type: "object",
      required: ["workflowId", "operations", "sourcePreviewCallId"],
      properties: {
        workflowId: { type: "string", description: "Workflow ID to update" },
        operations: {
          type: "array",
          description:
            "Operations such as updateNode, addNode, addConnection, removeConnection, cleanStaleConnections",
        },
        sourcePreviewCallId: {
          type: "string",
          description:
            "Successful owner-scoped preview_workflow_diff call authorizing these operations",
        },
        sourcePreviewOperationIndexes: {
          type: "array",
          items: { type: "integer", minimum: 0 },
          description: "Optional subset of server-validated preview operation indexes to apply",
        },
        policy: { type: "object", description: "Optional operation policy context" },
        confirm: {
          type: "boolean",
          description: "Required by policy for active production workflows.",
        },
        confirmationToken: {
          type: "string",
          description:
            "Short-lived token returned by the previous update_partial_workflow confirmation challenge.",
        },
      },
    },
  },
  {
    name: "analyze_workflow_graph",
    description:
      "Analyze an existing workflow graph without modifying it. Use for large workflows before proposing changes.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Workflow ID to analyze" },
      },
    },
  },
  {
    name: "apply_workflow_patch",
    description:
      "Apply a validated local patch to an existing workflow. Prefer this over deleting and recreating large workflows.",
    inputSchema: {
      type: "object",
      required: ["id", "patch"],
      properties: {
        id: { type: "string", description: "Workflow ID to patch" },
        patch: {
          type: "object",
          required: ["operations"],
          properties: {
            operations: {
              type: "array",
              description:
                "Safe patch operations such as updateNodeParameters, addConnection, removeConnection.",
            },
          },
        },
        confirm: {
          type: "boolean",
          description: "Required with confirmationToken to confirm this workflow-changing patch.",
        },
        confirmationToken: {
          type: "string",
          description:
            "Short-lived token returned by the previous apply_workflow_patch confirmation challenge.",
        },
      },
    },
  },
  {
    name: "preview_workflow_patch",
    description:
      "Preview node and connection changes for a workflow patch without mutating n8n. Use before applying patches to large workflows.",
    inputSchema: {
      type: "object",
      required: ["id", "patch"],
      properties: {
        id: { type: "string", description: "Workflow ID to preview" },
        patch: {
          type: "object",
          required: ["operations"],
          properties: {
            operations: {
              type: "array",
              description: "Patch operations to preview.",
            },
          },
        },
      },
    },
  },
  {
    name: "safe_apply_workflow_patch",
    description:
      "Apply a workflow patch with post-apply validation and automatic rollback when validation fails.",
    inputSchema: {
      type: "object",
      required: ["id", "patch"],
      properties: {
        id: { type: "string", description: "Workflow ID to patch" },
        patch: {
          type: "object",
          required: ["operations"],
          properties: {
            operations: {
              type: "array",
              description: "Patch operations to apply safely.",
            },
          },
        },
        postApplyChecks: {
          type: "array",
          description: "Optional checks after applying. Currently supports expressionDependencies.",
        },
        confirm: {
          type: "boolean",
          description: "Required with confirmationToken to confirm this workflow-changing patch.",
        },
        confirmationToken: {
          type: "string",
          description:
            "Short-lived token returned by the previous safe_apply_workflow_patch confirmation challenge.",
        },
      },
    },
  },
  {
    name: "propose_workflow_patch",
    description:
      "Propose conservative patch operations for an existing workflow without modifying it. Only suggests low-risk mechanical fixes.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Workflow ID to inspect" },
      },
    },
  },
  {
    name: "propose_workflow_simplification",
    description:
      "Conservative Workflow Simplification: propose low-risk cleanup candidates without modifying the workflow. Only static-proof suggestions are returned; node removals are review candidates, not automatically applied.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: {
          type: "string",
          description: "Workflow ID to inspect for conservative simplification",
        },
      },
    },
  },
  {
    name: "preview_workflow_simplification",
    description:
      "Preview conservative workflow simplification for selected candidate nodes without mutating n8n. Rejects nodes that are not current approved simplification candidates.",
    inputSchema: {
      type: "object",
      required: ["id", "candidateNodeNames"],
      properties: {
        id: { type: "string", description: "Workflow ID to preview" },
        candidateNodeNames: {
          type: "array",
          items: { type: "string" },
          description: "Node names selected from propose_workflow_simplification.removableNodes",
        },
      },
    },
  },
  {
    name: "safe_apply_workflow_simplification",
    description:
      "Create a new inactive simplified draft from approved simplification candidates. This never mutates the source workflow.",
    inputSchema: {
      type: "object",
      required: ["id", "candidateNodeNames"],
      properties: {
        id: { type: "string", description: "Source workflow ID" },
        candidateNodeNames: {
          type: "array",
          items: { type: "string" },
          description: "Node names selected from propose_workflow_simplification.removableNodes",
        },
        name: { type: "string", description: "Optional name for the simplified draft workflow" },
      },
    },
  },
  {
    name: "clone_workflow_as_draft",
    description:
      "Clone an existing workflow into a new inactive draft for safe large-workflow edits and review.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Source workflow ID to clone" },
        name: { type: "string", description: "Optional draft workflow name" },
      },
    },
  },
  {
    name: "summarize_workflow_modules",
    description:
      "Summarize trigger-rooted modules in a large workflow without modifying it. Use before editing complex workflows.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Workflow ID to summarize" },
      },
    },
  },
  {
    name: "summarize_workflow_semantic_modules",
    description:
      "Summarize a large workflow into semantic modules such as ingress, transform, branch, notification, and external access.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Workflow ID to summarize" },
      },
    },
  },
  {
    name: "infer_workflow_business_intent",
    description:
      "Infer business intent for every node in a workflow from node names, URLs, operations, credentials, expressions, and data flow context.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Workflow ID to infer business intent for" },
      },
    },
  },
  {
    name: "create_workflow_review_batches",
    description:
      "Split a very large workflow into overlapping review batches so an agent can inspect it in safe chunks.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Workflow ID to batch" },
        batchSize: { type: "number", default: 50, description: "Nodes per review batch" },
        overlap: { type: "number", default: 3, description: "Node overlap between batches" },
      },
    },
  },
  {
    name: "audit_expression_dependencies",
    description:
      "Audit n8n expressions for $node dependencies and missing referenced nodes without modifying the workflow.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "string", description: "Workflow ID to audit" },
      },
    },
  },
  {
    name: "create_workflow_from_blueprint",
    description:
      "Create a workflow from a high-level blueprint (recommended). Automatically compiles to valid n8n JSON, validates, and creates. Much easier than create_workflow.",
    inputSchema: {
      type: "object",
      required: ["name", "trigger", "steps"],
      properties: {
        name: { type: "string", description: "Workflow name" },
        trigger: {
          type: "object",
          required: ["kind", "config"],
          properties: {
            kind: {
              type: "string",
              enum: ["schedule", "webhook", "manual"],
              description: "Trigger type",
            },
            config: {
              type: "object",
              description: "Trigger configuration (e.g., cron for schedule, path for webhook)",
            },
          },
        },
        steps: {
          type: "array",
          description: "Array of action steps",
          items: {
            type: "object",
            required: ["kind", "config"],
            properties: {
              kind: {
                type: "string",
                enum: [
                  "slack",
                  "http",
                  "email",
                  "googleSheets",
                  "openai",
                  "mcpClient",
                  "code",
                  "if",
                  "set",
                ],
                description: "Action node type",
              },
              action: {
                type: "string",
                description: "Optional: specific action (e.g., 'sendMessage' for Slack)",
              },
              config: { type: "object", description: "Node-specific configuration" },
            },
          },
        },
        activate: {
          type: "boolean",
          default: false,
          description:
            "Deployment intent for a later gated activation; creation itself remains inactive.",
        },
        requireCredentials: {
          type: "boolean",
          default: false,
          description:
            "If true, return missing credential requirements instead of creating credentialed workflows.",
        },
      },
    },
  },
  {
    name: "get_workflow_history",
    description:
      "Get the audit history for a workflow: who changed what and when, with before/after snapshots. Use the returned audit log id with rollback_workflow.",
    inputSchema: {
      type: "object",
      required: ["workflowId"],
      properties: {
        workflowId: { type: "string", description: "The workflow ID to get history for" },
        limit: {
          type: "number",
          default: 20,
          description: "Max number of history entries to return",
        },
      },
    },
  },
  {
    name: "rollback_workflow",
    description:
      "⚠️ MEDIUM RISK: Roll a workflow back to a previous state captured in its audit history. Restores the before-snapshot of the given audit log entry. Find the id with get_workflow_history.",
    inputSchema: {
      type: "object",
      required: ["auditLogId"],
      properties: {
        auditLogId: {
          type: "string",
          description: "Audit log id to roll back to (from get_workflow_history)",
        },
        reason: { type: "string", description: "Reason for the rollback (recommended)" },
        confirm: {
          type: "boolean",
          description: "Required with confirmationToken to confirm this rollback.",
        },
        confirmationToken: {
          type: "string",
          description:
            "Short-lived token returned by the previous rollback_workflow confirmation challenge.",
        },
      },
    },
  },
  {
    name: "get_audit_statistics",
    description:
      "Summarize workflow audit activity over time (counts by operation and by day). Useful for understanding usage patterns.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "number", default: 30, description: "Number of days to analyze" },
      },
    },
  },
  {
    name: "detect_suspicious_activity",
    description:
      "Analyze recent audit history for suspicious patterns such as bulk deletions or activity during unusual hours.",
    inputSchema: {
      type: "object",
      properties: {
        hours: { type: "number", default: 24, description: "Number of hours to analyze" },
      },
    },
  },
] as const;

export const LOCAL_TOOLS = withStandardAnnotations(RAW_LOCAL_TOOLS);

// Merge the basic local and higher-level orchestrated descriptors defensively.
// Source descriptors are expected to be unique, while the filter prevents an
// accidental duplicate from being advertised if that invariant regresses.
const LOCAL_TOOL_NAMES = new Set<string>(LOCAL_TOOLS.map((t) => t.name));
export const TOOLS = [
  ...LOCAL_TOOLS,
  ...withStandardAnnotations(orchestratedTools.filter((t) => !LOCAL_TOOL_NAMES.has(t.name))),
];
