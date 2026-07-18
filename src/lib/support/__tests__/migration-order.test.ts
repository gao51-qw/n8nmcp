import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationsDirectory = resolve(process.cwd(), "supabase/migrations");

describe("support migration ordering", () => {
  const migrationFiles = readdirSync(migrationsDirectory).filter((file) => file.endsWith(".sql"));

  it("uses a unique 14-digit version for every migration", () => {
    const versions = migrationFiles.map((file) => file.slice(0, 14));

    expect(new Set(versions).size).toBe(versions.length);
    expect(versions.every((version) => /^\d{14}$/.test(version))).toBe(true);
  });

  it("keeps support dependencies in their required order", () => {
    const expected = [
      "20260611223000_seed_2026_support_calendar.sql",
      "20260611224000_support_notification_outbox_worker.sql",
      "20260611230000_harden_support_admin_rpcs.sql",
      "20260611231000_support_maintenance.sql",
    ];

    for (const file of expected) {
      expect(migrationFiles).toContain(file);
    }

    const sortedFiles = [...migrationFiles].sort();
    const positions = expected.map((file) => sortedFiles.indexOf(file));

    expect(positions).toEqual([...positions].sort((left, right) => left - right));
  });

  it("documents the deployed calendar migration", () => {
    const readme = readFileSync(
      resolve(process.cwd(), "src/lib/support/calendar/README.md"),
      "utf8",
    );

    expect(readme).toContain("20260611223000_seed_2026_support_calendar.sql");
  });

  it("disambiguates attachment cleanup claims by primary-key constraint", () => {
    const latestDefinition = [...migrationFiles]
      .sort()
      .reverse()
      .map((file) => readFileSync(resolve(migrationsDirectory, file), "utf8"))
      .find((sql) =>
        sql.includes("create or replace function public.support_claim_expired_attachments"),
      );

    expect(latestDefinition).toContain(
      "on conflict on constraint support_attachment_cleanup_claims_pkey do nothing",
    );
  });
});
