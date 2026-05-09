import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generatePlatformApiKey } from "./crypto.server";

export const listApiKeys = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("platform_api_keys")
      .select("id,name,key_prefix,created_at,last_used_at,revoked_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ name: z.string().trim().min(1).max(100) }).parse(d))
  .handler(async ({ context, data }) => {
    const { full, prefix, hash } = generatePlatformApiKey();
    const { data: row, error } = await context.supabase
      .from("platform_api_keys")
      .insert({
        user_id: context.userId,
        name: data.name,
        key_prefix: prefix,
        key_hash: hash,
      })
      .select("id,name,key_prefix,created_at")
      .single();
    if (error) throw new Error(error.message);
    // Return plaintext ONCE; client must show + warn user to copy.
    return { ...row, plaintext: full };
  });

export const revokeApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
      .from("platform_api_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
