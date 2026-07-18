import { beforeEach, describe, expect, it, vi } from "vitest";

const upstreamMocks = vi.hoisted(() => ({
  callUpstreamTool: vi.fn(async () => ({
    content: [] as Array<{ type: string; text: string }>,
  })),
  categorize: vi.fn(() => "knowledge"),
  isManagementTool: vi.fn(() => false),
  isUpstreamConfigured: vi.fn(() => false),
  listUpstreamTools: vi.fn(async () => []),
}));

const safeFetchPublicUrl = vi.hoisted(() => vi.fn());
const trustedPreviewMocks = vi.hoisted(() => ({
  loadTrustedWorkflowPreview: vi.fn(),
}));
const orchestratedServiceMocks = vi.hoisted(() => ({
  callTool: vi.fn(async (_name: string, _args: Record<string, unknown>, _context?: unknown) => ({
    success: true,
    workflow: { id: "draft-1" },
  })),
}));

vi.mock("../mcp-upstream.server", () => upstreamMocks);
vi.mock("../ssrf-guard.server", () => ({
  safeFetchPublicUrl: (...args: unknown[]) => safeFetchPublicUrl(...args),
}));
vi.mock("../workflow-agent/trusted-preview.server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../workflow-agent/trusted-preview.server")>()),
  loadTrustedWorkflowPreview: trustedPreviewMocks.loadTrustedWorkflowPreview,
}));
vi.mock("../orchestrated-tools.service", () => ({
  OrchestratedToolsService: class {
    callTool(name: string, args: Record<string, unknown>, context?: unknown) {
      return orchestratedServiceMocks.callTool(name, args, context);
    }
  },
}));

const INST = {
  id: "instance-1",
  name: "Primary",
  base_url: "https://n8n.example.com",
  api_key: "secret",
};

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    text: async () => JSON.stringify(body),
  } as unknown as Response;
}

