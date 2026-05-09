import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { tierLimit, type Tier } from "@/lib/tiers";

export type QuotaInfo = {
  tier: Tier;
  used: number;
  limit: number;
  remaining: number;
  pct: number; // 0-100
  exceeded: boolean;
};

export function useQuota() {
  const { user } = useAuth();

  return useQuery({
    queryKey: ["quota", user?.id],
    enabled: !!user,
    refetchInterval: 30_000,
    queryFn: async (): Promise<QuotaInfo> => {
      const today = new Date().toISOString().slice(0, 10);
      const [{ data: sub }, { data: usage }] = await Promise.all([
        supabase.from("subscriptions").select("tier").maybeSingle(),
        supabase.from("usage_daily").select("mcp_calls").eq("day", today).maybeSingle(),
      ]);
      const tier = ((sub?.tier as Tier) ?? "free");
      const limit = tierLimit(tier);
      const used = usage?.mcp_calls ?? 0;
      const remaining = Math.max(0, limit - used);
      const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
      return { tier, used, limit, remaining, pct, exceeded: used >= limit };
    },
  });
}
