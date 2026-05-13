import { createServerFn } from "@tanstack/react-start";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { log } from "@/lib/logger.server";
import {
  DEFAULT_ANNOUNCEMENTS,
  DEFAULT_SEED_SOURCE,
} from "@/lib/announcements-seed";

export type EnsureSeededResult = {
  source: "database" | typeof DEFAULT_SEED_SOURCE;
  count: number;
  seeded: boolean;
  fetchedAt: string;
};

/**
 * Ensures the announcements table has at least one published row.
 * If empty, inserts the built-in default seed and returns source="builtin".
 * Otherwise reports source="database". Logs the fetch source either way.
 */
export const ensureAnnouncementsSeeded = createServerFn({ method: "POST" })
  .handler(async (): Promise<EnsureSeededResult> => {
    const fetchedAt = new Date().toISOString();

    const { count, error: countError } = await supabaseAdmin
      .from("announcements")
      .select("id", { count: "exact", head: true })
      .eq("status", "published");

    if (countError) {
      log.error("announcements.ensure_seeded.count_failed", {
        err: countError.message,
      });
      throw new Response("Failed to check announcements", { status: 500 });
    }

    if ((count ?? 0) > 0) {
      log.info("announcements.ensure_seeded.skipped", {
        source: "database",
        count: count ?? 0,
      });
      return {
        source: "database",
        count: count ?? 0,
        seeded: false,
        fetchedAt,
      };
    }

    const now = Date.now();
    const rows = DEFAULT_ANNOUNCEMENTS.map((a) => ({
      title: a.title,
      body: a.body,
      status: "published",
      published_at: new Date(now + a.offsetDays * 86_400_000).toISOString(),
    }));

    const { error: insertError } = await supabaseAdmin
      .from("announcements")
      .insert(rows);

    if (insertError) {
      log.error("announcements.ensure_seeded.insert_failed", {
        err: insertError.message,
        source: DEFAULT_SEED_SOURCE,
      });
      throw new Response("Failed to seed announcements", { status: 500 });
    }

    log.info("announcements.ensure_seeded.inserted", {
      source: DEFAULT_SEED_SOURCE,
      count: rows.length,
    });

    return {
      source: DEFAULT_SEED_SOURCE,
      count: rows.length,
      seeded: true,
      fetchedAt,
    };
  });
