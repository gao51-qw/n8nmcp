// Argument parsers for the orchestrated workflow tools (create_*, deploy, fix).
import {
  optionalBoolean,
  optionalNumber,
  optionalObject,
  optionalString,
  requireEnumString,
  requireNonEmptyString,
  requireObject,
  validateConfirmationFields,
} from "./args";

export const ORCHESTRATED_TOOL_NAMES = new Set([
  "create_scheduled_workflow",
  "create_webhook_workflow",
  "create_ai_chatbot_workflow",
  "create_email_workflow",
  "deploy_and_test_workflow",
  "fix_workflow_errors",
]);

function parseSmtpCredentialReference(value: unknown): {
  smtp: { id: string; name: string };
} {
  const credentials = requireObject(value, "interfaceConfig.humanEmailCredentials");
  const credentialKeys = Object.keys(credentials);
  if (credentialKeys.length !== 1 || credentialKeys[0] !== "smtp") {
    throw new Error("interfaceConfig.humanEmailCredentials must contain only smtp");
  }
  const smtp = requireObject(credentials.smtp, "interfaceConfig.humanEmailCredentials.smtp");
  const smtpKeys = Object.keys(smtp);
  if (smtpKeys.some((key) => key !== "id" && key !== "name")) {
    throw new Error("interfaceConfig.humanEmailCredentials.smtp supports only id and name");
  }
  return {
    smtp: {
      id: requireNonEmptyString(smtp.id, "interfaceConfig.humanEmailCredentials.smtp.id"),
      name: requireNonEmptyString(smtp.name, "interfaceConfig.humanEmailCredentials.smtp.name"),
    },
  };
}

function parseAIChatbotArgs(args: Record<string, unknown>): Record<string, unknown> {
  const interfaceName = requireEnumString(args.interface ?? args.platform, "interface", [
    "webhook",
    "slack",
  ]);
  const aiProvider =
    args.aiProvider === undefined
      ? "openai"
      : requireEnumString(args.aiProvider, "aiProvider", ["openai"]);
  const rawAIConfig = requireObject(args.aiConfig, "aiConfig");
  if (rawAIConfig.apiKey !== undefined) {
    throw new Error("aiConfig.apiKey is not supported; use an n8n credential reference");
  }
  const model = requireNonEmptyString(rawAIConfig.model, "aiConfig.model");

  const rawFeatures = optionalObject(args.features, "features") ?? {};
  const legacyEscalation = optionalObject(args.escalationRules, "escalationRules");
  const legacyNotification = optionalObject(args.humanNotification, "humanNotification");
  if (legacyNotification?.method !== undefined && legacyNotification.method !== "email") {
    throw new Error("humanNotification.method must be email");
  }
  if (legacyEscalation?.sentimentThreshold !== undefined) {
    optionalNumber(legacyEscalation.sentimentThreshold, "escalationRules.sentimentThreshold");
  }

  const explicitHumanHandoff = optionalBoolean(rawFeatures.humanHandoff, "features.humanHandoff");
  const explicitSentiment = optionalBoolean(
    rawFeatures.sentimentAnalysis,
    "features.sentimentAnalysis",
  );
  const humanHandoff = explicitHumanHandoff ?? legacyNotification !== undefined;
  const sentimentAnalysis = explicitSentiment ?? legacyEscalation?.sentimentThreshold !== undefined;

  const rawInterfaceConfig = optionalObject(args.interfaceConfig, "interfaceConfig") ?? {};
  const humanEmail = optionalString(
    rawInterfaceConfig.humanEmail ?? legacyNotification?.recipient,
    "interfaceConfig.humanEmail",
  );
  const rawHumanEmailCredentials =
    rawInterfaceConfig.humanEmailCredentials ?? legacyNotification?.credentials;
  const humanEmailCredentials =
    rawHumanEmailCredentials === undefined
      ? undefined
      : parseSmtpCredentialReference(rawHumanEmailCredentials);

  if (humanHandoff) {
    requireNonEmptyString(humanEmail, "interfaceConfig.humanEmail");
    if (!humanEmailCredentials || Object.keys(humanEmailCredentials).length === 0) {
      throw new Error("interfaceConfig.humanEmailCredentials must contain credential references");
    }
  }

  const credentialRequired = aiProvider === "openai" || sentimentAnalysis;
  const credentialId =
    rawAIConfig.credentialId === undefined
      ? undefined
      : requireNonEmptyString(rawAIConfig.credentialId, "aiConfig.credentialId");
  const credentialName =
    rawAIConfig.credentialName === undefined
      ? undefined
      : requireNonEmptyString(rawAIConfig.credentialName, "aiConfig.credentialName");
  if (credentialRequired && (!credentialId || !credentialName)) {
    throw new Error(
      "aiConfig credentialId and credentialName are required for OpenAI-backed nodes",
    );
  }

  const systemPromptValue = rawAIConfig.systemPrompt ?? args.systemPrompt;
  const systemPrompt =
    systemPromptValue === undefined
      ? undefined
      : requireNonEmptyString(systemPromptValue, "aiConfig.systemPrompt");
  const temperature = optionalNumber(rawAIConfig.temperature, "aiConfig.temperature");
  if (temperature !== undefined && (temperature < 0 || temperature > 2)) {
    throw new Error("aiConfig.temperature must be between 0 and 2");
  }
  const maxTokens = optionalNumber(rawAIConfig.maxTokens, "aiConfig.maxTokens");
  if (maxTokens !== undefined && (!Number.isInteger(maxTokens) || maxTokens < 1)) {
    throw new Error("aiConfig.maxTokens must be a positive integer");
  }
  const path = optionalString(rawInterfaceConfig.path, "interfaceConfig.path");
  const activate = optionalBoolean(args.activate, "activate");

  return {
    name: requireNonEmptyString(args.name, "name"),
    interface: interfaceName,
    aiProvider,
    aiConfig: {
      model,
      ...(credentialId !== undefined ? { credentialId } : {}),
      ...(credentialName !== undefined ? { credentialName } : {}),
      ...(systemPrompt !== undefined ? { systemPrompt } : {}),
      ...(temperature !== undefined ? { temperature } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    },
    interfaceConfig: {
      ...(path !== undefined ? { path } : {}),
      ...(humanEmail !== undefined ? { humanEmail } : {}),
      ...(humanEmailCredentials !== undefined ? { humanEmailCredentials } : {}),
    },
    features: {
      ...(humanHandoff ? { humanHandoff: true } : {}),
      ...(sentimentAnalysis ? { sentimentAnalysis: true } : {}),
    },
    ...(activate !== undefined ? { activate } : {}),
  };
}

function parseProcessingSteps(value: unknown): Array<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("processing must be an array");
  return value.map((candidate, index) => {
    const step = requireObject(candidate, `processing[${index}]`);
    return {
      ...step,
      action: requireEnumString(step.action, `processing[${index}].action`, [
        "transform",
        "validate",
      ]),
      config: requireObject(step.config, `processing[${index}].config`),
    };
  });
}

