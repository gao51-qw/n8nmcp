import { describe, expect, it } from "vitest";
import {
  analyzeWorkflowGraph,
  applyWorkflowPatch,
  auditExpressionDependencies,
  cloneWorkflowAsDraft,
  createPatchDiff,
  createWorkflowReviewBatches,
  createWorkflowRollbackPatch,
  inferWorkflowBusinessIntent,
  previewWorkflowSimplification,
  proposeWorkflowSimplification,
  proposeWorkflowPatch,
  simplifyWorkflowAsDraft,
  summarizeWorkflowSemanticModules,
  summarizeWorkflowModules,
  validateWorkflowPatch,
  type WorkflowPatch,
  type WorkflowShape,
} from "../workflow-graph";

const sampleWorkflow: WorkflowShape = {
  name: "Large workflow slice",
  nodes: [
    {
      id: "trigger",
      name: "Manual Trigger",
      type: "n8n-nodes-base.manualTrigger",
      typeVersion: 1,
      position: [250, 300],
      parameters: {},
    },
    {
      id: "http",
      name: "HTTP Request",
      type: "n8n-nodes-base.httpRequest",
      typeVersion: 4,
      position: [470, 300],
      parameters: { method: "GET", url: "https://api.example.com" },
    },
    {
      id: "slack",
      name: "Slack Alert",
      type: "n8n-nodes-base.slack",
      typeVersion: 2,
      position: [690, 300],
      parameters: { resource: "message", operation: "post", channel: "#ops" },
    },
    {
      id: "orphan",
      name: "Orphan Set",
      type: "n8n-nodes-base.set",
      typeVersion: 3,
      position: [690, 520],
      parameters: {},
    },
  ],
  connections: {
    "Manual Trigger": {
      main: [[{ node: "HTTP Request", type: "main", index: 0 }]],
    },
    "HTTP Request": {
      main: [[{ node: "Missing Node", type: "main", index: 0 }]],
    },
  },
  settings: { executionOrder: "v1" },
};

