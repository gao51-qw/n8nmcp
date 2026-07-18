import { randomUUID } from "node:crypto";
import type { WorkflowLike } from "../workflow-agent";

const KNOWLEDGE_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const TRANSIENT_HTTP_STATUSES = new Set([408, 429]);
const UNAVAILABLE_MESSAGE = "Knowledge service is unavailable";
const INVALID_CONFIGURATION_MESSAGE = "Knowledge service configuration is invalid";
const INVALID_RESPONSE_MESSAGE = "Knowledge service returned an invalid response";

type KnowledgeRecord = Record<string, unknown>;

export type KnowledgeTemplateHit = KnowledgeRecord & { id?: string | number; name?: string };
export type KnowledgeTemplateDetail = KnowledgeRecord & {
  id?: string | number;
  workflow?: WorkflowLike | null;
};
export type KnowledgeNodeHit = KnowledgeRecord & { node_type?: string; display_name?: string };
export type KnowledgeNodeDetail = KnowledgeRecord & {
  node_type?: string;
  display_name?: string;
};
export type KnowledgeNodeValidationInput = {
  nodeType: string;
  parameters: Record<string, unknown>;
  packageName?: string;
};
export type KnowledgeValidation = KnowledgeRecord & { ok: boolean; error?: string };

export interface KnowledgeClient {
  searchTemplates(query: string, limit: number): Promise<KnowledgeTemplateHit[]>;
  getTemplate(id: string | number): Promise<KnowledgeTemplateDetail>;
  searchNodes(query: string, limit: number): Promise<KnowledgeNodeHit[]>;
  getNode(nodeType: string, packageName?: string): Promise<KnowledgeNodeDetail>;
  validateNode(input: KnowledgeNodeValidationInput): Promise<KnowledgeValidation>;
  validateWorkflow(workflow: WorkflowLike): Promise<KnowledgeValidation>;
}

export class KnowledgeUnavailableError extends Error {
  constructor() {
    super(UNAVAILABLE_MESSAGE);
    this.name = "KnowledgeUnavailableError";
  }
}

export class KnowledgeConfigurationError extends Error {
  constructor() {
    super(INVALID_CONFIGURATION_MESSAGE);
    this.name = "KnowledgeConfigurationError";
  }
}

export class KnowledgeResponseError extends Error {
  constructor() {
    super(INVALID_RESPONSE_MESSAGE);
    this.name = "KnowledgeResponseError";
  }
}

export type KnowledgeClientConfig = { url: string; token: string };
export type KnowledgeTransportDependencies = { fetch?: typeof fetch };

export interface KnowledgeMcpTransport {
  callRpc(
    method: string,
    params: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<unknown>;
  callTool(
    name: string,
    args: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<unknown>;
}

function loadConfig(config?: KnowledgeClientConfig): KnowledgeClientConfig {
  const url = config?.url ?? process.env.UPSTREAM_N8N_MCP_URL ?? "";
  const token = config?.token ?? process.env.UPSTREAM_N8N_MCP_TOKEN ?? "";
  const hasUnencodableHeaderCharacter = [...token].some((character) => {
    const codePoint = character.charCodeAt(0);
    return codePoint < 32 || codePoint > 126;
  });
  if (
    !url ||
    !token ||
    url !== url.trim() ||
    token !== token.trim() ||
    hasUnencodableHeaderCharacter
  ) {
    throw new KnowledgeConfigurationError();
  }
  try {
    const parsed = new URL(url);
    if (
      !["http:", "https:"].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.hash
    ) {
      throw new KnowledgeConfigurationError();
    }
  } catch (error) {
    if (error instanceof KnowledgeConfigurationError) throw error;
    throw new KnowledgeConfigurationError();
  }
  return { url, token };
}

async function readBoundedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (Number.isFinite(bytes) && bytes > MAX_RESPONSE_BYTES) {
      throw new KnowledgeResponseError();
    }
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new KnowledgeResponseError();
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new KnowledgeResponseError();
  }
}

function parseJsonRpc(text: string, contentType: string): unknown {
  let payload: unknown;
  if (contentType.toLowerCase().includes("text/event-stream")) {
    const normalized = text.replace(/\r\n|\r/g, "\n");
    for (const event of normalized.split(/\n\n+/)) {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        const candidate = JSON.parse(data) as unknown;
        if (
          candidate &&
          typeof candidate === "object" &&
          ("result" in candidate || "error" in candidate)
        ) {
          payload = candidate;
          break;
        }
      } catch {
        // A later event may contain the JSON-RPC response.
      }
    }
  } else {
    try {
      payload = JSON.parse(text) as unknown;
    } catch {
      throw new KnowledgeResponseError();
    }
  }

  if (!payload || typeof payload !== "object") throw new KnowledgeResponseError();
  const rpc = payload as { jsonrpc?: unknown; result?: unknown; error?: unknown };
  if (rpc.jsonrpc !== "2.0" || rpc.error !== undefined || !("result" in rpc)) {
    throw new KnowledgeResponseError();
  }
  return rpc.result;
}

