# Support Ticket and Live Chat Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver authenticated live support and persistent support tickets in the active Next.js App Router application, with Supabase Realtime, three-agent automatic assignment, China business-hours SLA, Resend email, n8n notifications, Sentry correlation, and Free-plan guardrails.

**Architecture:** Supabase Postgres is the durable system of record and Realtime only announces persisted changes. New production code lives under `src/lib/support`, `src/app/api/support`, and `src/app/dashboard`; the excluded `src/legacy-routes` implementation is reference material only. Reliable external notifications use a database outbox processed by protected Next.js maintenance routes invoked by VPS cron.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, Supabase Auth/Postgres/Realtime/Storage, Zod, Vitest, Playwright, Resend, Sentry, n8n webhooks.

---

## Scope and File Map

### Database

- Create `supabase/migrations/20260611170000_support_live_chat.sql`
  - Ticket extensions, presence, tags, notes, events, calendar, outbox.
  - RLS, Realtime publication, SLA RPCs, heartbeat RPC, automatic assignment.
- Create `src/lib/support/calendar/README.md`
  - Annual China holiday and make-up workday loading procedure.
- Create `supabase/tests/support_live_chat.sql`
  - pgTAP coverage for RLS, SLA and assignment functions.

### Shared Support Domain

- Create `src/lib/support/types.ts`
- Create `src/lib/support/validation.ts`
- Create `src/lib/support/sla.ts`
- Create `src/lib/support/auth.server.ts`
- Create `src/lib/support/tickets.server.ts`
- Create `src/lib/support/admin.server.ts`
- Create `src/lib/support/realtime.client.ts`
- Create `src/lib/support/notifications.server.ts`
- Create `src/lib/support/maintenance.server.ts`
- Create `src/lib/support/http.client.ts`

### Active Next.js Routes

- Create `src/app/login/page.tsx`
- Create `src/app/dashboard/layout.tsx`
- Modify `src/app/dashboard/page.tsx`
- Create `src/app/dashboard/support/page.tsx`
- Create `src/app/dashboard/admin/support/page.tsx`
- Create API handlers under `src/app/api/support/**`
- Create maintenance handlers under `src/app/api/internal/support/**`

### UI

- Create `src/components/support/support-launcher.tsx`
- Create `src/components/support/support-chat-panel.tsx`
- Create `src/components/support/ticket-conversation.tsx`
- Create `src/components/support/attachment-picker.tsx`
- Create `src/components/support/admin-agent-heartbeat.tsx`
- Create `src/components/support/admin-ticket-workbench.tsx`
- Create `src/components/support/sla-countdown.tsx`

### Observability and Operations

- Modify `src/lib/logger.server.ts`
- Modify `src/lib/mcp-route.server.ts`
- Modify `next.config.ts`
- Create `src/instrumentation.ts`
- Create `src/instrumentation-client.ts`
- Create `src/sentry.server.config.ts`
- Create `src/sentry.edge.config.ts`
- Create `src/app/global-error.tsx`
- Modify `deploy/.env.app.example`
- Modify `deploy/README.md`
- Modify `deploy/DEPLOY.md`

### Tests

- Create tests under `src/lib/support/__tests__/`
- Create component tests under `src/components/support/__tests__/`
- Create `tests/e2e/support-live-chat.spec.ts`
- Modify `src/lib/__tests__/next-architecture-guards.test.ts`

---

## Milestone 1: Active Authentication and Durable Ticket Foundation

### Task 1: Install Production Integrations and Declare Environment Contract

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `deploy/.env.app.example`
- Test: `src/lib/__tests__/next-architecture-guards.test.ts`

- [ ] **Step 1: Add a failing architecture test for required dependencies and environment documentation**

Add to `src/lib/__tests__/next-architecture-guards.test.ts`:

```ts
it("declares support observability and notification dependencies", () => {
  const pkg = JSON.parse(read("package.json")) as {
    dependencies: Record<string, string>;
  };
  const env = read("deploy/.env.app.example");

  expect(pkg.dependencies["@sentry/nextjs"]).toBeDefined();
  expect(pkg.dependencies.resend).toBeDefined();
  for (const key of [
    "NEXT_PUBLIC_SENTRY_DSN",
    "SENTRY_AUTH_TOKEN",
    "SENTRY_ORG",
    "SENTRY_PROJECT",
    "RESEND_API_KEY",
    "SUPPORT_EMAIL_FROM",
    "SUPPORT_N8N_WEBHOOK_URL",
    "SUPPORT_N8N_WEBHOOK_SECRET",
    "SUPPORT_CRON_SECRET",
  ]) {
    expect(env).toContain(key);
  }
});
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
npm.cmd test -- src/lib/__tests__/next-architecture-guards.test.ts
```

Expected: FAIL because Sentry, Resend and support environment variables are absent.

- [ ] **Step 3: Install supported SDKs**

Run:

```powershell
npm.cmd install @sentry/nextjs resend
```

Expected: `package.json` and `package-lock.json` include both dependencies.

- [ ] **Step 4: Document server-only and public variables**

Append to `deploy/.env.app.example`:

```ini
# Support observability
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=
SENTRY_ORG=
SENTRY_PROJECT=
SENTRY_TRACES_SAMPLE_RATE=0.05

# Support email and automation
RESEND_API_KEY=
SUPPORT_EMAIL_FROM=support@n8nworkflow.com
SUPPORT_N8N_WEBHOOK_URL=
SUPPORT_N8N_WEBHOOK_SECRET=

# Bearer token used only by VPS cron when calling internal maintenance routes.
SUPPORT_CRON_SECRET=
```

Do not add real values to tracked files.

- [ ] **Step 5: Re-run the architecture test**

Run:

```powershell
npm.cmd test -- src/lib/__tests__/next-architecture-guards.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit when Git metadata is restored**

```bash
git add package.json package-lock.json deploy/.env.app.example src/lib/__tests__/next-architecture-guards.test.ts
git commit -m "chore(support): add notification and observability dependencies"
```

Current workspace note: `D:\n8nmcp` is not presently recognized as a Git repository, so execution must skip commits until `.git` is restored.

---

### Task 2: Create the Support Schema, RLS and Realtime Publication

**Files:**
- Create: `supabase/migrations/20260611170000_support_live_chat.sql`
- Create: `supabase/tests/support_live_chat.sql`

- [ ] **Step 1: Write failing pgTAP assertions**

Create `supabase/tests/support_live_chat.sql`:

```sql
begin;
select plan(16);

