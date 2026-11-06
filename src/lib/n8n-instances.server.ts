// n8n instance management for the dashboard.
//
// Secrets (the n8n API key and the optional instance-level MCP token) are
// checked against the instance before they are stored, encrypted with the app
// key, and never returned to the browser. All outbound requests go through the
// SSRF guard, so instances must be publicly reachable.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { encryptSecret } from "@/lib/crypto.server";
import {
  discoverNativeCapabilities,
  NativeMcpError,
  type NativeMcpCapabilities,
} from "@/lib/n8n-native-mcp.server";
import { safeFetchPublicUrl } from "@/lib/ssrf-guard.server";

export const MAX_INSTANCES_PER_USER = 20;

export class InstanceError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export type InstanceSummary = {
  id: string;
  name: string;
  base_url: string;
  status: string;
  last_checked_at: string | null;
  created_at: string;
  native_mcp: { configured: boolean; tools: string[]; checked_at: string | null };
};

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export type InstanceDependencies = {
  fetchImpl?: Fetcher;
  discover?: typeof discoverNativeCapabilities;
};

const SELECT_SUMMARY =
  "id,name,base_url,status,last_checked_at,created_at,mcp_token_encrypted,mcp_capabilities,mcp_checked_at";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function normalizeBaseUrl(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw new InstanceError("base_url is required", 400);
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new InstanceError("base_url must be a valid URL", 400);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new InstanceError("base_url must use http or https", 400);
  }
  if (url.username || url.password) {
    throw new InstanceError("base_url must not contain credentials", 400);
  }
  if (url.search || url.hash)
    throw new InstanceError("base_url must not contain a query or fragment", 400);
  const path = url.pathname.replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  return `${url.origin}${path}`;
}

function requiredText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim())
    throw new InstanceError(`${field} is required`, 400);
  const text = value.trim();
  if (text.length > max) throw new InstanceError(`${field} is too long`, 400);
  return text;
}

function toSummary(row: Record<string, unknown>): InstanceSummary {
  const capabilities = isRecord(row.mcp_capabilities) ? row.mcp_capabilities : {};
  return {
    id: String(row.id),
    name: String(row.name),
    base_url: String(row.base_url),
    status: String(row.status ?? "unknown"),
    last_checked_at: (row.last_checked_at as string | null) ?? null,
    created_at: String(row.created_at),
    native_mcp: {
      configured: typeof row.mcp_token_encrypted === "string",
      tools: Array.isArray(capabilities.tools) ? capabilities.tools.map(String) : [],
      checked_at: (row.mcp_checked_at as string | null) ?? null,
    },
  };
}

