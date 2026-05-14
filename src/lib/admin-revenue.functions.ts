import { createServerFn } from "@tanstack/react-start";
import { requireAdmin } from "@/lib/require-admin";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { z } from "zod";

// Hardcoded subscription monthly prices in cents (USD).
// Adjust here if pricing changes; admins can record one-off / contract
// revenue via manual entries.
const TIER_MONTHLY_CENTS: Record<string, number> = {
  pro: 1900,
  enterprise: 9900,
};

export type RevenueOverview = {
  mrrCents: number;
  arrCents: number;
  totalAllTimeCents: number;
  payingUsers: number;
  arpuCents: number;
  byTier: { tier: string; count: number; mrrCents: number }[];
  manualTotalCents: number;
  subsTotalCents: number;
  currency: string;
};

export type RevenueTrendPoint = {
  month: string; // YYYY-MM
  subsCents: number;
  manualCents: number;
  totalCents: number;
};

export type RevenueDetailRow = {
  id: string;
  type: "subscription" | "manual";
  occurred_at: string;
  amount_cents: number;
  currency: string;
  source: string;
  description: string;
  user_email: string | null;
};

function startOfMonth(d: Date) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}
function ymKey(d: Date) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export const getRevenueOverview = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .handler(async (): Promise<RevenueOverview> => {
    const { data: subs, error: subErr } = await supabaseAdmin
      .from("subscriptions")
      .select("tier, status, created_at, current_period_end");
    if (subErr) {
      console.error("[getRevenueOverview] subs", subErr);
      throw new Response("Failed", { status: 500 });
    }

    const byTierMap = new Map<string, { count: number; mrrCents: number }>();
    let mrrCents = 0;
    let payingUsers = 0;
    let subsTotalCents = 0;
    const now = Date.now();

    for (const s of subs ?? []) {
      const tier = s.tier ?? "free";
      const price = TIER_MONTHLY_CENTS[tier] ?? 0;
      const isActive = s.status === "active";
      const entry = byTierMap.get(tier) ?? { count: 0, mrrCents: 0 };
      entry.count += 1;
      if (price > 0 && isActive) {
        entry.mrrCents += price;
        mrrCents += price;
        payingUsers += 1;
      }
      byTierMap.set(tier, entry);

      // All-time subscription revenue ≈ months_active * monthly_price.
      // Cap by current_period_end / now.
      if (price > 0 && s.created_at) {
        const start = new Date(s.created_at).getTime();
        const end = Math.min(
          s.current_period_end ? new Date(s.current_period_end).getTime() : now,
          now,
        );
        const months = Math.max(0, (end - start) / (1000 * 60 * 60 * 24 * 30));
        subsTotalCents += Math.round(months * price);
      }
    }

    const { data: manual, error: mErr } = await supabaseAdmin
      .from("manual_revenue_entries")
      .select("amount_cents");
    if (mErr) {
      console.error("[getRevenueOverview] manual", mErr);
      throw new Response("Failed", { status: 500 });
    }
    const manualTotalCents = (manual ?? []).reduce(
      (acc, r) => acc + Number(r.amount_cents ?? 0),
      0,
    );

    const byTier = Array.from(byTierMap.entries())
      .map(([tier, v]) => ({ tier, ...v }))
      .sort((a, b) => b.mrrCents - a.mrrCents);

    return {
      mrrCents,
      arrCents: mrrCents * 12,
      totalAllTimeCents: subsTotalCents + manualTotalCents,
      payingUsers,
      arpuCents: payingUsers > 0 ? Math.round(mrrCents / payingUsers) : 0,
      byTier,
      manualTotalCents,
      subsTotalCents,
      currency: "USD",
    };
  });

const TrendInput = z
  .object({ months: z.number().int().min(1).max(36).default(12) })
  .default({ months: 12 });

export const getRevenueTrend = createServerFn({ method: "GET" })
  .middleware([requireAdmin])
  .inputValidator((d) => TrendInput.parse(d))
  .handler(async ({ data }): Promise<RevenueTrendPoint[]> => {
    const months = data.months;
    const now = new Date();
    const cutoff = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1),
    );

    // Build a zero-filled month skeleton.
    const buckets = new Map<string, RevenueTrendPoint>();
    for (let i = 0; i < months; i++) {
      const d = new Date(
        Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth() + i, 1),
      );
      buckets.set(ymKey(d), {
        month: ymKey(d),
        subsCents: 0,
        manualCents: 0,
        totalCents: 0,
      });
    }

    // Subscription contribution: for each active-ish subscription, add the
    // monthly price into every month between max(start, cutoff) and
    // min(end, now).
    const { data: subs, error: subErr } = await supabaseAdmin
      .from("subscriptions")
      .select("tier, status, created_at, current_period_end");
    if (subErr) {
      console.error("[getRevenueTrend] subs", subErr);
      throw new Response("Failed", { status: 500 });
    }
    for (const s of subs ?? []) {
      const price = TIER_MONTHLY_CENTS[s.tier ?? "free"] ?? 0;
      if (price <= 0 || !s.created_at) continue;
      const start = startOfMonth(new Date(s.created_at));
      const end = s.current_period_end
        ? new Date(s.current_period_end)
        : new Date();
      const endMonth = startOfMonth(end > new Date() ? new Date() : end);
      const cur = new Date(
        Math.max(start.getTime(), cutoff.getTime()),
      );
      while (cur <= endMonth) {
        const key = ymKey(cur);
        const b = buckets.get(key);
        if (b) {
          b.subsCents += price;
          b.totalCents += price;
        }
        cur.setUTCMonth(cur.getUTCMonth() + 1);
      }
    }

    // Manual entries grouped by month.
    const { data: manual, error: mErr } = await supabaseAdmin
      .from("manual_revenue_entries")
      .select("amount_cents, occurred_at")
      .gte("occurred_at", cutoff.toISOString());
    if (mErr) {
      console.error("[getRevenueTrend] manual", mErr);
      throw new Response("Failed", { status: 500 });
    }
    for (const m of manual ?? []) {
      const key = ymKey(new Date(m.occurred_at));
      const b = buckets.get(key);
      if (b) {
        const cents = Number(m.amount_cents ?? 0);
        b.manualCents += cents;
        b.totalCents += cents;
      }
    }

    return Array.from(buckets.values());
  });