select has_column('public', 'support_tickets', 'source');
select has_column('public', 'support_tickets', 'first_response_due_at');
select has_column('public', 'support_tickets', 'first_responded_at');
select has_column('public', 'support_tickets', 'sla_breached_at');
select has_column('public', 'support_tickets', 'sentry_event_id');
select has_column('public', 'support_tickets', 'mcp_request_id');

select has_table('public', 'support_agent_presence');
select has_table('public', 'support_ticket_tags');
select has_table('public', 'support_ticket_internal_notes');
select has_table('public', 'support_ticket_events');
select has_table('public', 'support_calendar_days');
select has_table('public', 'support_notification_outbox');

select has_function('public', 'support_add_working_minutes', array['timestamptz', 'integer']);
select has_function('public', 'support_agent_heartbeat', array[]::text[]);
select has_function('public', 'support_assign_ticket', array['uuid']);
select has_function('public', 'support_mark_first_response', array['uuid', 'uuid']);

select * from finish();
rollback;
```

- [ ] **Step 2: Run database tests and verify they fail**

Run:

```powershell
supabase db reset
supabase test db
```

Expected: FAIL because the new columns, tables and functions do not exist.

- [ ] **Step 3: Create enums and extend tickets**

Start `supabase/migrations/20260611170000_support_live_chat.sql` with:

```sql
create type public.support_ticket_source as enum ('ticket_form', 'live_chat');
create type public.support_presence_status as enum ('online', 'away');
create type public.support_calendar_kind as enum ('holiday', 'makeup_workday');
create type public.support_outbox_channel as enum ('resend', 'n8n');
create type public.support_outbox_status as enum ('pending', 'processing', 'sent', 'failed');

alter table public.support_tickets
  add column source public.support_ticket_source not null default 'ticket_form',
  add column first_response_due_at timestamptz,
  add column first_responded_at timestamptz,
  add column resolved_due_at timestamptz,
  add column sla_breached_at timestamptz,
  add column sentry_event_id text check (char_length(sentry_event_id) <= 128),
  add column mcp_request_id text check (char_length(mcp_request_id) <= 128);

create index idx_support_tickets_assignment
  on public.support_tickets(assigned_to, status, first_response_due_at);
create index idx_support_tickets_sla
  on public.support_tickets(first_response_due_at)
  where first_responded_at is null and status not in ('resolved', 'closed');
```

- [ ] **Step 4: Create operational tables**

Add:

```sql
create table public.support_agent_presence (
  agent_id uuid primary key references auth.users(id) on delete cascade,
  status public.support_presence_status not null default 'online',
  last_heartbeat_at timestamptz not null default now(),
  last_assigned_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.support_ticket_tags (
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  tag text not null check (char_length(tag) between 1 and 40),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (ticket_id, tag)
);

create table public.support_ticket_internal_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  body text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  actor_id uuid references auth.users(id),
  event_type text not null check (char_length(event_type) between 1 and 80),
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.support_calendar_days (
  day date primary key,
  kind public.support_calendar_kind not null,
  name text not null check (char_length(name) between 1 and 100)
);

create table public.support_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.support_tickets(id) on delete cascade,
  channel public.support_outbox_channel not null,
  event_type text not null,
  payload jsonb not null,
  idempotency_key text not null unique,
  status public.support_outbox_status not null default 'pending',
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index idx_support_outbox_pending
  on public.support_notification_outbox(status, next_attempt_at);
```

- [ ] **Step 5: Add strict RLS**

Enable RLS on every new table. Policies must enforce:

```sql
-- Presence: admins only.
create policy support_presence_admin_select
on public.support_agent_presence for select to authenticated
using (public.has_role(auth.uid(), 'admin'));

-- Tags/events: ticket owner may read safe public events/tags; only admins write.
-- Internal notes and outbox: admins only; outbox is normally accessed via service role.
```

Do not expose internal-note rows or outbox payloads to ticket owners. Use separate
policies rather than relying on UI filtering.

- [ ] **Step 6: Add Realtime tables**

```sql
alter table public.support_tickets replica identity full;
alter table public.support_ticket_replies replica identity full;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_tickets'
  ) then
    alter publication supabase_realtime add table public.support_tickets;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_ticket_replies'
  ) then
    alter publication supabase_realtime add table public.support_ticket_replies;
  end if;
end $$;
```

- [ ] **Step 7: Re-run database tests**

Run:

```powershell
supabase db reset
supabase test db
```

Expected: schema assertions pass; function assertions remain failing until Task 3.

- [ ] **Step 8: Commit when Git is available**

```bash
git add supabase/migrations/20260611170000_support_live_chat.sql supabase/tests/support_live_chat.sql
git commit -m "feat(support): add live support schema and policies"
```

---

### Task 3: Implement China Business-Hours SLA Functions

**Files:**
- Modify: `supabase/migrations/20260611170000_support_live_chat.sql`
- Modify: `supabase/tests/support_live_chat.sql`
- Create: `src/lib/support/sla.ts`
- Create: `src/lib/support/calendar/README.md`
- Create: `src/lib/support/__tests__/sla.test.ts`

- [ ] **Step 1: Add failing TypeScript SLA tests**

Create `src/lib/support/__tests__/sla.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addWorkingMinutes } from "../sla";

const holidays = new Map<string, "holiday" | "makeup_workday">([
  ["2026-10-01", "holiday"],
  ["2026-10-10", "makeup_workday"],
]);

