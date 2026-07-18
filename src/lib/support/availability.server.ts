import { supabaseAdmin } from "@/integrations/supabase/client.server";

type AvailabilityQuery = {
  select(columns: string, options: { count: "exact"; head: true }): AvailabilityQuery;
  eq(column: string, value: string): AvailabilityQuery;
  gte(
    column: string,
    value: string,
  ): Promise<{
    count: number | null;
    error: { message?: string } | null;
  }>;
};

const presenceDb = supabaseAdmin as unknown as {
  from(table: "support_agent_presence"): AvailabilityQuery;
};

export async function getSupportAvailability(): Promise<{
  online: boolean;
  count: number;
}> {
  const cutoff = new Date(Date.now() - 90_000).toISOString();
  const { count, error } = await presenceDb
    .from("support_agent_presence")
    .select("agent_id", { count: "exact", head: true })
    .eq("status", "online")
    .gte("last_heartbeat_at", cutoff);

  if (error) {
    throw new Error(error.message || "Unable to load support availability");
  }

  const onlineCount = count ?? 0;
  return { online: onlineCount > 0, count: onlineCount };
}