function parseToolContent(result: unknown): KnowledgeRecord {
  if (!result || typeof result !== "object") throw new KnowledgeResponseError();
  const toolResult = result as { isError?: unknown; content?: unknown };
  if (toolResult.isError === true || !Array.isArray(toolResult.content)) {
    throw new KnowledgeResponseError();
  }
  const textItem = toolResult.content.find(
    (item): item is { type: "text"; text: string } =>
      !!item &&
      typeof item === "object" &&
      (item as { type?: unknown }).type === "text" &&
      typeof (item as { text?: unknown }).text === "string",
  );
  if (!textItem) throw new KnowledgeResponseError();
  try {
    const parsed = JSON.parse(textItem.text) as unknown;
    if (
      !parsed ||
      typeof parsed !== "object" ||
      Array.isArray(parsed) ||
      ("error" in parsed && typeof (parsed as { ok?: unknown }).ok !== "boolean")
    ) {
      throw new KnowledgeResponseError();
    }
    return parsed as KnowledgeRecord;
  } catch (error) {
    if (error instanceof KnowledgeResponseError) throw error;
    throw new KnowledgeResponseError();
  }
}

export function createKnowledgeMcpTransport(
  config?: KnowledgeClientConfig,
  dependencies: KnowledgeTransportDependencies = {},
): KnowledgeMcpTransport {
  const configured = loadConfig(config);
  const networkFetch = dependencies.fetch ?? fetch;

  return Object.freeze({
    async callRpc(
      method: string,
      params: Record<string, unknown>,
      extraHeaders: Record<string, string> = {},
    ): Promise<unknown> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), KNOWLEDGE_TIMEOUT_MS);
      try {
        let response: Response;
        try {
          response = await networkFetch(configured.url, {
            method: "POST",
            redirect: "manual",
            headers: {
              ...extraHeaders,
              "Content-Type": "application/json",
              Accept: "application/json, text/event-stream",
              Authorization: `Bearer ${configured.token}`,
            },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: randomUUID(),
              method,
              params,
            }),
            signal: controller.signal,
          });
        } catch {
          throw new KnowledgeUnavailableError();
        }
        if (response.redirected || (response.url && response.url !== configured.url)) {
          throw new KnowledgeConfigurationError();
        }
        if (response.status >= 300 && response.status < 400) {
          throw new KnowledgeConfigurationError();
        }
        if (response.status === 401 || response.status === 403) {
          throw new KnowledgeConfigurationError();
        }
        if (
          TRANSIENT_HTTP_STATUSES.has(response.status) ||
          (response.status >= 500 && response.status <= 599)
        ) {
          throw new KnowledgeUnavailableError();
        }
        if (!response.ok) throw new KnowledgeResponseError();
        return parseJsonRpc(
          await readBoundedBody(response),
          response.headers.get("content-type") ?? "",
        );
      } catch (error) {
        if (
          error instanceof KnowledgeUnavailableError ||
          error instanceof KnowledgeConfigurationError ||
          error instanceof KnowledgeResponseError
        ) {
          throw error;
        }
        throw new KnowledgeUnavailableError();
      } finally {
        clearTimeout(timeout);
      }
    },
    async callTool(
      name: string,
      args: Record<string, unknown>,
      headers: Record<string, string> = {},
    ): Promise<unknown> {
      return this.callRpc("tools/call", { name, arguments: args }, headers);
    },
  });
}

function expectRecordArray(value: unknown): KnowledgeRecord[] {
  if (!Array.isArray(value) || value.some((item) => !item || typeof item !== "object")) {
    throw new KnowledgeResponseError();
  }
  return value as KnowledgeRecord[];
}

export function createKnowledgeClient(
  config?: KnowledgeClientConfig,
  dependencies: KnowledgeTransportDependencies = {},
): KnowledgeClient {
  const transport = createKnowledgeMcpTransport(config, dependencies);
  const call = async (name: string, args: Record<string, unknown>) =>
    parseToolContent(await transport.callTool(name, args));

  return Object.freeze({
    async searchTemplates(query: string, limit: number) {
      const result = await call("search_templates", { query, limit });
      return expectRecordArray(result.templates) as KnowledgeTemplateHit[];
    },
    async getTemplate(id: string | number) {
      const numericId = typeof id === "number" ? id : Number(id);
      if (!Number.isInteger(numericId)) throw new KnowledgeResponseError();
      return (await call("get_workflow_template", { id: numericId })) as KnowledgeTemplateDetail;
    },
    async searchNodes(query: string, limit: number) {
      const result = await call("search_nodes", { query, limit });
      return expectRecordArray(result.results) as KnowledgeNodeHit[];
    },
    async getNode(nodeType: string, packageName?: string) {
      return (await call("get_node_essentials", {
        node_type: nodeType,
        ...(packageName ? { package_name: packageName } : {}),
      })) as KnowledgeNodeDetail;
    },
    async validateNode(input: KnowledgeNodeValidationInput) {
      const result = await call("validate_node_operation", {
        node_type: input.nodeType,
        parameters: input.parameters,
        ...(input.packageName ? { package_name: input.packageName } : {}),
      });
      if (typeof result.ok !== "boolean") throw new KnowledgeResponseError();
      if ("error" in result) {
        const { error: _upstreamError, ...safeResult } = result;
        return { ...safeResult, ok: result.ok, error: "Node validation failed" };
      }
      return result as KnowledgeValidation;
    },
    async validateWorkflow(workflow: WorkflowLike) {
      const result = await call("validate_workflow", { workflow });
      if (typeof result.ok !== "boolean") throw new KnowledgeResponseError();
      return result as KnowledgeValidation;
    },
  });
}