describe("workflow graph analyzer", () => {
  it("summarizes large workflow graph risks without rewriting the workflow", () => {
    const analysis = analyzeWorkflowGraph(sampleWorkflow);

    expect(analysis.summary).toMatchObject({
      nodeCount: 4,
      connectionCount: 2,
      triggerCount: 1,
      orphanCount: 2,
      brokenConnectionCount: 1,
    });
    expect(analysis.orphanNodes).toEqual(["Slack Alert", "Orphan Set"]);
    expect(analysis.brokenConnections).toEqual([
      {
        from: "HTTP Request",
        to: "Missing Node",
        path: "connections.HTTP Request.main[0][0].node",
      },
    ]);
    expect(analysis.modules).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          root: "Manual Trigger",
          nodes: ["Manual Trigger", "HTTP Request"],
        }),
      ]),
    );
  });

  it("validates patch operations before applying them", () => {
    const invalidPatch: WorkflowPatch = {
      operations: [
        {
          op: "updateNodeParameters",
          node: "Does Not Exist",
          parameters: { ok: true },
        },
      ],
    };

    const validation = validateWorkflowPatch(sampleWorkflow, invalidPatch);

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual([
      expect.objectContaining({
        code: "PATCH_TARGET_NOT_FOUND",
        path: "operations[0].node",
      }),
    ]);
  });

  it("applies safe local patches without replacing the entire workflow", () => {
    const patch: WorkflowPatch = {
      operations: [
        {
          op: "updateNodeParameters",
          node: "Slack Alert",
          parameters: { text: "Updated alert" },
        },
        {
          op: "removeConnection",
          from: "HTTP Request",
          to: "Missing Node",
        },
        {
          op: "addConnection",
          from: "HTTP Request",
          to: "Slack Alert",
        },
      ],
    };

    const result = applyWorkflowPatch(sampleWorkflow, patch);

    expect(result.changed).toBe(true);
    expect(result.workflow).not.toBe(sampleWorkflow);
    expect(result.workflow.nodes).toHaveLength(sampleWorkflow.nodes.length);
    expect(result.workflow.nodes.find((node) => node.name === "Slack Alert")?.parameters).toEqual({
      resource: "message",
      operation: "post",
      channel: "#ops",
      text: "Updated alert",
    });
    expect(result.workflow.connections["HTTP Request"]).toEqual({
      main: [[{ node: "Slack Alert", type: "main", index: 0 }]],
    });
  });

  it("proposes only low-risk mechanical patch operations", () => {
    const proposal = proposeWorkflowPatch(sampleWorkflow);

    expect(proposal).toEqual({
      patch: {
        operations: [{ op: "removeConnection", from: "HTTP Request", to: "Missing Node" }],
      },
      confidence: "high",
      rationale: ['Remove broken connection from "HTTP Request" to missing node "Missing Node".'],
      skipped: expect.arrayContaining([
        expect.objectContaining({
          reason: "Orphan nodes require semantic review before reconnecting.",
          nodes: ["Slack Alert", "Orphan Set"],
        }),
      ]),
    });
  });

  it("proposes conservative workflow simplification without deleting referenced or side-effect nodes", () => {
    const workflow: WorkflowShape = {
      name: "Simplification candidate",
      nodes: [
        { name: "Manual Trigger", type: "n8n-nodes-base.manualTrigger", parameters: {} },
        { name: "Fetch Orders", type: "n8n-nodes-base.httpRequest", parameters: { method: "GET" } },
        {
          name: "Slack Alert",
          type: "n8n-nodes-base.slack",
          parameters: { text: "={{ $('Unused Set').item.json.message }}" },
        },
        { name: "Unused Set", type: "n8n-nodes-base.set", parameters: { values: {} } },
        { name: "Dead Set", type: "n8n-nodes-base.set", parameters: { values: {} } },
        {
          name: "Dead HTTP Post",
          type: "n8n-nodes-base.httpRequest",
          parameters: { method: "POST", url: "https://api.example.com/update" },
        },
      ],
      connections: {
        "Manual Trigger": { main: [[{ node: "Fetch Orders", type: "main", index: 0 }]] },
        "Fetch Orders": {
          main: [
            [
              { node: "Slack Alert", type: "main", index: 0 },
              { node: "Missing Node", type: "main", index: 0 },
            ],
          ],
        },
      },
    };

    const proposal = proposeWorkflowSimplification(workflow);

    expect(proposal).toEqual({
      mode: "conservative",
      confidence: "high",
      safePatch: {
        operations: [{ op: "removeConnection", from: "Fetch Orders", to: "Missing Node" }],
      },
      removableNodes: [
        {
          node: "Dead Set",
          action: "removeNode",
          confidence: "high",
          reason:
            "Node is unreachable from all triggers, has no incoming/outgoing connections, is not referenced by expressions, and has no detected external side effects.",
          safetyChecks: {
            reachableFromTrigger: false,
            referencedByExpression: false,
            hasExternalSideEffect: false,
            hasConnections: false,
          },
        },
      ],
      skippedNodes: expect.arrayContaining([
        expect.objectContaining({
          node: "Unused Set",
          reason: "Node is referenced by an expression.",
        }),
        expect.objectContaining({
          node: "Dead HTTP Post",
          reason: "Node may have external side effects.",
        }),
      ]),
      warnings: [
        "Node removal is proposed only as a review candidate; apply it through a dedicated simplification workflow after cloning or previewing a draft.",
      ],
    });
  });

  it("previews and creates a simplified draft only from current safe candidates", () => {
    const workflow: WorkflowShape = {
      id: "source-id",
      name: "Simplification source",
      nodes: [
        { name: "Manual Trigger", type: "n8n-nodes-base.manualTrigger", parameters: {} },
        { name: "Fetch Orders", type: "n8n-nodes-base.httpRequest", parameters: { method: "GET" } },
        { name: "Slack Alert", type: "n8n-nodes-base.slack", parameters: { text: "Done" } },
        { name: "Dead Set", type: "n8n-nodes-base.set", parameters: { values: {} } },
      ],
      connections: {
        "Manual Trigger": { main: [[{ node: "Fetch Orders", type: "main", index: 0 }]] },
        "Fetch Orders": {
          main: [
            [
              { node: "Slack Alert", type: "main", index: 0 },
              { node: "Missing Node", type: "main", index: 0 },
            ],
          ],
        },
      },
    };

    const preview = previewWorkflowSimplification(workflow, ["Dead Set", "Slack Alert"]);
    const draft = simplifyWorkflowAsDraft(workflow, ["Dead Set"], "Simplified draft");

    expect(preview).toEqual({
      valid: false,
      requestedNodes: ["Dead Set", "Slack Alert"],
      approvedNodes: ["Dead Set"],
      rejectedNodes: [
        {
          node: "Slack Alert",
          reason: "Requested node is not an approved conservative simplification candidate.",
        },
      ],
      nodeCountBefore: 4,
      nodeCountAfter: 3,
      removedNodeCount: 1,
      safePatch: {
        operations: [{ op: "removeConnection", from: "Fetch Orders", to: "Missing Node" }],
      },
      warnings: [
        "Simplification preview does not mutate the source workflow.",
        "Rejected nodes must not be removed automatically.",
      ],
    });
    expect(draft).toMatchObject({
      name: "Simplified draft",
      active: false,
      nodes: [{ name: "Manual Trigger" }, { name: "Fetch Orders" }, { name: "Slack Alert" }],
      connections: {
        "Manual Trigger": { main: [[{ node: "Fetch Orders", type: "main", index: 0 }]] },
        "Fetch Orders": { main: [[{ node: "Slack Alert", type: "main", index: 0 }]] },
      },
    });
    expect(draft.id).toBeUndefined();
  });

  it("summarizes workflow modules with local risk signals", () => {
    const summaries = summarizeWorkflowModules(sampleWorkflow);

    expect(summaries).toEqual([
      {
        root: "Manual Trigger",
        nodeCount: 2,
        nodes: ["Manual Trigger", "HTTP Request"],
        terminalNodes: [],
        nodeTypes: ["n8n-nodes-base.manualTrigger", "n8n-nodes-base.httpRequest"],
        brokenConnections: [
          {
            from: "HTTP Request",
            to: "Missing Node",
            path: "connections.HTTP Request.main[0][0].node",
          },
        ],
      },
    ]);
  });

  it("audits n8n expression dependencies and reports missing referenced nodes", () => {
    const workflow: WorkflowShape = {
      ...sampleWorkflow,
      nodes: sampleWorkflow.nodes.map((node) =>
        node.name === "Slack Alert"
          ? {
              ...node,
              parameters: {
                text: "={{ $node[\"HTTP Request\"].json.total }} / {{ $node['Missing Node'].json.id }}",
              },
            }
          : node,
      ),
    };

    const audit = auditExpressionDependencies(workflow);

    expect(audit).toEqual({
      dependencyCount: 2,
      missingCount: 1,
      dependencies: [
        {
          fromNode: "Slack Alert",
          toNode: "HTTP Request",
          path: "nodes[2].parameters.text",
          expression: expect.stringContaining('$node["HTTP Request"]'),
          exists: true,
        },
        {
          fromNode: "Slack Alert",
          toNode: "Missing Node",
          path: "nodes[2].parameters.text",
          expression: expect.stringContaining("$node['Missing Node']"),
          exists: false,
        },
      ],
      missingReferences: [
        {
          fromNode: "Slack Alert",
          toNode: "Missing Node",
          path: "nodes[2].parameters.text",
        },
      ],
      warningCount: 0,
      syntaxWarnings: [],
    });
  });

  it("audits common n8n expression dependency syntaxes", () => {
    const workflow: WorkflowShape = {
      ...sampleWorkflow,
      nodes: sampleWorkflow.nodes.map((node) =>
        node.name === "Slack Alert"
          ? {
              ...node,
              parameters: {
                a: '={{ $("HTTP Request").item.json.total }}',
                b: "={{ $items('Manual Trigger')[0].json.id }}",
                c: "={{ $('Missing Node').first().json.id }}",
              },
            }
          : node,
      ),
    };

    const audit = auditExpressionDependencies(workflow);

    expect(audit.dependencies.map((dependency) => dependency.toNode)).toEqual([
      "HTTP Request",
      "Manual Trigger",
      "Missing Node",
    ]);
    expect(audit.missingReferences).toEqual([
      {
        fromNode: "Slack Alert",
        toNode: "Missing Node",
        path: "nodes[2].parameters.c",
      },
    ]);
  });

  it("adds n8n-skills inspired warnings for risky expressions and code nodes", () => {
    const workflow: WorkflowShape = {
      name: "Expression and code gotchas",
      nodes: [
        {
          name: "Webhook",
          type: "n8n-nodes-base.webhook",
          parameters: {},
        },
        {
          name: "Slack Alert",
          type: "n8n-nodes-base.slack",
          parameters: {
            text: "$json.email",
            fallback: "{{{$json.body.name}}}",
          },
        },
        {
          name: "Transform Code",
          type: "n8n-nodes-base.code",
          parameters: {
            jsCode: "const email = '{{$json.email}}';\nreturn { email };",
          },
        },
      ],
      connections: {
        Webhook: { main: [[{ node: "Slack Alert", type: "main", index: 0 }]] },
        "Slack Alert": { main: [[{ node: "Transform Code", type: "main", index: 0 }]] },
      },
    };

    const audit = auditExpressionDependencies(workflow);

    expect(audit.syntaxWarnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "EXPRESSION_MISSING_BRACES",
        "EXPRESSION_NESTED_BRACES",
        "CODE_NODE_USES_EXPRESSIONS",
        "CODE_NODE_SUSPICIOUS_RETURN",
      ]),
    );
  });

  it("detects operation-aware node configuration and Python Code node gotchas", () => {
    const workflow: WorkflowShape = {
      name: "Node config gotchas",
      nodes: [
        {
          name: "Create API Record",
          type: "n8n-nodes-base.httpRequest",
          parameters: {
            method: "POST",
            url: "https://api.example.com/records",
          },
        },
        {
          name: "Bad Python",
          type: "n8n-nodes-base.code",
          parameters: {
            language: "python",
            pythonCode: "import pandas as pd\nreturn [{'json': {'ok': True}}]",
          },
        },
        {
          name: "Formula Sheet Append",
          type: "n8n-nodes-base.googleSheets",
          parameters: {
            operation: "append",
            sheetName: "inventory report with formula columns",
          },
        },
      ],
      connections: {},
    };

    const intent = inferWorkflowBusinessIntent(workflow);

    expect(intent.agentRules.warnings.map((warning) => warning.code)).toEqual(
      expect.arrayContaining([
        "HTTP_BODY_MISSING_FOR_WRITE_METHOD",
        "PYTHON_EXTERNAL_IMPORT",
        "GOOGLE_SHEETS_APPEND_FORMULA_RISK",
      ]),
    );
  });

  it("groups workflow nodes into semantic modules by branch and node role", () => {
    const workflow: WorkflowShape = {
      name: "Semantic workflow",
      nodes: [
        { name: "Webhook", type: "n8n-nodes-base.webhook", parameters: {} },
        { name: "Normalize Payload", type: "n8n-nodes-base.set", parameters: {} },
        { name: "Fetch Account", type: "n8n-nodes-base.httpRequest", parameters: {} },
        { name: "IF Active", type: "n8n-nodes-base.if", parameters: {} },
        { name: "Slack Alert", type: "n8n-nodes-base.slack", parameters: {} },
        { name: "Email Owner", type: "n8n-nodes-base.emailSend", parameters: {} },
      ],
      connections: {
        Webhook: { main: [[{ node: "Normalize Payload", type: "main", index: 0 }]] },
        "Normalize Payload": { main: [[{ node: "Fetch Account", type: "main", index: 0 }]] },
        "Fetch Account": { main: [[{ node: "IF Active", type: "main", index: 0 }]] },
        "IF Active": {
          main: [
            [{ node: "Slack Alert", type: "main", index: 0 }],
            [{ node: "Email Owner", type: "main", index: 0 }],
          ],
        },
      },
    };

    const modules = summarizeWorkflowSemanticModules(workflow);

    expect(modules).toEqual([
      {
        id: "module-1",
        label: "Ingress and preparation",
        root: "Webhook",
        role: "ingress",
        nodeCount: 4,
        nodes: ["Webhook", "Normalize Payload", "Fetch Account", "IF Active"],
        entryNodes: ["Webhook"],
        exitNodes: ["Slack Alert", "Email Owner"],
        nodeTypes: [
          "n8n-nodes-base.webhook",
          "n8n-nodes-base.set",
          "n8n-nodes-base.httpRequest",
          "n8n-nodes-base.if",
        ],
        risks: [],
      },
      {
        id: "module-2",
        label: "Slack branch",
        root: "Slack Alert",
        role: "notification",
        nodeCount: 1,
        nodes: ["Slack Alert"],
        entryNodes: ["Slack Alert"],
        exitNodes: [],
        nodeTypes: ["n8n-nodes-base.slack"],
        risks: [],
      },
      {
        id: "module-3",
        label: "Email branch",
        root: "Email Owner",
        role: "notification",
        nodeCount: 1,
        nodes: ["Email Owner"],
        entryNodes: ["Email Owner"],
        exitNodes: [],
        nodeTypes: ["n8n-nodes-base.emailSend"],
        risks: [],
      },
    ]);
  });

  it("infers business intent from node names, URLs, operations, credentials, and expressions", () => {
    const workflow: WorkflowShape = {
      name: "Amazon Ads order and inventory daily report",
      nodes: [
        {
          name: "Fetch Shopify Orders",
          type: "n8n-nodes-base.httpRequest",
          parameters: {
            method: "GET",
            url: "https://my-shop.myshopify.com/admin/api/2024-10/orders.json",
          },
        },
        {
          name: "Get Amazon Ads Campaign Report",
          type: "n8n-nodes-base.httpRequest",
          parameters: {
            url: "https://advertising-api.amazon.com/reporting/reports",
            authentication: "predefinedCredentialType",
          },
          credentials: { amazonAdsOAuth2Api: { id: "cred-1", name: "Amazon Ads" } },
        },
        {
          name: "Update Inventory Sheet",
          type: "n8n-nodes-base.googleSheets",
          parameters: {
            operation: "append",
            documentId: "inventory-sheet",
            values: "={{ $('Fetch Shopify Orders').item.json.line_items }}",
          },
        },
        {
          name: "Slack Daily Revenue Alert",
          type: "n8n-nodes-base.slack",
          parameters: {
            resource: "message",
            operation: "post",
            text: "={{ $('Get Amazon Ads Campaign Report').item.json.spend }}",
          },
        },
      ],
      connections: {
        "Fetch Shopify Orders": {
          main: [[{ node: "Get Amazon Ads Campaign Report", type: "main", index: 0 }]],
        },
        "Get Amazon Ads Campaign Report": {
          main: [[{ node: "Update Inventory Sheet", type: "main", index: 0 }]],
        },
        "Update Inventory Sheet": {
          main: [[{ node: "Slack Daily Revenue Alert", type: "main", index: 0 }]],
        },
      },
    };

    const intent = inferWorkflowBusinessIntent(workflow);

    expect(intent.summary).toEqual({
      primaryIntent: "Advertising performance and commerce operations reporting",
      confidence: "high",
      domains: ["advertising", "orders", "inventory", "notifications"],
      systems: ["Amazon Ads", "Google Sheets", "Shopify", "Slack"],
    });
    expect(intent.nodeIntents).toEqual([
      expect.objectContaining({
        node: "Fetch Shopify Orders",
        businessDomain: "orders",
        system: "Shopify",
        entity: "order",
        action: "fetch",
        confidence: "high",
        evidence: expect.arrayContaining(["URL contains shopify.com", 'Matched keyword "orders"']),
      }),
      expect.objectContaining({
        node: "Get Amazon Ads Campaign Report",
        businessDomain: "advertising",
        system: "Amazon Ads",
        entity: "campaign_report",
        action: "fetch",
        confidence: "high",
      }),
      expect.objectContaining({
        node: "Update Inventory Sheet",
        businessDomain: "inventory",
        system: "Google Sheets",
        entity: "inventory",
        action: "update",
        confidence: "high",
      }),
      expect.objectContaining({
        node: "Slack Daily Revenue Alert",
        businessDomain: "notifications",
        system: "Slack",
        entity: "message",
        action: "send",
        confidence: "high",
      }),
    ]);
    expect(intent.dataFlows).toEqual([
      {
        from: "Fetch Shopify Orders",
        to: "Get Amazon Ads Campaign Report",
        fromDomain: "orders",
        toDomain: "advertising",
        inferredPurpose: "combines order data with advertising performance",
      },
      {
        from: "Get Amazon Ads Campaign Report",
        to: "Update Inventory Sheet",
        fromDomain: "advertising",
        toDomain: "inventory",
        inferredPurpose: "updates inventory planning with advertising performance",
      },
      {
        from: "Update Inventory Sheet",
        to: "Slack Daily Revenue Alert",
        fromDomain: "inventory",
        toDomain: "notifications",
        inferredPurpose: "sends inventory updates to notification channel",
      },
    ]);
  });

  it("creates a patch diff preview and rollback patch", () => {
    const patch: WorkflowPatch = {
      operations: [
        { op: "updateNodeParameters", node: "Slack Alert", parameters: { text: "Updated" } },
        { op: "addConnection", from: "HTTP Request", to: "Slack Alert" },
        { op: "removeConnection", from: "HTTP Request", to: "Missing Node" },
      ],
    };

    const diff = createPatchDiff(sampleWorkflow, patch);
    const rollback = createWorkflowRollbackPatch(sampleWorkflow, diff.after);

    expect(diff).toMatchObject({
      changed: true,
      summary: {
        addedNodes: 0,
        removedNodes: 0,
        updatedNodes: 1,
        addedConnections: 1,
        removedConnections: 1,
      },
      nodeChanges: [
        {
          node: "Slack Alert",
          change: "updated",
          beforeParameters: { resource: "message", operation: "post", channel: "#ops" },
          afterParameters: {
            resource: "message",
            operation: "post",
            channel: "#ops",
            text: "Updated",
          },
        },
      ],
      connectionChanges: expect.arrayContaining([
        { change: "added", from: "HTTP Request", to: "Slack Alert" },
        { change: "removed", from: "HTTP Request", to: "Missing Node" },
      ]),
    });
    expect(rollback.operations).toEqual([
      {
        op: "replaceNodeParameters",
        node: "Slack Alert",
        parameters: { resource: "message", operation: "post", channel: "#ops" },
      },
      { op: "removeConnection", from: "HTTP Request", to: "Slack Alert" },
      { op: "addConnection", from: "HTTP Request", to: "Missing Node" },
    ]);
  });

  it("creates review batches for workflows that are too large for one pass", () => {
    const workflow: WorkflowShape = {
      name: "Huge workflow",
      nodes: Array.from({ length: 105 }, (_, index) => ({
        name: `Node ${index + 1}`,
        type: index === 0 ? "n8n-nodes-base.manualTrigger" : "n8n-nodes-base.set",
        parameters: {},
      })),
      connections: Object.fromEntries(
        Array.from({ length: 104 }, (_, index) => [
          `Node ${index + 1}`,
          { main: [[{ node: `Node ${index + 2}`, type: "main", index: 0 }]] },
        ]),
      ),
    };

    const batches = createWorkflowReviewBatches(workflow, { batchSize: 40, overlap: 2 });

    expect(batches).toHaveLength(3);
    expect(batches[0]).toMatchObject({
      index: 1,
      nodeCount: 40,
      startNode: "Node 1",
      endNode: "Node 40",
    });
    expect(batches[1].nodes.slice(0, 2)).toEqual(["Node 39", "Node 40"]);
    expect(batches[2]).toMatchObject({
      index: 3,
      nodeCount: 29,
      startNode: "Node 77",
      endNode: "Node 105",
    });
  });

  it("clones a workflow as an inactive draft without carrying over identity fields", () => {
    const draft = cloneWorkflowAsDraft(
      {
        ...sampleWorkflow,
        id: "source-id",
        active: true,
        versionId: "source-version",
      },
      "Draft review copy",
    );

    expect(draft).toMatchObject({
      name: "Draft review copy",
      nodes: sampleWorkflow.nodes,
      connections: sampleWorkflow.connections,
      settings: sampleWorkflow.settings,
      active: false,
    });
    expect(draft.id).toBeUndefined();
    expect(draft.versionId).toBeUndefined();
    expect(draft).not.toBe(sampleWorkflow);
  });
});