describe("addWorkingMinutes", () => {
  it("rolls after-hours work to the next weekday", () => {
    expect(
      addWorkingMinutes("2026-06-12T10:30:00.000Z", 60, holidays),
    ).toBe("2026-06-15T02:00:00.000Z");
  });

  it("skips a configured holiday", () => {
    expect(
      addWorkingMinutes("2026-09-30T09:00:00.000Z", 120, holidays),
    ).toBe("2026-10-02T02:00:00.000Z");
  });

  it("counts a weekend make-up workday", () => {
    expect(
      addWorkingMinutes("2026-10-09T09:00:00.000Z", 120, holidays),
    ).toBe("2026-10-10T02:00:00.000Z");
  });
});
```

The ISO timestamps are UTC representations of Asia/Shanghai business time.

- [ ] **Step 2: Run the test and verify it fails**

```powershell
npm.cmd test -- src/lib/support/__tests__/sla.test.ts
```

Expected: FAIL because `sla.ts` does not exist.

- [ ] **Step 3: Implement a pure TypeScript mirror**

Create `src/lib/support/sla.ts` exporting:

```ts
export type CalendarOverrides = ReadonlyMap<string, "holiday" | "makeup_workday">;

export const SLA_MINUTES = {
  urgent: 30,
  high: 120,
  normal: 480,
  low: 960,
} as const;

export function addWorkingMinutes(
  startIso: string,
  minutes: number,
  overrides: CalendarOverrides,
): string {
  // Iterate in Asia/Shanghai wall-clock minutes.
  // Work only between 09:00 inclusive and 18:00 exclusive.
  // A holiday override always skips; a makeup_workday override always works.
  // Return a UTC ISO string.
}
```

Implement the body without adding a timezone dependency: use `Intl.DateTimeFormat`
with `timeZone: "Asia/Shanghai"` for wall-clock parts and small bounded minute
steps. This is acceptable for ticket creation volume and gives a directly
testable reference for the SQL implementation.

- [ ] **Step 4: Add equivalent SQL functions**

Add to the migration:

```sql
create or replace function public.support_is_working_day(_day date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1 from public.support_calendar_days
      where day = _day and kind = 'holiday'
    ) then false
    when exists (
      select 1 from public.support_calendar_days
      where day = _day and kind = 'makeup_workday'
    ) then true
    else extract(isodow from _day) between 1 and 5
  end
$$;

create or replace function public.support_add_working_minutes(
  _start timestamptz,
  _minutes integer
) returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cursor_local timestamp := _start at time zone 'Asia/Shanghai';
  remaining integer := greatest(_minutes, 0);
begin
  while remaining > 0 loop
    if public.support_is_working_day(cursor_local::date)
       and cursor_local::time >= time '09:00'
       and cursor_local::time < time '18:00' then
      cursor_local := cursor_local + interval '1 minute';
      remaining := remaining - 1;
    else
      cursor_local := cursor_local + interval '1 minute';
    end if;
  end loop;
  return cursor_local at time zone 'Asia/Shanghai';
end
$$;
```

Revoke direct execution from `anon`; grant to `authenticated` only where needed,
and prefer server/service-role invocation for ticket creation.

- [ ] **Step 5: Document and perform the annual calendar import**

Create `src/lib/support/calendar/README.md` with this operating contract:

```markdown
# China Support Calendar

SLA uses normal Monday-Friday workdays unless `support_calendar_days` overrides
a date. Before enabling support in a calendar year:

1. Obtain that year's State Council General Office holiday notice from
   `https://www.gov.cn/zhengce/`.
2. Record every full non-working date as `holiday`.
3. Record every official weekend make-up workday as `makeup_workday`.
4. Load the rows with the idempotent SQL below.
5. Run the verification query and archive the source URL in the deployment log.

```sql
insert into public.support_calendar_days(day, kind, name)
values
  ('2026-01-01', 'holiday', 'New Year example')
on conflict (day) do update
set kind = excluded.kind, name = excluded.name;
```

Replace the example transaction with the complete reviewed annual notice in the
production database. Calendar rows are operational data because government
corrections must be applicable without rewriting migration history.

Verification:

```sql
select day, kind, name
from public.support_calendar_days
where day between date_trunc('year', now())::date
              and (date_trunc('year', now()) + interval '1 year - 1 day')::date
order by day;
```

Support remains disabled until two maintainers review the current-year rows.
Never infer make-up workdays from previous years.
```

The implementation task includes loading the reviewed current-year rows into
the target Supabase project and saving the official source URL in the deployment
record. The schema migration intentionally does not hard-code mutable calendar
operations data.

- [ ] **Step 6: Extend pgTAP with exact deadline assertions**

Add assertions for:

- Friday 17:30 + 60 minutes.
- Holiday skip.
- Make-up Saturday.
- Urgent/high/normal/low minute values.

- [ ] **Step 7: Run all SLA tests**

```powershell
npm.cmd test -- src/lib/support/__tests__/sla.test.ts
supabase db reset
supabase test db
```

Expected: PASS.

- [ ] **Step 8: Commit when Git is available**

```bash
git add supabase/migrations/20260611170000_support_live_chat.sql supabase/tests/support_live_chat.sql src/lib/support/sla.ts src/lib/support/calendar/README.md src/lib/support/__tests__/sla.test.ts
git commit -m "feat(support): add China business-hours SLA"
```

---

### Task 4: Implement Presence Heartbeat and Transactional Assignment

**Files:**
- Modify: `supabase/migrations/20260611170000_support_live_chat.sql`
- Modify: `supabase/tests/support_live_chat.sql`
- Create: `src/lib/support/types.ts`

- [ ] **Step 1: Add failing pgTAP cases**

Create three admin users in test fixtures, insert presence rows with equal active
loads, and assert:

```sql
select is(
  public.support_assign_ticket(:ticket_1),
  :agent_with_oldest_last_assigned,
  'ties use oldest last_assigned_at'
);

select is(
  public.support_assign_ticket(:ticket_2),
  :least_loaded_agent,
  'least-loaded online agent wins'
);

select is(
  public.support_assign_ticket(:ticket_3),
  null,
  'no active heartbeat leaves ticket unassigned'
);
```

- [ ] **Step 2: Run pgTAP and verify failure**

```powershell
supabase db reset
supabase test db
```

Expected: FAIL because assignment RPCs do not exist.

- [ ] **Step 3: Add the heartbeat RPC**

```sql
create or replace function public.support_agent_heartbeat()
returns public.support_agent_presence
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.support_agent_presence;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin required';
  end if;

  insert into public.support_agent_presence(agent_id, status, last_heartbeat_at, updated_at)
  values (auth.uid(), 'online', now(), now())
  on conflict (agent_id) do update
    set status = 'online',
        last_heartbeat_at = now(),
        updated_at = now()
  returning * into row_out;

  return row_out;
