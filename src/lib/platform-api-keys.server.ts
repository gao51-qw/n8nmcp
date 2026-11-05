// Platform API keys (nmcp_…) used by MCP clients that authenticate with a
// Bearer key instead of OAuth. Only the SHA-256 hash and a short display
// prefix are stored; the full key is shown once, when it is created.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { generatePlatformApiKey } from "@/lib/crypto.server";

export const MAX_ACTIVE_KEYS = 20;

export class ApiKeyError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

export type ApiKeySummary = {
  id: string;
  name: string;
  key_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
};

const SUMMARY = "id,name,key_prefix,created_at,last_used_at,revoked_at";

export async function listApiKeys(userId: string): Promise<ApiKeySummary[]> {
  const { data, error } = await supabaseAdmin
    .from("platform_api_keys")
    .select(SUMMARY)
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new ApiKeyError("Could not load API keys", 500);
  return (data ?? []) as ApiKeySummary[];
}

/** Creates a key and returns it in full exactly once. */
export async function createApiKey(
  userId: string,
  rawName: unknown,
): Promise<{ key: ApiKeySummary; secret: string }> {
  const name = typeof rawName === "string" ? rawName.trim() : "";
  if (!name) throw new ApiKeyError("name is required", 400);
  if (name.length > 100) throw new ApiKeyError("name is too long", 400);

  const { count, error: countError } = await supabaseAdmin
    .from("platform_api_keys")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .is("revoked_at", null);
  if (countError) throw new ApiKeyError("Could not load API keys", 500);
  if ((count ?? 0) >= MAX_ACTIVE_KEYS) {
    throw new ApiKeyError(`At most ${MAX_ACTIVE_KEYS} active keys per account`, 409);
  }

  const generated = generatePlatformApiKey();
  const { data, error } = await supabaseAdmin
    .from("platform_api_keys")
    .insert({ user_id: userId, name, key_hash: generated.hash, key_prefix: generated.prefix })
    .select(SUMMARY)
    .single();
  if (error || !data) throw new ApiKeyError("Could not create the API key", 500);
  return { key: data as ApiKeySummary, secret: generated.full };
}

/** Revokes a key; authentication rejects it from the next request on. */
export async function revokeApiKey(userId: string, keyId: string): Promise<void> {
  const { data, error } = await supabaseAdmin
    .from("platform_api_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", keyId)
    .eq("user_id", userId)
    .is("revoked_at", null)
    .select("id");
  if (error) throw new ApiKeyError("Could not revoke the API key", 500);
  if (!data || data.length === 0) throw new ApiKeyError("API key not found", 404);
}
