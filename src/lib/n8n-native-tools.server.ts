// Gateway tools backed by n8n's instance-level MCP server: native workflow
// version history and node option resolution (dynamic dropdowns such as Slack
// channels or Notion databases). Both are read-only and need the instance's
// MCP access token.
import type { N8nInstance } from "@/lib/mcp.server";
import { nativeClientFor, nativeToolAvailable } from "@/lib/n8n-native-execution.server";

const NATIVE_SETUP_HINT =
  "Store an instance-level MCP token for this n8n instance in the dashboard (n8n Settings → Instance-level MCP).";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  return value.trim();
}

export type NativeHistory =
  | { available: false; reason: string }
  | { available: true; versions: unknown[]; count: number | null };

/** n8n's own version history for a workflow (n8n 2.29+). */
export async function nativeWorkflowHistory(
  inst: N8nInstance,
  workflowId: string,
  limit = 20,
): Promise<NativeHistory> {
  if (!nativeToolAvailable(inst, "get_workflow_history")) {
    return {
      available: false,
      reason: `Native version history is not available. ${NATIVE_SETUP_HINT}`,
    };
  }
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(1, Math.floor(limit)), 50) : 20;
  const result = await nativeClientFor(inst).callTool(
    "get_workflow_history",
    { workflowId, limit: safeLimit },
    { idempotent: true },
  );
  const record = isRecord(result) ? result : {};
  return {
    available: true,
    versions: Array.isArray(record.versions) ? record.versions : [],
    count: typeof record.count === "number" ? record.count : null,
  };
}

export type NodeOptions = {
  options: Array<{ name: string; value: unknown; url?: string }>;
  paginationToken: string | null;
};

/**
 * Resolves the options of a node parameter that n8n loads with a credential
 * (n8n 2.27+ `explore_node_resources`). Only the documented arguments are
 * forwarded and only the option list comes back; credentials stay in n8n.
 */
export async function resolveNodeOptions(
  inst: N8nInstance,
  args: Record<string, unknown>,
): Promise<NodeOptions> {
  if (!nativeToolAvailable(inst, "explore_node_resources")) {
    throw new Error(
      `resolve_node_options requires n8n 2.27+ with instance-level MCP. ${NATIVE_SETUP_HINT}`,
    );
  }
  const methodType = requireString(args.methodType, "methodType");
  if (methodType !== "listSearch" && methodType !== "loadOptions") {
    throw new Error('methodType must be "listSearch" or "loadOptions"');
  }
  const version = Number(args.version);
  if (!Number.isFinite(version) || version <= 0) {
    throw new Error("version must be a positive number");
  }
  const forwarded: Record<string, unknown> = {
    nodeType: requireString(args.nodeType, "nodeType"),
    version,
    methodName: requireString(args.methodName, "methodName"),
    methodType,
    credentialType: requireString(args.credentialType, "credentialType"),
    credentialId: requireString(args.credentialId, "credentialId"),
  };
  if (typeof args.filter === "string") forwarded.filter = args.filter;
  if (typeof args.paginationToken === "string" && methodType === "listSearch") {
    forwarded.paginationToken = args.paginationToken;
  }
  if (isRecord(args.currentNodeParameters)) {
    forwarded.currentNodeParameters = args.currentNodeParameters;
  }

  const result = await nativeClientFor(inst).callTool("explore_node_resources", forwarded, {
    idempotent: true,
  });
  const record = isRecord(result) ? result : {};
  const options = (Array.isArray(record.results) ? record.results : [])
    .filter(isRecord)
    .map((item) => ({
      name: String(item.name ?? item.value ?? ""),
      value: item.value,
      ...(typeof item.url === "string" ? { url: item.url } : {}),
    }));
  return {
    options,
    paginationToken: typeof record.paginationToken === "string" ? record.paginationToken : null,
  };
}