end
$$;
```

- [ ] **Step 4: Add the assignment RPC with row locking**

```sql
create or replace function public.support_assign_ticket(_ticket_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_agent uuid;
begin
  select p.agent_id
    into selected_agent
  from public.support_agent_presence p
  where p.status = 'online'
    and p.last_heartbeat_at >= now() - interval '90 seconds'
  order by (
    select count(*)
    from public.support_tickets t
    where t.assigned_to = p.agent_id
      and t.status in ('open', 'in_progress', 'waiting_user')
  ), p.last_assigned_at nulls first, p.agent_id
  for update skip locked
  limit 1;

  if selected_agent is null then
    return null;
  end if;

  update public.support_tickets
  set assigned_to = selected_agent,
      status = case when status = 'open' then 'in_progress' else status end
  where id = _ticket_id and assigned_to is null;

  if not found then
    select assigned_to into selected_agent
    from public.support_tickets where id = _ticket_id;
    return selected_agent;
  end if;

  update public.support_agent_presence
  set last_assigned_at = now(), updated_at = now()
  where agent_id = selected_agent;

  insert into public.support_ticket_events(ticket_id, actor_id, event_type, payload)
  values (_ticket_id, selected_agent, 'assigned', jsonb_build_object('agentId', selected_agent));

  return selected_agent;
end
$$;
```

Restrict execution so ordinary users cannot choose arbitrary tickets. Ticket
creation should invoke assignment through a service-role server path.

- [ ] **Step 5: Add first-response RPC**

`support_mark_first_response(ticket_id, agent_id)` must atomically set
`first_responded_at` only when null and append one `first_response` event.

- [ ] **Step 6: Define shared types**

Create `src/lib/support/types.ts` with exact unions and rows:

```ts
export type TicketSource = "ticket_form" | "live_chat";
export type TicketPriority = "low" | "normal" | "high" | "urgent";
export type TicketStatus = "open" | "in_progress" | "waiting_user" | "resolved" | "closed";
export type SupportQueue = "unassigned" | "mine" | "waiting_user" | "sla_due" | "sla_breached" | "closed";

export type TicketAttachment = {
  path: string;
  name: string;
  size: number;
  type?: string;
  expiresAt: string;
};
```

- [ ] **Step 7: Run database tests**

```powershell
supabase db reset
supabase test db
```

Expected: all assignment, heartbeat and first-response tests pass.

- [ ] **Step 8: Commit when Git is available**

```bash
git add supabase/migrations/20260611170000_support_live_chat.sql supabase/tests/support_live_chat.sql src/lib/support/types.ts
git commit -m "feat(support): add agent presence and automatic assignment"
```

---

### Task 5: Add Active Next.js Authentication and API Authorization

**Files:**
- Create: `src/lib/support/auth.server.ts`
- Create: `src/lib/support/http.client.ts`
- Create: `src/components/auth-provider.tsx`
- Create: `src/app/login/page.tsx`
- Create: `src/app/dashboard/layout.tsx`
- Modify: `src/app/layout.tsx`
- Test: `src/lib/support/__tests__/auth.server.test.ts`

- [ ] **Step 1: Write failing bearer-auth tests**

Mock `supabaseAdmin.auth.getUser` and `user_roles`, then assert:

```ts
await expect(requireSupportUser(requestWithoutBearer)).rejects.toMatchObject({ status: 401 });
await expect(requireSupportUser(validRequest)).resolves.toMatchObject({ userId: "user-1" });
await expect(requireSupportAdmin(nonAdminRequest)).rejects.toMatchObject({ status: 403 });
```

- [ ] **Step 2: Run the test and verify failure**

```powershell
npm.cmd test -- src/lib/support/__tests__/auth.server.test.ts
```

- [ ] **Step 3: Implement server authorization**

Create `src/lib/support/auth.server.ts`:

```ts
import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function requireSupportUser(request: Request) {
  const value = request.headers.get("authorization");
  if (!value?.startsWith("Bearer ")) {
    throw new Response("Unauthorized", { status: 401 });
  }
  const token = value.slice(7);
  const { data, error } = await supabaseAdmin.auth.getUser(token);
  if (error || !data.user) throw new Response("Unauthorized", { status: 401 });
  return { userId: data.user.id, email: data.user.email ?? null };
}

export async function requireSupportAdmin(request: Request) {
  const user = await requireSupportUser(request);
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.userId)
    .eq("role", "admin")
    .maybeSingle();
  if (!data) throw new Response("Forbidden", { status: 403 });
  return user;
}
```

- [ ] **Step 4: Implement authenticated browser fetch**

Create `src/lib/support/http.client.ts`:

```ts
import { supabase } from "@/integrations/supabase/client";

export async function supportFetch<T>(url: string, init: RequestInit = {}): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Authentication required");
  const response = await fetch(url, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}
```

- [ ] **Step 5: Restore active App Router authentication**

Implement:

- `AuthProvider` subscribing to `supabase.auth.onAuthStateChange`.
- `/login` using `signInWithPassword`.
- `src/app/dashboard/layout.tsx` as a client auth gate that redirects to `/login`.
- Mount `AuthProvider` once in `src/app/layout.tsx`.

Do not import anything from `src/legacy-routes`.

- [ ] **Step 6: Run unit tests and build**

```powershell
npm.cmd test -- src/lib/support/__tests__/auth.server.test.ts
npm.cmd run build
```

Expected: PASS and Next.js build succeeds.

- [ ] **Step 7: Commit when Git is available**

```bash
git add src/lib/support/auth.server.ts src/lib/support/http.client.ts src/components/auth-provider.tsx src/app/login/page.tsx src/app/dashboard/layout.tsx src/app/layout.tsx src/lib/support/__tests__/auth.server.test.ts
git commit -m "feat(auth): restore active dashboard authentication"
```

---

## Milestone 2: Ticket APIs, Realtime, Notifications and Observability

### Task 6: Implement Ticket Domain Services and User APIs

**Files:**
- Create: `src/lib/support/validation.ts`
- Create: `src/lib/support/tickets.server.ts`
- Create: `src/app/api/support/tickets/route.ts`
- Create: `src/app/api/support/tickets/[ticketId]/route.ts`
- Create: `src/app/api/support/tickets/[ticketId]/replies/route.ts`
- Create: `src/app/api/support/tickets/[ticketId]/attachments/route.ts`
- Test: `src/lib/support/__tests__/tickets.server.test.ts`

- [ ] **Step 1: Write failing validation and service tests**

Test:

- Six attachments are rejected.
- An 11 MB attachment is rejected.
- Paths outside `${userId}/${ticketId}/` are rejected.
- `live_chat` creation inserts the first reply, SLA deadline and outbox rows.
- A user cannot read another user's ticket.
- Admin replies mark first response; automated replies do not.

- [ ] **Step 2: Run tests and verify failure**

```powershell
npm.cmd test -- src/lib/support/__tests__/tickets.server.test.ts
```

- [ ] **Step 3: Implement validation schemas**

Create `src/lib/support/validation.ts`:

```ts
import { z } from "zod";

