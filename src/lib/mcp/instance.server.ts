// Loads and decrypts the caller's n8n instance (server-only).
import { decryptSecret } from "@/lib/crypto.server";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { N8nInstance, NativeInstanceMcp } from "./types";

/**
 * The instance MCP tools work with: the one the user chose (`is_default`; the
 * database keeps exactly one per user), else the oldest.
 */
export async function getDefaultInstance(userId: string): Promise<N8nInstance | null> {
  const instances = () =>
    supabaseAdmin
      .from("n8n_instances")
      .select(
        "id,base_url,api_key_encrypted,api_key_iv,api_key_tag,name,mcp_token_encrypted,mcp_token_iv,mcp_token_tag,mcp_capabilities",
      )
      .eq("user_id", userId);
  const chosen = await instances()
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  // 42703: is_default does not exist yet (app deployed before the migration).
  const { data } =
    chosen.error?.code === "42703"
      ? await instances().order("created_at", { ascending: true }).limit(1).maybeSingle()
      : chosen;
  if (!data) return null;
  const capabilities =
    data.mcp_capabilities &&
    typeof data.mcp_capabilities === "object" &&
    !Array.isArray(data.mcp_capabilities)
      ? (data.mcp_capabilities as Record<string, unknown>)
      : {};
  const native: NativeInstanceMcp | null =
    data.mcp_token_encrypted && data.mcp_token_iv && data.mcp_token_tag
      ? {
          token: decryptSecret({
            ciphertext: data.mcp_token_encrypted,
            iv: data.mcp_token_iv,
            tag: data.mcp_token_tag,
          }),
          tools: Array.isArray(capabilities.tools) ? capabilities.tools.map(String) : [],
        }
      : null;
  return {
    id: data.id,
    name: data.name,
    base_url: data.base_url,
    api_key: decryptSecret({
      ciphertext: data.api_key_encrypted,
      iv: data.api_key_iv,
      tag: data.api_key_tag,
    }),
    native,
  };
}