const ListInput = z.object({
  page: z.number().int().min(1).max(10_000).default(1),
  pageSize: z.number().int().min(1).max(100).default(25),
  type: z.enum(["all", "subscription", "manual"]).default("all"),
});

export const listRevenueDetails = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) => ListInput.parse(d))
  .handler(async ({ data }) => {
    const rows: RevenueDetailRow[] = [];

    if (data.type !== "manual") {
      const { data: subs, error } = await supabaseAdmin
        .from("subscriptions")
        .select("user_id, tier, status, created_at, billing_provider, billing_subscription_id")
        .in("tier", ["pro", "enterprise"])
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) {
        console.error("[listRevenueDetails] subs", error);
        throw new Response("Failed", { status: 500 });
      }
      const userIds = Array.from(new Set((subs ?? []).map((s) => s.user_id)));
      const emailMap = new Map<string, string>();
      if (userIds.length) {
        const { data: profiles } = await supabaseAdmin
          .from("profiles")
          .select("id, email")
          .in("id", userIds);
        for (const p of profiles ?? []) {
          if (p.email) emailMap.set(p.id, p.email);
        }
      }
      for (const s of subs ?? []) {
        const price = TIER_MONTHLY_CENTS[s.tier ?? "free"] ?? 0;
        if (price <= 0) continue;
        rows.push({
          id: `sub:${s.user_id}`,
          type: "subscription",
          occurred_at: s.created_at,
          amount_cents: price,
          currency: "USD",
          source: `${s.billing_provider ?? "paddle"} · ${s.tier} · ${s.status}`,
          description: s.billing_subscription_id ?? "",
          user_email: emailMap.get(s.user_id) ?? null,
        });
      }
    }

    if (data.type !== "subscription") {
      const { data: manual, error } = await supabaseAdmin
        .from("manual_revenue_entries")
        .select("id, amount_cents, currency, source, description, occurred_at")
        .order("occurred_at", { ascending: false })
        .limit(500);
      if (error) {
        console.error("[listRevenueDetails] manual", error);
        throw new Response("Failed", { status: 500 });
      }
      for (const m of manual ?? []) {
        rows.push({
          id: `manual:${m.id}`,
          type: "manual",
          occurred_at: m.occurred_at,
          amount_cents: Number(m.amount_cents ?? 0),
          currency: m.currency ?? "USD",
          source: m.source ?? "other",
          description: m.description ?? "",
          user_email: null,
        });
      }
    }

    rows.sort(
      (a, b) =>
        new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime(),
    );
    const total = rows.length;
    const from = (data.page - 1) * data.pageSize;
    const items = rows.slice(from, from + data.pageSize);
    return { items, total, page: data.page, pageSize: data.pageSize };
  });

const CreateInput = z.object({
  amount_cents: z.number().int().refine((v) => v !== 0, "amount required"),
  currency: z.string().min(1).max(8).default("USD"),
  source: z.string().min(1).max(64),
  description: z.string().max(1000).default(""),
  occurred_at: z.string().datetime(),
});

export const createManualRevenue = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) => CreateInput.parse(d))
  .handler(async ({ data, context }) => {
    const { error } = await supabaseAdmin.from("manual_revenue_entries").insert({
      amount_cents: data.amount_cents,
      currency: data.currency,
      source: data.source,
      description: data.description,
      occurred_at: data.occurred_at,
      created_by: context.userId ?? null,
    });
    if (error) {
      console.error("[createManualRevenue]", error);
      throw new Response("Failed", { status: 500 });
    }
    return { ok: true };
  });

const DeleteInput = z.object({ id: z.string().uuid() });

export const deleteManualRevenue = createServerFn({ method: "POST" })
  .middleware([requireAdmin])
  .inputValidator((d) => DeleteInput.parse(d))
  .handler(async ({ data }) => {
    const { error } = await supabaseAdmin
      .from("manual_revenue_entries")
      .delete()
      .eq("id", data.id);
    if (error) {
      console.error("[deleteManualRevenue]", error);
      throw new Response("Failed", { status: 500 });
    }
    return { ok: true };
  });