export const AttachmentSchema = z.object({
  path: z.string().min(1).max(512),
  name: z.string().min(1).max(255),
  size: z.number().int().min(1).max(10 * 1024 * 1024),
  type: z.string().max(120).optional(),
  expiresAt: z.string().datetime(),
});

export const CreateTicketSchema = z.object({
  title: z.string().trim().min(3).max(200),
  description: z.string().trim().min(1).max(10_000),
  category: z.enum(["bug", "feature_request", "billing", "account", "other"]),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  source: z.enum(["ticket_form", "live_chat"]),
  sentryEventId: z.string().max(128).optional(),
  mcpRequestId: z.string().max(128).optional(),
  attachments: z.array(AttachmentSchema).max(5).default([]),
});
```

- [ ] **Step 4: Implement ticket transactions**

`createSupportTicket()` must:

1. Insert the ticket.
2. Compute `first_response_due_at`.
3. Insert the first reply for live chat.
4. Invoke `support_assign_ticket`.
5. Insert idempotent Resend and n8n outbox entries.
6. Log identifiers only.

Use a database RPC for atomic creation if separate PostgREST writes cannot
guarantee transactionality.

- [ ] **Step 5: Implement route handlers**

Each handler:

- Uses `requireSupportUser`.
- Validates with Zod.
- Returns JSON with no secret fields.
- Generates/propagates `x-request-id`.
- Maps expected validation/auth failures to 4xx responses.
- Captures unexpected exceptions in Sentry and returns the Sentry event ID.

- [ ] **Step 6: Enforce attachment ownership before signing URLs**

The attachment route must first verify ticket ownership/admin access, then sign
only paths actually recorded on that ticket or its replies.

- [ ] **Step 7: Run tests and build**

```powershell
npm.cmd test -- src/lib/support/__tests__/tickets.server.test.ts
npm.cmd run build
```

- [ ] **Step 8: Commit when Git is available**

```bash
git add src/lib/support/validation.ts src/lib/support/tickets.server.ts src/app/api/support src/lib/support/__tests__/tickets.server.test.ts
git commit -m "feat(support): add authenticated ticket APIs"
```

---

### Task 7: Implement Admin Queue, Notes, Tags, Transfer and Heartbeat APIs

**Files:**
- Create: `src/lib/support/admin.server.ts`
- Create: `src/app/api/support/admin/heartbeat/route.ts`
- Create: `src/app/api/support/admin/agents/route.ts`
- Create: `src/app/api/support/admin/tickets/route.ts`
- Create: `src/app/api/support/admin/tickets/[ticketId]/route.ts`
- Create: `src/app/api/support/admin/tickets/[ticketId]/notes/route.ts`
- Create: `src/app/api/support/admin/tickets/[ticketId]/tags/route.ts`
- Test: `src/lib/support/__tests__/admin.server.test.ts`

- [ ] **Step 1: Write failing admin service tests**

Cover:

- Heartbeat calls the RPC.
- Queue filters produce exact database predicates.
- Transfer appends an event.
- Priority changes recompute SLA only before first response.
- Internal notes never appear in the user ticket DTO.
- Non-admin requests return 403.

- [ ] **Step 2: Run tests and verify failure**

```powershell
npm.cmd test -- src/lib/support/__tests__/admin.server.test.ts
```

- [ ] **Step 3: Implement queue query contracts**

`listAdminTickets(queue, agentId)` must support:

```ts
type SupportQueue =
  | "unassigned"
  | "mine"
  | "waiting_user"
  | "sla_due"
  | "sla_breached"
  | "closed";
```

Define `sla_due` as first-response deadline within 30 working/clock minutes and
not yet responded; define `sla_breached` by `sla_breached_at is not null`.

- [ ] **Step 4: Implement mutations**

All mutations append `support_ticket_events` with old/new values:

- Assign/transfer.
- Status.
- Priority.
- Add/remove tag.
- Add/update internal note.

- [ ] **Step 5: Implement heartbeat**

The heartbeat route calls `support_agent_heartbeat()`. After heartbeat, attempt
to assign a bounded batch of unassigned open tickets so offline tickets enter
the queue when the first agent returns.

- [ ] **Step 6: Run tests**

```powershell
npm.cmd test -- src/lib/support/__tests__/admin.server.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit when Git is available**

```bash
git add src/lib/support/admin.server.ts src/app/api/support/admin src/lib/support/__tests__/admin.server.test.ts
git commit -m "feat(support): add agent queue and ticket operations"
```

---

### Task 8: Add Realtime Subscription Helpers with Reconnect Recovery

**Files:**
- Create: `src/lib/support/realtime.client.ts`
- Test: `src/lib/support/__tests__/realtime.client.test.ts`

- [ ] **Step 1: Write failing subscription tests**

Mock the Supabase channel API and assert:

- Ticket reply subscription filters on `ticket_id=eq.<id>`.
- Ticket status subscription filters on `id=eq.<id>`.
- Unsubscribe removes the channel.
- Reconnect callback requests messages after `lastSeenAt`.

- [ ] **Step 2: Run and verify failure**

```powershell
npm.cmd test -- src/lib/support/__tests__/realtime.client.test.ts
```

- [ ] **Step 3: Implement narrow subscriptions**

Export:

