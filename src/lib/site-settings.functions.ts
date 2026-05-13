import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type PublicSiteSettings = {
  ga4MeasurementId: string | null;
  gscVerification: string | null;
};

/**
 * Public read — runs unauthenticated. Values are shipped into the page <head>
 * so they need to be reachable during SSR before any user session exists.
 */
export const getPublicSiteSettings = createServerFn({ method: "GET" }).handler(
  async (): Promise<PublicSiteSettings> => {
    try {
      const { data, error } = await supabaseAdmin
        .from("site_settings")
        .select("ga4_measurement_id, gsc_verification")
        .eq("id", true)
        .maybeSingle();
      if (error) {
        console.error("getPublicSiteSettings", error);
        return { ga4MeasurementId: null, gscVerification: null };
      }
      return {
        ga4MeasurementId: data?.ga4_measurement_id ?? null,
        gscVerification: data?.gsc_verification ?? null,
      };
    } catch (err) {
      console.error("getPublicSiteSettings threw", err);
      return { ga4MeasurementId: null, gscVerification: null };
    }
  },
);

const Ga4Schema = z
  .string()
  .trim()
  .max(64)
  .regex(/^G-[A-Z0-9]{4,20}$/i, "GA4 IDs look like G-XXXXXXXXXX")
  .or(z.literal(""));

const GscSchema = z
  .string()
  .trim()
  .max(200)
  .regex(/^[A-Za-z0-9_\-]+$/, "GSC token must be the raw verification token (letters, digits, _ and - only)")
  .or(z.literal(""));

const InputSchema = z.object({
  ga4MeasurementId: Ga4Schema,
  gscVerification: GscSchema,
});

export const updateSiteSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => InputSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    // Verify admin role server-side (RLS will also enforce it, but we want a
    // clean error message rather than a generic permission denied).
    const { data: roleRow, error: roleErr } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (roleErr) {
      console.error("updateSiteSettings role check", roleErr);
      throw new Error("Could not verify admin role");
    }
    if (!roleRow) {
      throw new Error("Admin access required");
    }

    const payload = {
      id: true,
      ga4_measurement_id: data.ga4MeasurementId ? data.ga4MeasurementId : null,
      gsc_verification: data.gscVerification ? data.gscVerification : null,
      updated_by: userId,
    };

    const { error } = await supabase
      .from("site_settings")
      .upsert(payload, { onConflict: "id" });

    if (error) {
      console.error("updateSiteSettings upsert", error);
      throw new Error("Failed to save settings");
    }

    return { ok: true as const };
  });

export const getAdminSiteSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const { data: roleRow } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", userId)
      .eq("role", "admin")
      .maybeSingle();
    if (!roleRow) throw new Error("Admin access required");

    const { data, error } = await supabase
      .from("site_settings")
      .select("ga4_measurement_id, gsc_verification, updated_at")
      .eq("id", true)
      .maybeSingle();
    if (error) throw new Error("Failed to load settings");

    return {
      ga4MeasurementId: data?.ga4_measurement_id ?? "",
      gscVerification: data?.gsc_verification ?? "",
      updatedAt: data?.updated_at ?? null,
    };
  });