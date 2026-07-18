import { assertValidNodeRegistry } from "./node-registry-validation";

export type NodeKind =
  | "schedule"
  | "webhook"
  | "manual"
  | "slack"
  | "http"
  | "email"
  | "googleSheets"
  | "openai"
  | "mcpClient"
  | "code"
  | "if"
  | "set";

export type TriggerNodeKind = Extract<NodeKind, "schedule" | "webhook" | "manual">;
export type ActionNodeKind = Exclude<NodeKind, TriggerNodeKind>;

export type NodeActionTemplate = {
  label?: string;
  resource?: string;
  operation?: string;
  params?: Record<string, unknown>;
  requiredParams?: string[];
};

export type NodeTemplate = {
  kind: NodeKind;
  label: string;
  n8nType: string;
  defaultTypeVersion: number;
  officialName?: string;
  packageName?: "n8n-nodes-base" | "@n8n/n8n-nodes-langchain";
  credentialType?: string;
  requiredParams?: string[];
  actions?: Record<string, NodeActionTemplate>;
};

export const NODE_REGISTRY: Record<NodeKind, NodeTemplate> = {
  schedule: {
    kind: "schedule",
    label: "Schedule Trigger",
    n8nType: "n8n-nodes-base.scheduleTrigger",
    officialName: "scheduleTrigger",
    packageName: "n8n-nodes-base",
    defaultTypeVersion: 1.3,
    requiredParams: ["rule"],
  },
  webhook: {
    kind: "webhook",
    label: "Webhook Trigger",
    n8nType: "n8n-nodes-base.webhook",
    officialName: "webhook",
    packageName: "n8n-nodes-base",
    defaultTypeVersion: 2.1,
    requiredParams: ["path"],
  },
  manual: {
    kind: "manual",
    label: "Manual Trigger",
    n8nType: "n8n-nodes-base.manualTrigger",
    officialName: "manualTrigger",
    packageName: "n8n-nodes-base",
    defaultTypeVersion: 1,
  },
  slack: {
    kind: "slack",
    label: "Slack",
    n8nType: "n8n-nodes-base.slack",
    officialName: "slack",
    packageName: "n8n-nodes-base",
    defaultTypeVersion: 2.5,
    credentialType: "slackApi",
    actions: {
      sendMessage: {
        label: "Send Message",
        resource: "message",
        operation: "post",
        requiredParams: ["channel", "text"],
      },
    },
  },
  http: {
    kind: "http",
    label: "HTTP Request",
    n8nType: "n8n-nodes-base.httpRequest",
    officialName: "httpRequest",
    packageName: "n8n-nodes-base",
    defaultTypeVersion: 4.4,
    requiredParams: ["url"],
    actions: {
      get: { params: { method: "GET" } },
      post: { params: { method: "POST" } },
    },
  },
  email: {
    kind: "email",
    label: "Email",
    n8nType: "n8n-nodes-base.emailSend",
    officialName: "emailSend",
    packageName: "n8n-nodes-base",
    defaultTypeVersion: 2,
    credentialType: "smtp",
    requiredParams: ["toEmail", "subject"],
  },
  googleSheets: {
    kind: "googleSheets",
    label: "Google Sheets",
    n8nType: "n8n-nodes-base.googleSheets",
    officialName: "googleSheets",
    packageName: "n8n-nodes-base",
    defaultTypeVersion: 4.7,
    credentialType: "googleSheetsOAuth2Api",
    requiredParams: ["spreadsheetId"],
  },
  openai: {
    kind: "openai",
    label: "OpenAI",
    n8nType: "@n8n/n8n-nodes-langchain.openAi",
    officialName: "openAi",
    packageName: "@n8n/n8n-nodes-langchain",
    defaultTypeVersion: 1,
    credentialType: "openAiApi",
  },
  mcpClient: {
    kind: "mcpClient",
    label: "MCP Client",
    n8nType: "@n8n/n8n-nodes-langchain.mcpClient",
    officialName: "mcpClient",
    packageName: "@n8n/n8n-nodes-langchain",
    defaultTypeVersion: 1.1,
    requiredParams: ["endpointUrl", "tool"],
    actions: {
      callTool: {
        label: "Call Tool",
        params: {
          serverTransport: "httpStreamable",
          authentication: "none",
          inputMode: "json",
        },
        requiredParams: ["endpointUrl", "tool"],
      },
    },
  },
  code: {
    kind: "code",
    label: "Code",
    n8nType: "n8n-nodes-base.code",
    officialName: "code",
    packageName: "n8n-nodes-base",
    defaultTypeVersion: 2,
    requiredParams: ["jsCode"],
  },
  if: {
    kind: "if",
    label: "IF",
    n8nType: "n8n-nodes-base.if",
    officialName: "if",
    packageName: "n8n-nodes-base",
    defaultTypeVersion: 2,
  },
  set: {
    kind: "set",
    label: "Set",
    n8nType: "n8n-nodes-base.set",
    officialName: "set",
    packageName: "n8n-nodes-base",
    defaultTypeVersion: 3,
  },
};

export function isNodeKind(value: unknown): value is NodeKind {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(NODE_REGISTRY, value);
}

export function isTriggerNodeKind(value: unknown): value is TriggerNodeKind {
  return value === "schedule" || value === "webhook" || value === "manual";
}

export function getNodeTemplate(kind: NodeKind): NodeTemplate {
  const template = NODE_REGISTRY[kind];
  if (!template) {
    throw new Error(`Unsupported node kind "${String(kind)}".`);
  }
  return template;
}

assertValidNodeRegistry(NODE_REGISTRY);