```ts
export function subscribeToTicket(
  ticketId: string,
  handlers: {
    onReply: () => void;
    onTicket: () => void;
    onReconnect: () => void;
  },
): () => void;
```

Use one channel for the opened ticket. Do not subscribe to all replies or use
typing broadcasts.

- [ ] **Step 4: Implement admin queue subscription**

Use one additional channel for ticket inserts/updates. The callback invalidates
the active queue query rather than applying untrusted payloads directly.

- [ ] **Step 5: Run tests**

```powershell
npm.cmd test -- src/lib/support/__tests__/realtime.client.test.ts
```

- [ ] **Step 6: Commit when Git is available**

```bash
git add src/lib/support/realtime.client.ts src/lib/support/__tests__/realtime.client.test.ts
git commit -m "feat(support): add narrow realtime subscriptions"
```

---

### Task 9: Implement Resend, Signed n8n Webhooks and the Outbox Worker

**Files:**
- Create: `src/lib/support/notifications.server.ts`
- Create: `src/app/api/internal/support/process-outbox/route.ts`
- Test: `src/lib/support/__tests__/notifications.server.test.ts`

- [ ] **Step 1: Write failing notification tests**

Assert:

- Missing `RESEND_API_KEY` marks a Resend row failed without crashing chat.
- n8n requests contain timestamp and HMAC SHA-256 signature.
- Payload excludes body, attachments and email contents.
- Successful rows become `sent`.
- Failures increment attempts and schedule exponential retry.
- Reprocessing an already sent idempotency key sends nothing.

- [ ] **Step 2: Run and verify failure**

```powershell
npm.cmd test -- src/lib/support/__tests__/notifications.server.test.ts
```

- [ ] **Step 3: Implement safe payloads**

Use this n8n shape:

```ts
type N8nSupportEvent = {
  eventType: "ticket.created" | "ticket.urgent" | "sla.due_soon" | "sla.breached";
  ticketId: string;
  priority: "low" | "normal" | "high" | "urgent";
  status: string;
  assignedTo: string | null;
  firstResponseDueAt: string | null;
  requestId: string;
};
```

Do not include user messages or attachment URLs.

- [ ] **Step 4: Sign n8n requests**

```ts
const timestamp = Math.floor(Date.now() / 1000).toString();
const body = JSON.stringify(event);
const signature = createHmac("sha256", secret)
  .update(`${timestamp}.${body}`)
  .digest("hex");
```

Send `x-support-timestamp` and `x-support-signature`.

- [ ] **Step 5: Implement the protected worker route**

The route must:

- Require `Authorization: Bearer ${SUPPORT_CRON_SECRET}` using constant-time comparison.
- Claim at most 25 pending rows using a database RPC with `for update skip locked`.
- Process rows independently.
- Return counts only: `{ claimed, sent, failed }`.

- [ ] **Step 6: Run tests**

```powershell
npm.cmd test -- src/lib/support/__tests__/notifications.server.test.ts
```

- [ ] **Step 7: Commit when Git is available**

```bash
git add src/lib/support/notifications.server.ts src/app/api/internal/support/process-outbox/route.ts src/lib/support/__tests__/notifications.server.test.ts
git commit -m "feat(support): add reliable email and n8n notifications"
```

---

### Task 10: Add SLA Scan and Attachment Retention Maintenance

**Files:**
- Create: `src/lib/support/maintenance.server.ts`
- Create: `src/app/api/internal/support/run-maintenance/route.ts`
- Test: `src/lib/support/__tests__/maintenance.server.test.ts`
- Modify: `deploy/README.md`
- Modify: `deploy/DEPLOY.md`

- [ ] **Step 1: Write failing maintenance tests**

Cover:

- Due-soon event is created once.
- Breach timestamp and event are created once.
- Resolved/closed tickets are ignored.
- Storage objects older than 180 days are removed.
- Safe metadata remains in an attachment-expired event.
- Maximum cleanup batch prevents long route execution.

- [ ] **Step 2: Run and verify failure**

```powershell
npm.cmd test -- src/lib/support/__tests__/maintenance.server.test.ts
```

- [ ] **Step 3: Implement SLA maintenance**

Use SQL updates with `where first_responded_at is null` and idempotent event keys.
Do not run one timer per ticket.

- [ ] **Step 4: Implement attachment cleanup**

Process at most 100 expired objects per run. Remove the Storage object, update
ticket/reply attachment JSON, and append an event with:

```json
{
  "pathHash": "sha256...",
  "name": "screenshot.png",
  "expiredAt": "2026-12-08T00:00:00.000Z"
}
```

Do not retain signed URLs.

- [ ] **Step 5: Protect the route with the same cron secret**

The route runs:

1. SLA scan.
2. Attachment cleanup.
3. A bounded outbox processing pass.

- [ ] **Step 6: Document VPS cron**

Add:

```cron
* * * * * curl -fsS -X POST -H "Authorization: Bearer $SUPPORT_CRON_SECRET" https://dashboard.n8nworkflow.com/api/internal/support/process-outbox >/dev/null
*/5 * * * * curl -fsS -X POST -H "Authorization: Bearer $SUPPORT_CRON_SECRET" https://dashboard.n8nworkflow.com/api/internal/support/run-maintenance >/dev/null
```

Document loading `SUPPORT_CRON_SECRET` from a root-readable environment file,
not writing it directly into world-readable crontab text.

- [ ] **Step 7: Run tests**

```powershell
npm.cmd test -- src/lib/support/__tests__/maintenance.server.test.ts
```

- [ ] **Step 8: Commit when Git is available**

```bash
git add src/lib/support/maintenance.server.ts src/app/api/internal/support/run-maintenance/route.ts src/lib/support/__tests__/maintenance.server.test.ts deploy/README.md deploy/DEPLOY.md
git commit -m "feat(support): add SLA and attachment maintenance"
```

---

### Task 11: Integrate Sentry and Request Correlation

**Files:**
- Modify: `next.config.ts`
- Create: `src/instrumentation.ts`
- Create: `src/instrumentation-client.ts`
- Create: `src/sentry.server.config.ts`
- Create: `src/sentry.edge.config.ts`
- Create: `src/app/global-error.tsx`
- Modify: `src/lib/logger.server.ts`
- Modify: `src/lib/mcp-route.server.ts`
- Test: `src/lib/support/__tests__/correlation.test.ts`

