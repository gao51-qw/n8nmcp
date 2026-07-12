import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("workflow agent Console migration", () => {
  it("keeps durable confirmation private and publishes owner-scoped event sources", () => {
    const directory = resolve(process.cwd(), "supabase/migrations");
    const matches = readdirSync(directory).filter((name) =>
      name.endsWith("_workflow_agent_console_live_actions.sql"),
    );
    expect(matches).toHaveLength(1);
    const sql = readFileSync(resolve(directory, matches[0]!), "utf8").toLowerCase();

    expect(sql).toContain("metadata jsonb not null default '{}'::jsonb");
    expect(sql).toContain(
      "alter table public.workflow_confirmation_challenges enable row level security",
    );
    expect(sql).toContain("alter publication supabase_realtime add table public.mcp_call_logs");
    expect(sql).toContain(
      "alter publication supabase_realtime add table public.workflow_audit_log",
    );
    expect(sql).not.toMatch(/create\s+policy[\s\S]*workflow_confirmation_challenges/);
  });
});
