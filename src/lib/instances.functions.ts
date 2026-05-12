import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { encryptSecret, decryptSecret } from "./crypto.server";
import { assertPublicUrl } from "./ssrf-guard.server";

const baseUrlSchema = z
  .string()
  .trim()
  .url("Must be a valid URL")
  .max(500)
  .refine((u) => /^https?:\/\//i.test(u), "Must start with http(s)://");

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  base_url: baseUrlSchema,
  api_key: z.string().trim().min(8).max(2000),
});

const updateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(100).optional(),
  base_url: baseUrlSchema.optional(),
  api_key: z.string().trim().min(8).max(2000).optional(),
});

export const listInstances = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("n8n_instances")
      .select("id,name,base_url,status,last_checked_at,created_at,updated_at")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return data ?? [];
  });

export const createInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => createSchema.parse(d))
  .handler(async ({ context, data }) => {
    await assertPublicUrl(data.base_url);
    const enc = encryptSecret(data.api_key);
    const { data: row, error } = await context.supabase
      .from("n8n_instances")
      .insert({
        user_id: context.userId,
        name: data.name,
        base_url: data.base_url.replace(/\/+$/, ""),
        api_key_encrypted: enc.ciphertext,
        api_key_iv: enc.iv,
        api_key_tag: enc.tag,
        status: "unknown",
      })
      .select("id,name,base_url,status,last_checked_at,created_at,updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const updateInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => updateSchema.parse(d))
  .handler(async ({ context, data }) => {
    const patch: {
      updated_at: string;
      name?: string;
      base_url?: string;
      api_key_encrypted?: string;
      api_key_iv?: string;
      api_key_tag?: string;
      status?: string;
    } = { updated_at: new Date().toISOString() };
    if (data.name) patch.name = data.name;
    if (data.base_url) {
      await assertPublicUrl(data.base_url);
      patch.base_url = data.base_url.replace(/\/+$/, "");
    }
    if (data.api_key) {
      const enc = encryptSecret(data.api_key);
      patch.api_key_encrypted = enc.ciphertext;
      patch.api_key_iv = enc.iv;
      patch.api_key_tag = enc.tag;
      patch.status = "unknown";
    }
    const { data: row, error } = await context.supabase
      .from("n8n_instances")
      .update(patch)
      .eq("id", data.id)
      .select("id,name,base_url,status,last_checked_at,created_at,updated_at")
      .single();
    if (error) throw new Error(error.message);
    return row;
  });

export const deleteInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase.from("n8n_instances").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const testInstance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) => z.object({ id: z.string().uuid() }).parse(d))
  .handler(async ({ context, data }) => {
    const { data: row, error } = await context.supabase
      .from("n8n_instances")
      .select("base_url,api_key_encrypted,api_key_iv,api_key_tag")
      .eq("id", data.id)
      .single();
    if (error || !row) throw new Error(error?.message ?? "Not found");

    const apiKey = decryptSecret({
      ciphertext: row.api_key_encrypted,
      iv: row.api_key_iv,
      tag: row.api_key_tag,
    });

    const started = Date.now();
    let status: "online" | "offline" | "unauthorized" | "error" = "error";
    let detail = "";
    try {
      await assertPublicUrl(row.base_url);
      const res = await fetch(`${row.base_url}/api/v1/workflows?limit=1`, {
        method: "GET",
        headers: { "X-N8N-API-KEY": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(8000),
      });
      if (res.ok) status = "online";
      else if (res.status === 401 || res.status === 403) status = "unauthorized";
      else status = "offline";
      detail = `HTTP ${res.status}`;
    } catch (e) {
      status = "offline";
      // Don't echo full network error details (may include internal addresses).
      detail = e instanceof Error && /allowed|private|internal|Invalid URL|verify/.test(e.message)
        ? e.message
        : "connection failed";
    }

    await context.supabase
      .from("n8n_instances")
      .update({ status, last_checked_at: new Date().toISOString() })
      .eq("id", data.id);

    return { status, detail, latency_ms: Date.now() - started };
  });

export const testMcpConnection = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d) =>
    z
      .object({
        instance_id: z.string().uuid().optional(),
        key_id: z.string().uuid().optional(),
      })
      .parse(d),
  )
  .handler(async ({ context, data }) => {
    // 1) Pick the n8n instance (specified or most recent).
    let instanceQuery = context.supabase
      .from("n8n_instances")
      .select("id,name,base_url,api_key_encrypted,api_key_iv,api_key_tag")
      .order("created_at", { ascending: false })
      .limit(1);
    if (data.instance_id) {
      instanceQuery = context.supabase
        .from("n8n_instances")
        .select("id,name,base_url,api_key_encrypted,api_key_iv,api_key_tag")
        .eq("id", data.instance_id)
        .limit(1);
    }
    const { data: instances, error: instErr } = await instanceQuery;
    if (instErr) throw new Error("Failed to load instance");
    const instance = instances?.[0];

    // 2) Verify an active API key exists (and matches the selection if any).
    let keyQuery = context.supabase
      .from("platform_api_keys")
      .select("id,name,key_prefix")
      .is("revoked_at", null)
      .limit(1);
    if (data.key_id) {
      keyQuery = context.supabase
        .from("platform_api_keys")
        .select("id,name,key_prefix")
        .is("revoked_at", null)
        .eq("id", data.key_id)
        .limit(1);
    }
    const { data: keys } = await keyQuery;
    const key = keys?.[0] ?? null;

    // 3) Probe the n8n instance like testInstance does.
    let instanceResult: {
      ok: boolean;
      status: "online" | "offline" | "unauthorized" | "error" | "missing";
      detail: string;
      latency_ms: number | null;
      name: string | null;
    } = { ok: false, status: "missing", detail: "No n8n instance connected", latency_ms: null, name: null };

    if (instance) {
      const apiKey = decryptSecret({
        ciphertext: instance.api_key_encrypted,
        iv: instance.api_key_iv,
        tag: instance.api_key_tag,
      });
      const started = Date.now();
      let status: "online" | "offline" | "unauthorized" | "error" = "error";
      let detail = "";
      try {
        await assertPublicUrl(instance.base_url);
        const res = await fetch(`${instance.base_url}/api/v1/workflows?limit=1`, {
          method: "GET",
          headers: { "X-N8N-API-KEY": apiKey, Accept: "application/json" },
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) status = "online";
        else if (res.status === 401 || res.status === 403) status = "unauthorized";
        else status = "offline";
        detail = `HTTP ${res.status}`;
      } catch (e) {
        status = "offline";
        detail = e instanceof Error && /allowed|private|internal|Invalid URL|verify/.test(e.message)
          ? e.message
          : "connection failed";
      }
      await context.supabase
        .from("n8n_instances")
        .update({ status, last_checked_at: new Date().toISOString() })
        .eq("id", instance.id);
      instanceResult = {
        ok: status === "online",
        status,
        detail,
        latency_ms: Date.now() - started,
        name: instance.name,
      };
    }

    return {
      instance: instanceResult,
      apiKey: key
        ? { ok: true as const, name: key.name, prefix: key.key_prefix }
        : { ok: false as const, name: null, prefix: null },
    };
  });