- [ ] **Step 1: Write failing correlation tests**

Assert:

- Logger redacts keys named `authorization`, `cookie`, `apiKey`, `body`, and `attachments`.
- `mcpPost` creates or accepts `x-request-id`.
- MCP logs include `request_id`.
- Support API error DTO may contain `sentryEventId` but never a stack.

- [ ] **Step 2: Run and verify failure**

```powershell
npm.cmd test -- src/lib/support/__tests__/correlation.test.ts
```

- [ ] **Step 3: Configure Sentry for App Router**

Follow the current official Next.js manual setup:

- Wrap `nextConfig` with `withSentryConfig`.
- Initialize client/server/edge SDK files.
- Export `onRequestError = Sentry.captureRequestError`.
- Add `global-error.tsx`.

Configuration requirements:

```ts
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  sendDefaultPii: false,
  enableLogs: true,
  tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.05"),
  beforeSend(event) {
    // Remove authorization, cookies, request bodies, chat text and attachment metadata.
    return event;
  },
});
```

Do not enable Session Replay in the first release because support conversations
may contain sensitive content.

- [ ] **Step 4: Harden the logger**

Add recursive redaction and a `requestId()` helper:

```ts
export function getRequestId(request: Request): string {
  return request.headers.get("x-request-id")?.slice(0, 128) || crypto.randomUUID();
}
```

Use camelCase fields in support code and preserve existing snake_case MCP fields
only where changing them would break downstream log queries.

- [ ] **Step 5: Add MCP correlation**

Generate one request ID per HTTP request and add it to every MCP gateway log and
the response `x-request-id` header. Include it in safe tool-error output so a
user can paste it into the support widget.

- [ ] **Step 6: Run tests and build**

```powershell
npm.cmd test -- src/lib/support/__tests__/correlation.test.ts
npm.cmd run build
```

- [ ] **Step 7: Commit when Git is available**

```bash
git add next.config.ts src/instrumentation.ts src/instrumentation-client.ts src/sentry.server.config.ts src/sentry.edge.config.ts src/app/global-error.tsx src/lib/logger.server.ts src/lib/mcp-route.server.ts src/lib/support/__tests__/correlation.test.ts
git commit -m "feat(observability): add Sentry and request correlation"
```

---

## Milestone 3: User Chat and Agent Workbench

### Task 12: Build the Authenticated Smart Support Window

**Files:**
- Create: `src/components/support/support-launcher.tsx`
- Create: `src/components/support/support-chat-panel.tsx`
- Create: `src/components/support/ticket-conversation.tsx`
- Create: `src/components/support/attachment-picker.tsx`
- Create: `src/components/support/sla-countdown.tsx`
- Modify: `src/app/dashboard/layout.tsx`
- Test: `src/components/support/__tests__/support-chat-panel.test.tsx`

- [ ] **Step 1: Write failing component tests**

Test:

- Logged-out state renders no launcher.
- Online state says agents are available.
- Offline state says the message becomes a ticket.
- First send creates a ticket and renders its number.
- Reopening restores the active ticket from local storage.
- Closing unsubscribes Realtime.
- Six files and files over 10 MB are rejected before upload.
- `sentryEventId` and `mcpRequestId` are submitted when provided.

- [ ] **Step 2: Run and verify failure**

```powershell
npm.cmd test -- src/components/support/__tests__/support-chat-panel.test.tsx
```

- [ ] **Step 3: Implement the launcher state machine**

Use explicit states:

```ts
type SupportPanelState =
  | { kind: "closed" }
  | { kind: "checking" }
  | { kind: "new"; online: boolean }
  | { kind: "conversation"; ticketId: string }
  | { kind: "error"; message: string };
```

- [ ] **Step 4: Implement active-ticket restoration**

Store only the current ticket UUID in local storage. Fetch authorization and
ticket contents from the server on reopen; never cache message bodies locally.

- [ ] **Step 5: Implement attachment upload**

Upload paths must be:

```text
<user_id>/<ticket_id>/<uuid>-<sanitized_filename>
```

Set `expiresAt` to creation time plus 180 days. Client checks are convenience;
server checks remain authoritative.

- [ ] **Step 6: Mount only inside authenticated dashboard**

Add `<SupportLauncher />` to `src/app/dashboard/layout.tsx`, not the public root
layout. This satisfies the confirmed “logged-in users only” requirement.

- [ ] **Step 7: Run tests and build**

```powershell
npm.cmd test -- src/components/support/__tests__/support-chat-panel.test.tsx
npm.cmd run build
```

- [ ] **Step 8: Commit when Git is available**

```bash
git add src/components/support src/app/dashboard/layout.tsx
git commit -m "feat(support): add authenticated live chat window"
```

---

### Task 13: Build the User Ticket History Page

**Files:**
- Create: `src/app/dashboard/support/page.tsx`
- Modify: `src/app/dashboard/page.tsx`
- Test: `src/components/support/__tests__/ticket-conversation.test.tsx`

- [ ] **Step 1: Write failing page/component tests**

Cover:

- List, status filter and text search.
- Detail view and replies.
- Live invalidation on new replies.
- Assigned agent and SLA expectation.
- Closed ticket blocks reply.
- Correlation IDs render only when present.

- [ ] **Step 2: Run and verify failure**

```powershell
npm.cmd test -- src/components/support/__tests__/ticket-conversation.test.tsx
```

- [ ] **Step 3: Implement `/dashboard/support`**

Use the active API and shared conversation component. Keep the page useful
without Realtime by refetching after every mutation.

- [ ] **Step 4: Link from dashboard**

Add a Support module/link to `src/app/dashboard/page.tsx`.

- [ ] **Step 5: Run tests and build**

```powershell
npm.cmd test -- src/components/support/__tests__/ticket-conversation.test.tsx
npm.cmd run build
```

- [ ] **Step 6: Commit when Git is available**

```bash
git add src/app/dashboard/support/page.tsx src/app/dashboard/page.tsx src/components/support/__tests__/ticket-conversation.test.tsx
git commit -m "feat(support): add user ticket history"
```

---

### Task 14: Build the Three-Agent Workbench

