import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = resolve(
  process.cwd(),
  "supabase/migrations/20260612143000_harden_support_attachment_contracts.sql",
);

describe("support attachment contract migration", () => {
  const sql = readFileSync(migrationPath, "utf8").toLowerCase();

  it("normalizes absolute expiry to the database transaction time plus 180 days", () => {
    expect(sql).toContain("transaction_timestamp() + interval '180 days'");
    expect(sql).toContain("'expiresat'");
  });

  it("locks tickets and enforces a cumulative five-attachment limit", () => {
    expect(sql).toContain("for update");
    expect(sql).toContain("support_attachment_count");
    expect(sql).toContain("> 5");
  });

  it("provides atomic user and admin reply RPCs that reject closed tickets", () => {
    expect(sql).toContain("function public.support_add_reply");
    expect(sql).toContain("function public.support_admin_add_reply");
    expect(sql).toContain("closed tickets cannot receive replies");
  });

  it("validates storage paths as user/ticket/uuid-sanitized-filename", () => {
    expect(sql).toContain("invalid attachment path");
    expect(sql).toContain("[0-9a-f]{8}-[0-9a-f]{4}");
    expect(sql).toContain("[a-za-z0-9_.-]");
  });
});