/** Confirms the API key works against the instance's Public API. */
export async function checkN8nApiKey(
  baseUrl: string,
  apiKey: string,
  fetchImpl: Fetcher = (url, init) => safeFetchPublicUrl(url, init),
): Promise<void> {
  let response: Response;
  try {
    response = await fetchImpl(`${baseUrl}/api/v1/workflows?limit=1`, {
      headers: { "X-N8N-API-KEY": apiKey, accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new InstanceError(`Could not reach the n8n instance: ${reason}`, 400);
  }
  if (response.status === 401 || response.status === 403) {
    throw new InstanceError("n8n rejected the API key", 400);
  }
  if (!response.ok) {
    throw new InstanceError(`n8n Public API answered with status ${response.status}`, 400);
  }
}

async function checkNativeToken(
  baseUrl: string,
  token: string,
  deps: InstanceDependencies,
): Promise<NativeMcpCapabilities> {
  try {
    return await (deps.discover ?? discoverNativeCapabilities)({
      baseUrl,
      token,
      fetchImpl: deps.fetchImpl,
    });
  } catch (error) {
    if (error instanceof NativeMcpError && error.kind === "unauthorized") {
      throw new InstanceError("n8n rejected the MCP access token", 400);
    }
    const reason = error instanceof Error ? error.message : String(error);
    throw new InstanceError(`Could not use the n8n instance-level MCP server: ${reason}`, 400);
  }
}

function nativeColumns(token: string, capabilities: NativeMcpCapabilities) {
  const encrypted = encryptSecret(token);
  return {
    mcp_token_encrypted: encrypted.ciphertext,
    mcp_token_iv: encrypted.iv,
    mcp_token_tag: encrypted.tag,
    mcp_capabilities: {
      protocolVersion: capabilities.protocolVersion,
      tools: capabilities.tools,
    } as Json,
    mcp_checked_at: capabilities.checkedAt,
  };
}

export async function listInstances(userId: string): Promise<InstanceSummary[]> {
  const { data, error } = await supabaseAdmin
    .from("n8n_instances")
    .select(SELECT_SUMMARY)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new InstanceError("Could not load instances", 500);
  return (data ?? []).map((row) => toSummary(row as Record<string, unknown>));
}

export async function createInstance(
  userId: string,
  input: Record<string, unknown>,
  deps: InstanceDependencies = {},
): Promise<InstanceSummary> {
  const name = requiredText(input.name, "name", 100);
  const baseUrl = normalizeBaseUrl(input.base_url);
  const apiKey = requiredText(input.api_key, "api_key", 2_000);
  const mcpToken =
    input.mcp_token === undefined || input.mcp_token === null || input.mcp_token === ""
      ? null
      : requiredText(input.mcp_token, "mcp_token", 4_000);

  const { count, error: countError } = await supabaseAdmin
    .from("n8n_instances")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);
  if (countError) throw new InstanceError("Could not load instances", 500);
  if ((count ?? 0) >= MAX_INSTANCES_PER_USER) {
    throw new InstanceError(`At most ${MAX_INSTANCES_PER_USER} instances per account`, 409);
  }

  await checkN8nApiKey(baseUrl, apiKey, deps.fetchImpl);
  const native = mcpToken
    ? nativeColumns(mcpToken, await checkNativeToken(baseUrl, mcpToken, deps))
    : {};
  const key = encryptSecret(apiKey);
  const now = new Date().toISOString();

  const { data, error } = await supabaseAdmin
    .from("n8n_instances")
    .insert({
      user_id: userId,
      name,
      base_url: baseUrl,
      api_key_encrypted: key.ciphertext,
      api_key_iv: key.iv,
      api_key_tag: key.tag,
      status: "ok",
      last_checked_at: now,
      ...native,
    })
    .select(SELECT_SUMMARY)
    .single();
  if (error || !data) throw new InstanceError("Could not save the instance", 500);
  return toSummary(data as Record<string, unknown>);
}

/** Sets (after checking it) or clears the instance-level MCP token. */
export async function setNativeMcpToken(
  userId: string,
  instanceId: string,
  token: unknown,
  deps: InstanceDependencies = {},
): Promise<InstanceSummary> {
  const { data: instance, error } = await supabaseAdmin
    .from("n8n_instances")
    .select("id,base_url")
    .eq("id", instanceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new InstanceError("Could not load the instance", 500);
  if (!instance) throw new InstanceError("Instance not found", 404);

  const clearing = token === null || token === "";
  const newToken = clearing ? null : requiredText(token, "mcp_token", 4_000);
  const update =
    newToken === null
      ? {
          mcp_token_encrypted: null,
          mcp_token_iv: null,
          mcp_token_tag: null,
          mcp_capabilities: {} as Json,
          mcp_checked_at: null,
        }
      : nativeColumns(newToken, await checkNativeToken(instance.base_url, newToken, deps));

  const { data, error: updateError } = await supabaseAdmin
    .from("n8n_instances")
    .update({ ...update, updated_at: new Date().toISOString() })
    .eq("id", instanceId)
    .eq("user_id", userId)
    .select(SELECT_SUMMARY)
    .single();
  if (updateError || !data) throw new InstanceError("Could not save the MCP token", 500);
  return toSummary(data as Record<string, unknown>);
}

export async function deleteInstance(userId: string, instanceId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("n8n_instances")
    .delete()
    .eq("id", instanceId)
    .eq("user_id", userId)
    .select("id");
  if (error) throw new InstanceError("Could not delete the instance", 500);
  if (!data || data.length === 0) throw new InstanceError("Instance not found", 404);
}