**Files:**
- Create: `src/components/support/admin-agent-heartbeat.tsx`
- Create: `src/components/support/admin-ticket-workbench.tsx`
- Create: `src/app/dashboard/admin/support/page.tsx`
- Test: `src/components/support/__tests__/admin-ticket-workbench.test.tsx`

- [ ] **Step 1: Write failing workbench tests**

Cover:

- Heartbeat starts on mount every 30 seconds.
- Heartbeat pauses when document is hidden and resumes when visible.
- Queue tabs request the correct filter.
- SLA countdown highlights due-soon and breached states.
- Transfer, tags and priority updates refresh the selected ticket.
- Internal notes are visually distinct and never passed to user reply components.

- [ ] **Step 2: Run and verify failure**

```powershell
npm.cmd test -- src/components/support/__tests__/admin-ticket-workbench.test.tsx
```

- [ ] **Step 3: Implement heartbeat lifecycle**

Use `visibilitychange` and a 30-second interval. Send one heartbeat immediately
on mount and on return to visible state. Server considers the agent offline
after 90 seconds.

- [ ] **Step 4: Implement queue and detail layout**

Queue tabs:

- Unassigned.
- Mine.
- Waiting for user.
- SLA due soon.
- SLA breached.
- Closed.

Detail:

- Conversation.
- Attachments.
- User and correlation context.
- Status, priority, assignee and tags.
- Internal notes.
- Event timeline.

- [ ] **Step 5: Guard the page**

The server API remains the authority. The page should redirect or show 403 if
the current user lacks the admin role.

- [ ] **Step 6: Run tests and build**

```powershell
npm.cmd test -- src/components/support/__tests__/admin-ticket-workbench.test.tsx
npm.cmd run build
```

- [ ] **Step 7: Commit when Git is available**

```bash
git add src/components/support/admin-agent-heartbeat.tsx src/components/support/admin-ticket-workbench.tsx src/app/dashboard/admin/support/page.tsx src/components/support/__tests__/admin-ticket-workbench.test.tsx
git commit -m "feat(support): add agent support workbench"
```

---

### Task 15: End-to-End Verification and Legacy Isolation

**Files:**
- Create: `tests/e2e/support-live-chat.spec.ts`
- Modify: `playwright.config.ts`
- Modify: `src/lib/__tests__/next-architecture-guards.test.ts`
- Modify: `deploy/README.md`

- [ ] **Step 1: Add an architecture guard**

Assert active support code does not import excluded legacy code:

```ts
it("keeps production support code in the active Next.js tree", () => {
  for (const path of [
    "src/app/dashboard/support/page.tsx",
    "src/app/dashboard/admin/support/page.tsx",
    "src/lib/support/tickets.server.ts",
  ]) {
    expect(read(path)).not.toContain("legacy-routes");
  }
});
```

- [ ] **Step 2: Add Playwright web-server configuration**

Configure Playwright to start the app using a dedicated test environment:

```ts
webServer: {
  command: "npm run dev",
  url: "http://127.0.0.1:3000",
  reuseExistingServer: !process.env.CI,
  timeout: 120_000,
}
```

- [ ] **Step 3: Implement E2E scenarios**

`tests/e2e/support-live-chat.spec.ts` must cover:

1. User logs in and opens the smart support window.
2. Online agent receives automatic assignment.
3. User and agent exchange persisted messages.
4. Agent closes; a second user sees offline mode and receives a ticket number.
5. Admin adds an internal note that is absent from the user view.
6. Urgent ticket displays the 30-minute SLA.
7. Sentry event ID and MCP request ID appear in admin context.

Use dedicated seeded test users and a local Supabase instance. Do not run
against production.

- [ ] **Step 4: Run the full verification suite**

```powershell
supabase db reset
supabase test db
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:e2e -- tests/e2e/support-live-chat.spec.ts
```

Expected:

- pgTAP passes.
- Vitest passes.
- ESLint reports no errors.
- Next.js production build succeeds.
- Support E2E passes.

- [ ] **Step 5: Run Supabase advisors after applying migrations**

Using the Supabase plugin or dashboard:

- Run security advisors.
- Run performance advisors.
- Resolve missing RLS, unindexed foreign keys and expensive policy warnings.

- [ ] **Step 6: Verify production-like operations**

In staging:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $SUPPORT_CRON_SECRET" \
  https://dashboard-staging.example.com/api/internal/support/process-outbox

curl -fsS -X POST \
  -H "Authorization: Bearer $SUPPORT_CRON_SECRET" \
  https://dashboard-staging.example.com/api/internal/support/run-maintenance
```

Confirm:

- Resend receives a test email.
- n8n validates the HMAC signature.
- Sentry receives a sanitized test exception.
- No message body or attachment content appears in application logs.

- [ ] **Step 7: Document Free-plan monitoring**

Add monthly checks:

- Realtime messages warning at 1.5 million.
- Peak connections warning at 150.
- Database size warning at 400 MB.
- Storage warning at 800 MB.
- Outbox pending rows warning above 100.

- [ ] **Step 8: Commit when Git is available**

```bash
git add tests/e2e/support-live-chat.spec.ts playwright.config.ts src/lib/__tests__/next-architecture-guards.test.ts deploy/README.md
git commit -m "test(support): verify live support end to end"
```

---

## Deferred Work

The first release deliberately excludes:

- Typing indicators.
- AI auto-replies.
- Guest chat.
- Voice/video.
- Omnichannel inboxes.
- Zendesk/Chatwoot synchronization.
- Per-plan SLA differences.
- Automatic conversation summarization.

These features should not be added while executing this plan.

## Final Acceptance Criteria

- Production support code is in the active Next.js App Router tree.
- Only authenticated users can open live support.
- Starting a chat creates a durable ticket immediately.
- Three agents are assigned by least-loaded round-robin with 90-second presence expiry.
- Offline chat continues as a normal ticket.
- SLA respects Asia/Shanghai business hours, holidays and make-up workdays.
- User/admin messages update in real time with query fallback after reconnect.
- Resend and n8n failures never block ticket writes.
- Internal notes are inaccessible to ticket owners.
- Attachments enforce 10 MB, five files and 180-day retention.
- Sentry and MCP request identifiers correlate without storing raw stack traces.
- Full database, unit, build and E2E verification passes.