describe("active MCP workflow agent tools", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    upstreamMocks.isUpstreamConfigured.mockReturnValue(false);
  });

  it("routes authoritative knowledge tools to their upstream implementations", async () => {
    upstreamMocks.isUpstreamConfigured.mockReturnValue(true);
    upstreamMocks.callUpstreamTool.mockResolvedValue({
      content: [{ type: "text", text: "authoritative result" }],
    });
    const { dispatchTool, getMergedTools, KNOWLEDGE_TOOL_MAP } = await import("../mcp.server");

    const tools = await getMergedTools();
    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["search_nodes", "get_node", "validate_node", "search_templates"]),
    );
    expect(KNOWLEDGE_TOOL_MAP).toEqual({
      search_nodes: "search_nodes",
      get_node: "get_node_essentials",
      search_templates: "search_templates",
      get_template: "get_workflow_template",
    });

    for (const [tool, upstreamTool] of Object.entries(KNOWLEDGE_TOOL_MAP)) {
      const args = tool.includes("template")
        ? tool === "get_template"
          ? { id: "template-1" }
          : { query: "slack" }
        : tool === "get_node"
          ? { nodeType: "n8n-nodes-base.webhook" }
          : { query: "webhook" };
      const result = await dispatchTool(tool, args, null, {
        user_id: "user-1",
        key_id: "key-1",
      });

      expect(result).toMatchObject({
        upstream: true,
        category: "knowledge",
        needsInstance: false,
      });
      expect(upstreamMocks.callUpstreamTool).toHaveBeenCalledWith(
        upstreamTool,
        args,
        null,
        expect.objectContaining({ user_id: "user-1" }),
      );
    }
  });

  it("fails closed when authoritative knowledge is not configured", async () => {
    const { dispatchTool } = await import("../mcp.server");

    await expect(
      dispatchTool("search_nodes", { query: "webhook" }, null, {
        user_id: "user-1",
        key_id: "key-1",
      }),
    ).rejects.toThrow(/upstream knowledge MCP is not configured/);

    expect(upstreamMocks.callUpstreamTool).not.toHaveBeenCalled();
  });

  it("validates credentialed nodes with the complete candidate configuration", async () => {
    const { dispatchTool } = await import("../mcp.server");

    const result = await dispatchTool(
      "validate_node",
      {
        nodeType: "n8n-nodes-base.emailSend",
        parameters: {
          toEmail: "ops@example.org",
          subject: "Alert",
          message: "Body",
        },
        credentials: {
          smtp: { id: "smtp-1", name: "Operations SMTP" },
        },
      },
      null,
      { user_id: "user-1", key_id: "key-1" },
    );

    expect(result.output).toMatchObject({ ok: true, canActivate: true });
  });

  it("previews workflow diffs in memory without patching n8n", async () => {
    const { dispatchTool } = await import("../mcp.server");

    safeFetchPublicUrl.mockResolvedValueOnce(
      jsonResponse({
        id: "wf-1",
        name: "Current",
        nodes: [
          {
            id: "webhook",
            name: "Webhook",
            type: "n8n-nodes-base.webhook",
            parameters: {
              path: "orders",
              httpMethod: "POST",
              responseMode: "onReceived",
            },
          },
        ],
        connections: {},
      }),
    );

    const result = await dispatchTool(
      "preview_workflow_diff",
      {
        workflowId: "wf-1",
        operations: [
          {
            type: "updateNode",
            nodeId: "webhook",
            changes: { parameters: { path: "orders-v2" } },
          },
        ],
      },
      INST,
      { user_id: "user-1", key_id: "key-1" },
    );

    expect(result.output).toMatchObject({
      success: true,
      workflowId: "wf-1",
      diff: { changedNodes: ["webhook"] },
      validation: { ok: true },
    });
    expect(safeFetchPublicUrl).toHaveBeenCalledTimes(1);
    expect((safeFetchPublicUrl.mock.calls[0][1] as RequestInit).method).toBeUndefined();
  });

  it("rejects malformed preview and partial-update contracts before n8n access", async () => {
    const { dispatchTool } = await import("../mcp.server");

    await expect(
      dispatchTool("preview_workflow_diff", { workflowId: " ", operations: [] }, INST, {
        user_id: "user-1",
        key_id: "key-1",
      }),
    ).rejects.toThrow(/workflowId/);

    await expect(
      dispatchTool(
        "update_partial_workflow",
        {
          workflowId: "wf-1",
          operations: [{ type: "cleanStaleConnections" }],
          sourcePreviewCallId: "preview-1",
          sourcePreviewOperationIndexes: ["0"],
        },
        INST,
        {
          user_id: "user-1",
          key_id: "key-1",
          confirmationVerified: true,
        },
      ),
    ).rejects.toThrow(/sourcePreviewOperationIndexes/);

    expect(trustedPreviewMocks.loadTrustedWorkflowPreview).not.toHaveBeenCalled();
    expect(safeFetchPublicUrl).not.toHaveBeenCalled();
  });

  it("rejects invalid orchestrated contracts before n8n access", async () => {
    const { dispatchTool } = await import("../mcp.server");
    const context = {
      user_id: "user-1",
      key_id: "key-1",
      confirmationVerified: true,
    };

    await expect(
      dispatchTool(
        "create_scheduled_workflow",
        {
          name: "Unsupported schedule",
          schedule: "0 9 * * *",
          action: "database_query",
          actionConfig: {},
        },
        INST,
        context,
      ),
    ).rejects.toThrow(/action/);
    await expect(
      dispatchTool(
        "create_webhook_workflow",
        {
          name: "Unsupported processing",
          processing: [{ action: "enrich", config: {} }],
        },
        INST,
        context,
      ),
    ).rejects.toThrow(/processing/);
    await expect(
      dispatchTool(
        "create_ai_chatbot_workflow",
        {
          name: "Unsupported chatbot",
          platform: "discord",
          aiProvider: "google",
          aiConfig: { model: "gpt-4.1" },
        },
        INST,
        context,
      ),
    ).rejects.toThrow(/interface/);
    await expect(
      dispatchTool(
        "create_email_workflow",
        {
          name: "Unsupported email",
          trigger: "database_change",
          emailTemplate: { to: "ops@example.org", subject: "Alert", body: "Body" },
        },
        INST,
        context,
      ),
    ).rejects.toThrow(/trigger/);
    await expect(
      dispatchTool("deploy_and_test_workflow", { workflowId: "wf-1" }, INST, context),
    ).rejects.toThrow(/testData/);

    expect(safeFetchPublicUrl).not.toHaveBeenCalled();
  });

  it("passes a schema-valid chatbot request to the service in canonical shape", async () => {
    const { runTool } = await import("../mcp.server");

    await runTool(
      INST,
      "create_ai_chatbot_workflow",
      {
        name: "Support Bot",
        interface: "webhook",
        aiProvider: "openai",
        aiConfig: {
          model: "gpt-4.1",
          credentialId: "openai-1",
          credentialName: "OpenAI Production",
        },
      },
      { user_id: "user-1" },
    );

    expect(orchestratedServiceMocks.callTool).toHaveBeenCalledWith(
      "create_ai_chatbot_workflow",
      {
        name: "Support Bot",
        interface: "webhook",
        aiProvider: "openai",
        aiConfig: {
          model: "gpt-4.1",
          credentialId: "openai-1",
          credentialName: "OpenAI Production",
        },
        interfaceConfig: {},
        features: {},
      },
      { user_id: "user-1" },
    );
  });

  it("rejects incomplete chatbot prerequisites before n8n access", async () => {
    const { dispatchTool } = await import("../mcp.server");
    const context = { user_id: "user-1", key_id: "key-1" };

    await expect(
      dispatchTool(
        "create_ai_chatbot_workflow",
        { name: "No model", interface: "webhook", aiProvider: "openai", aiConfig: {} },
        INST,
        context,
      ),
    ).rejects.toThrow(/model/);
    await expect(
      dispatchTool(
        "create_ai_chatbot_workflow",
        {
          name: "No OpenAI credential",
          interface: "webhook",
          aiProvider: "openai",
          aiConfig: { model: "gpt-4.1" },
        },
        INST,
        context,
      ),
    ).rejects.toThrow(/credential/);
    await expect(
      dispatchTool(
        "create_ai_chatbot_workflow",
        {
          name: "Incomplete handoff",
          interface: "webhook",
          aiProvider: "openai",
          aiConfig: {
            model: "gpt-4.1",
            credentialId: "openai-1",
            credentialName: "OpenAI Production",
          },
          features: { humanHandoff: true },
          interfaceConfig: { humanEmail: "support@example.org" },
        },
        INST,
        context,
      ),
    ).rejects.toThrow(/humanEmailCredentials/);

    expect(orchestratedServiceMocks.callTool).not.toHaveBeenCalled();
    expect(safeFetchPublicUrl).not.toHaveBeenCalled();
  });

  it("rejects Anthropic chatbot requests before service or n8n access", async () => {
    const { dispatchTool } = await import("../mcp.server");
    const context = { user_id: "user-1", key_id: "key-1" };

    for (const interfaceArgs of [{ interface: "webhook" }, { platform: "webhook" }]) {
      await expect(
        dispatchTool(
          "create_ai_chatbot_workflow",
          {
            name: "Unsupported Anthropic Bot",
            ...interfaceArgs,
            aiProvider: "anthropic",
            aiConfig: { model: "claude-4" },
          },
          INST,
          context,
        ),
      ).rejects.toThrow(/aiProvider/);
    }

    expect(orchestratedServiceMocks.callTool).not.toHaveBeenCalled();
    expect(safeFetchPublicUrl).not.toHaveBeenCalled();
  });

  it("passes an allowlisted SMTP handoff reference to the service", async () => {
    const { runTool } = await import("../mcp.server");

    await runTool(INST, "create_ai_chatbot_workflow", {
      name: "Handoff Bot",
      interface: "webhook",
      aiProvider: "openai",
      aiConfig: {
        model: "gpt-4.1",
        credentialId: "openai-1",
        credentialName: "OpenAI Production",
      },
      features: { humanHandoff: true },
      interfaceConfig: {
        humanEmail: "support@example.org",
        humanEmailCredentials: {
          smtp: { id: "smtp-1", name: "Support SMTP" },
        },
      },
    });

    expect(orchestratedServiceMocks.callTool).toHaveBeenCalledWith(
      "create_ai_chatbot_workflow",
      expect.objectContaining({
        interfaceConfig: {
          humanEmail: "support@example.org",
          humanEmailCredentials: {
            smtp: { id: "smtp-1", name: "Support SMTP" },
          },
        },
      }),
      undefined,
    );
  });

  it("rejects malformed canonical and legacy SMTP references before dispatch", async () => {
    const { dispatchTool } = await import("../mcp.server");
    const context = { user_id: "user-1", key_id: "key-1" };
    const base = {
      name: "Unsafe Handoff Bot",
      interface: "webhook",
      aiProvider: "openai",
      aiConfig: {
        model: "gpt-4.1",
        credentialId: "openai-1",
        credentialName: "OpenAI Production",
      },
      features: { humanHandoff: true },
    };

    await expect(
      dispatchTool(
        "create_ai_chatbot_workflow",
        {
          ...base,
          interfaceConfig: {
            humanEmail: "support@example.org",
            humanEmailCredentials: { password: "raw-secret" },
          },
        },
        INST,
        context,
      ),
    ).rejects.toThrow(/smtp/);
    await expect(
      dispatchTool(
        "create_ai_chatbot_workflow",
        {
          ...base,
          interfaceConfig: {
            humanEmail: "support@example.org",
            humanEmailCredentials: { smtp: { id: "", name: "" } },
          },
        },
        INST,
        context,
      ),
    ).rejects.toThrow(/smtp.*(id|name)/);
    await expect(
      dispatchTool(
        "create_ai_chatbot_workflow",
        {
          ...base,
          features: undefined,
          humanNotification: {
            method: "email",
            recipient: "support@example.org",
            credentials: { password: "legacy-secret" },
          },
        },
        INST,
        context,
      ),
    ).rejects.toThrow(/smtp/);

    expect(orchestratedServiceMocks.callTool).not.toHaveBeenCalled();
    expect(safeFetchPublicUrl).not.toHaveBeenCalled();
  });

  it("drops the removed repair alias before service dispatch", async () => {
    const { runTool } = await import("../mcp.server");

    await runTool(INST, "fix_workflow_errors", {
      workflowId: "wf-1",
      autoApply: true,
    });

    expect(orchestratedServiceMocks.callTool).toHaveBeenCalledWith(
      "fix_workflow_errors",
      {
        workflowId: "wf-1",
      },
      undefined,
    );
  });

  it("rejects partial updates without trusted preview evidence", async () => {
    const { dispatchTool } = await import("../mcp.server");

    await expect(
      dispatchTool(
        "update_partial_workflow",
        {
          workflowId: "wf-1",
          operations: [{ type: "cleanStaleConnections" }],
        },
        INST,
        {
          user_id: "user-1",
          key_id: "key-1",
          confirmationVerified: true,
        },
      ),
    ).rejects.toThrow(/sourcePreviewCallId/);

    expect(trustedPreviewMocks.loadTrustedWorkflowPreview).not.toHaveBeenCalled();
    expect(safeFetchPublicUrl).not.toHaveBeenCalled();
  });

  it("rejects partial updates when the preview cannot be loaded for the owner", async () => {
    trustedPreviewMocks.loadTrustedWorkflowPreview.mockResolvedValueOnce(null);
    const { dispatchTool } = await import("../mcp.server");

    await expect(
      dispatchTool(
        "update_partial_workflow",
        {
          workflowId: "wf-1",
          operations: [{ type: "cleanStaleConnections" }],
          sourcePreviewCallId: "preview-foreign",
        },
        INST,
        {
          user_id: "user-1",
          key_id: "key-1",
          confirmationVerified: true,
        },
      ),
    ).rejects.toThrow(/not found/);

    expect(trustedPreviewMocks.loadTrustedWorkflowPreview).toHaveBeenCalledWith(
      "user-1",
      "preview-foreign",
    );
    expect(safeFetchPublicUrl).not.toHaveBeenCalled();
  });

  it("rejects structural update_workflow payloads in favor of partial workflow updates", async () => {
    const { dispatchTool } = await import("../mcp.server");

    await expect(
      dispatchTool(
        "update_workflow",
        {
          id: "wf-1",
          nodes: [{ id: "manual", name: "Manual", type: "n8n-nodes-base.manualTrigger" }],
          connections: {},
          confirm: true,
        },
        INST,
        { user_id: "user-1", key_id: "key-1" },
      ),
    ).rejects.toThrow(/update_partial_workflow/);

    expect(safeFetchPublicUrl).not.toHaveBeenCalled();
  });
});