function parseValidationRules(value: unknown): Array<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error("validationRules must be an array");
  return value.map((candidate, index) => {
    const rule = requireObject(candidate, `validationRules[${index}]`);
    return {
      ...rule,
      field: requireNonEmptyString(rule.field, `validationRules[${index}].field`),
      condition: requireEnumString(rule.condition, `validationRules[${index}].condition`, [
        "exists",
        "equals",
        "contains",
        "matches",
      ]),
      expectedValue: optionalString(rule.expectedValue, `validationRules[${index}].expectedValue`),
    };
  });
}

export function parseOrchestratedToolArgs(
  name: string,
  args: Record<string, unknown>,
): Record<string, unknown> {
  switch (name) {
    case "create_scheduled_workflow":
      optionalBoolean(args.activate, "activate");
      return {
        ...args,
        name: requireNonEmptyString(args.name, "name"),
        schedule: requireNonEmptyString(args.schedule, "schedule"),
        action: requireEnumString(args.action, "action", [
          "send_email",
          "http_request",
          "slack_message",
        ]),
        actionConfig: requireObject(args.actionConfig, "actionConfig"),
      };
    case "create_webhook_workflow":
      optionalBoolean(args.activate, "activate");
      optionalObject(args.responseTemplate, "responseTemplate");
      return {
        ...args,
        name: requireNonEmptyString(args.name, "name"),
        path: optionalString(args.path, "path"),
        method:
          args.method === undefined
            ? undefined
            : requireEnumString(args.method, "method", ["GET", "POST", "PUT", "DELETE", "PATCH"]),
        processing: parseProcessingSteps(args.processing),
      };
    case "create_ai_chatbot_workflow":
      return parseAIChatbotArgs(args);
    case "create_email_workflow":
      optionalBoolean(args.activate, "activate");
      optionalObject(args.triggerConfig, "triggerConfig");
      if (args.conditions !== undefined && !Array.isArray(args.conditions)) {
        throw new Error("conditions must be an array");
      }
      return {
        ...args,
        name: requireNonEmptyString(args.name, "name"),
        trigger: requireEnumString(args.trigger, "trigger", ["webhook", "schedule", "manual"]),
        emailTemplate: requireObject(args.emailTemplate, "emailTemplate"),
      };
    case "deploy_and_test_workflow":
      validateConfirmationFields(args);
      optionalBoolean(args.rollbackOnFailure, "rollbackOnFailure");
      return {
        ...args,
        workflowId: requireNonEmptyString(args.workflowId, "workflowId"),
        testData: requireObject(args.testData, "testData"),
        validationRules: parseValidationRules(args.validationRules),
      };
    case "fix_workflow_errors":
      return {
        workflowId: requireNonEmptyString(args.workflowId, "workflowId"),
      };
    default:
      return args;
  }
}
