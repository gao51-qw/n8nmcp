begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(141);

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
select has_column('public', 'support_notification_outbox', 'claimed_at');
select has_column('public', 'support_notification_outbox', 'lease_token');

select ok(
  (select relrowsecurity from pg_class where oid = 'public.support_agent_presence'::regclass),
  'presence has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.support_ticket_tags'::regclass),
  'tags have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.support_ticket_internal_notes'::regclass),
  'internal notes have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.support_ticket_events'::regclass),
  'events have RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.support_calendar_days'::regclass),
  'calendar has RLS enabled'
);
select ok(
  (select relrowsecurity from pg_class where oid = 'public.support_notification_outbox'::regclass),
  'outbox has RLS enabled'
);

select has_function('public', 'support_add_working_minutes', array['timestamp with time zone', 'integer']);
select has_function('public', 'support_agent_heartbeat', array['uuid']);
select has_function('public', 'support_assign_ticket', array['uuid']);
select has_function('public', 'support_mark_first_response', array['uuid', 'uuid']);
select has_function(
  'public',
  'support_admin_add_reply',
  array['uuid', 'uuid', 'text', 'jsonb']
);
select has_function('public', 'support_claim_notification_outbox', array['integer']);
select has_function('public', 'support_complete_notification_outbox', array['uuid', 'uuid']);
select has_function(
  'public',
  'support_fail_notification_outbox',
  array['uuid', 'uuid', 'text', 'integer', 'boolean']
);
select has_function(
  'public',
  'support_notification_failure_is_terminal',
  array['integer', 'boolean']
);
select results_eq(
  $$
    select status, public.support_notification_failure_is_terminal(status, false)
    from (values (400), (404), (408), (429), (500)) statuses(status)
    order by status
  $$,
  $$values
    (400, true),
    (404, true),
    (408, false),
    (429, false),
    (500, false)
  $$,
  'HTTP classification terminates permanent 4xx and retries 408, 429, and 5xx'
);
select is(
  public.support_notification_failure_is_terminal(null, false),
  false,
  'network failures without an HTTP status remain retryable'
);
select is(
  public.support_notification_failure_is_terminal(null, true),
  true,
  'configuration and validation failures are terminal'
);

select ok(
  not has_schema_privilege('public', 'public', 'create'),
  'PUBLIC cannot create objects in the public schema'
);
select ok(
  not has_schema_privilege('anon', 'public', 'create'),
  'anon cannot create objects in the public schema'
);
select ok(
  not has_schema_privilege('authenticated', 'public', 'create'),
  'authenticated cannot create objects in the public schema'
);
select ok(
  has_schema_privilege('anon', 'public', 'usage'),
  'anon retains public schema usage for normal Supabase API access'
);
select ok(
  has_schema_privilege('authenticated', 'public', 'usage'),
  'authenticated retains public schema usage for normal Supabase API access'
);
select ok(
  not exists (
    select 1
    from (
      values
        ('public.support_is_working_day(date)'::regprocedure),
        ('public.support_sla_minutes(public.ticket_priority)'::regprocedure),
        ('public.support_add_working_minutes(timestamptz, integer)'::regprocedure),
        ('public.tg_support_ticket_set_sla()'::regprocedure),
        ('public.tg_support_tickets_user_update_guard()'::regprocedure),
        ('public.support_agent_heartbeat(uuid)'::regprocedure),
        ('public.support_assign_ticket(uuid)'::regprocedure),
        ('public.support_mark_first_response(uuid, uuid)'::regprocedure),
        (
          'public.support_create_ticket(uuid, uuid, text, text, text, public.ticket_category, public.ticket_priority, public.support_ticket_source, jsonb, text, text, text)'::regprocedure
        ),
        ('public.support_require_admin_actor(uuid)'::regprocedure),
        ('public.support_admin_transfer_ticket(uuid, uuid, uuid)'::regprocedure),
        ('public.support_admin_set_status(uuid, uuid, public.ticket_status)'::regprocedure),
        ('public.support_admin_set_priority(uuid, uuid, public.ticket_priority)'::regprocedure),
        ('public.support_admin_add_tag(uuid, uuid, text)'::regprocedure),
        ('public.support_admin_remove_tag(uuid, uuid, text)'::regprocedure),
        ('public.support_admin_add_note(uuid, uuid, text)'::regprocedure),
        ('public.support_admin_update_note(uuid, uuid, uuid, text)'::regprocedure),
        ('public.support_admin_add_reply(uuid, uuid, text, jsonb)'::regprocedure),
        ('public.support_claim_notification_outbox(integer)'::regprocedure),
        ('public.support_complete_notification_outbox(uuid, uuid)'::regprocedure),
        (
          'public.support_fail_notification_outbox(uuid, uuid, text, integer, boolean)'::regprocedure
        ),
        ('public.support_scan_sla(integer)'::regprocedure),
        ('public.support_claim_expired_attachments(timestamptz, integer)'::regprocedure),
        ('public.support_complete_attachment_cleanup(text, uuid, jsonb)'::regprocedure),
        ('public.support_fail_attachment_cleanup(text)'::regprocedure),
        ('public.support_add_reply(uuid, uuid, text, jsonb, boolean)'::regprocedure)
    ) as expected(function_oid)
    join pg_proc function_definition
      on function_definition.oid = expected.function_oid
    where function_definition.prosecdef is not true
       or function_definition.proconfig is distinct from
          array['search_path=pg_catalog, public']::text[]
  ),
  'support SECURITY DEFINER functions use the hardened search_path'
);

select ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_tickets'
  ),
  'tickets are published to Realtime'
);
select ok(
  exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_ticket_replies'
  ),
  'ticket replies are published to Realtime'
);

select is(
  (select relreplident from pg_class where oid = 'public.support_tickets'::regclass),
  'f'::"char",
  'tickets use REPLICA IDENTITY FULL'
);
select is(
  (select relreplident from pg_class where oid = 'public.support_ticket_replies'::regclass),
  'f'::"char",
  'ticket replies use REPLICA IDENTITY FULL'
);

select is(
  (
    select count(*)::integer
    from public.support_calendar_days
    where day between '2026-01-01' and '2026-12-31'
      and kind = 'holiday'
  ),
  19,
  '2026 calendar seeds every weekday holiday override'
);
select is(
  (
    select array_agg(day order by day)
    from public.support_calendar_days
    where day between '2026-01-01' and '2026-12-31'
      and kind = 'holiday'
  ),
  array[
    '2026-01-01'::date, '2026-01-02'::date,
    '2026-02-16'::date, '2026-02-17'::date, '2026-02-18'::date,
    '2026-02-19'::date, '2026-02-20'::date, '2026-02-23'::date,
    '2026-04-06'::date,
    '2026-05-01'::date, '2026-05-04'::date, '2026-05-05'::date,
    '2026-06-19'::date,
    '2026-09-25'::date,
    '2026-10-01'::date, '2026-10-02'::date, '2026-10-05'::date,
    '2026-10-06'::date, '2026-10-07'::date
  ],
  '2026 weekday holiday overrides match the official notice'
);
select is(
  (
    select count(*)::integer
    from public.support_calendar_days
    where day between '2026-01-01' and '2026-12-31'
      and kind = 'makeup_workday'
  ),
  6,
  '2026 calendar seeds every weekend make-up workday'
);
select is(
  (
    select array_agg(day order by day)
    from public.support_calendar_days
    where day between '2026-01-01' and '2026-12-31'
      and kind = 'makeup_workday'
  ),
  array[
    '2026-01-04'::date,
    '2026-02-14'::date, '2026-02-28'::date,
    '2026-05-09'::date,
    '2026-09-20'::date,
    '2026-10-10'::date
  ],
  '2026 make-up workdays match the official notice'
);

select is(
  public.support_add_working_minutes('2026-06-12 17:30+08', 60),
  '2026-06-15 09:30+08'::timestamptz,
  'Friday 17:30 plus 60 working minutes rolls to Monday 09:30'
);

select is(
  public.support_add_working_minutes('2026-09-30 17:00+08', 120),
  '2026-10-08 10:00+08'::timestamptz,
  'configured holidays are skipped'
);
select is(
  public.support_add_working_minutes('2026-10-09 17:00+08', 120),
  '2026-10-10 10:00+08'::timestamptz,
  'configured weekend make-up workdays count'
);
select is(public.support_sla_minutes('urgent'::public.ticket_priority), 30, 'urgent SLA');
select is(public.support_sla_minutes('high'::public.ticket_priority), 120, 'high SLA');
select is(public.support_sla_minutes('normal'::public.ticket_priority), 480, 'normal SLA');
select is(public.support_sla_minutes('low'::public.ticket_priority), 960, 'low SLA');

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner1@example.test', '', now(), '{}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner2@example.test', '', now(), '{}', '{}', now(), now()),
  ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'owner3@example.test', '', now(), '{}', '{}', now(), now()),
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'agent1@example.test', '', now(), '{}', '{}', now(), now()),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'agent2@example.test', '', now(), '{}', '{}', now(), now()),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'agent3@example.test', '', now(), '{}', '{}', now(), now());

update public.user_roles
set role = 'admin'
where user_id::text like '20000000-%';

insert into public.support_agent_presence (
  agent_id, status, last_heartbeat_at, last_assigned_at
)
values
  ('20000000-0000-0000-0000-000000000001', 'online', now(), now() - interval '30 minutes'),
  ('20000000-0000-0000-0000-000000000002', 'online', now(), now() - interval '20 minutes'),
  ('20000000-0000-0000-0000-000000000003', 'online', now(), now() - interval '10 minutes');

create function public.support_test_fail_outbox()
returns trigger
language plpgsql
as $$
begin
  if new.ticket_id = '50000000-0000-4000-8000-000000000002'::uuid then
    raise exception 'forced outbox failure';
  end if;
  return new;
end
$$;

create trigger support_test_fail_outbox
before insert on public.support_notification_outbox
for each row execute function public.support_test_fail_outbox();

select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  $$select public.support_create_ticket(
    '50000000-0000-4000-8000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'owner1@example.test',
    'RPC live chat',
    'Created atomically',
    'bug',
    'urgent',
    'live_chat',
    '[]'::jsonb,
    null,
    null,
    'request-create-1'
  )$$,
  'create RPC succeeds for service role'
);
select is(
  (select count(*)::integer from public.support_tickets
   where id = '50000000-0000-4000-8000-000000000001'),
  1,
  'create RPC inserts exactly one ticket'
);
select is(
  (select count(*)::integer from public.support_ticket_replies
   where ticket_id = '50000000-0000-4000-8000-000000000001'),
  1,
  'live-chat create RPC inserts the initial reply'
);
select ok(
  (select first_response_due_at is not null from public.support_tickets
   where id = '50000000-0000-4000-8000-000000000001'),
  'create RPC computes the first-response SLA'
);
select ok(
  (select assigned_to is not null and status = 'in_progress'
   from public.support_tickets
   where id = '50000000-0000-4000-8000-000000000001'),
  'create RPC assigns an online agent and advances status'
);
select is(
  (select count(*)::integer from public.support_ticket_events
   where ticket_id = '50000000-0000-4000-8000-000000000001'
     and event_type = 'assigned'),
  1,
  'create RPC records assignment once'
);
select is(
  (select count(*)::integer from public.support_notification_outbox
   where ticket_id = '50000000-0000-4000-8000-000000000001'),
  2,
  'create RPC enqueues both notification channels'
);

create temporary table support_presence_before_failed_create as
select agent_id, last_assigned_at
from public.support_agent_presence;

select throws_ok(
  $$select public.support_create_ticket(
    '50000000-0000-4000-8000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'owner1@example.test',
    'Rollback create',
    'Outbox failure must roll everything back',
    'bug',
    'urgent',
    'live_chat',
    '[]'::jsonb,
    null,
    null,
    'request-create-rollback'
  )$$,
  'forced outbox failure',
  'create RPC failure rolls back the atomic operation'
);
select is(
  (select count(*)::integer from public.support_tickets
   where id = '50000000-0000-4000-8000-000000000002'),
  0,
  'failed create RPC leaves no ticket'
);
select is(
  (select count(*)::integer from public.support_ticket_replies
   where ticket_id = '50000000-0000-4000-8000-000000000002'),
  0,
  'failed create RPC leaves no initial reply'
);
select is(
  (select count(*)::integer from public.support_ticket_events
   where ticket_id = '50000000-0000-4000-8000-000000000002'),
  0,
  'failed create RPC leaves no assignment event'
);
select is(
  (select count(*)::integer from public.support_notification_outbox
   where ticket_id = '50000000-0000-4000-8000-000000000002'),
  0,
  'failed create RPC leaves no outbox rows'
);
select is(
  (
    select count(*)::integer
    from public.support_agent_presence presence
    join support_presence_before_failed_create baseline using (agent_id)
    where presence.last_assigned_at is distinct from baseline.last_assigned_at
  ),
  0,
  'failed create RPC rolls back presence last_assigned_at'
);

insert into public.support_tickets (id, user_id, title, description, status, assigned_to)
values
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Existing load A', 'Existing load A', 'in_progress', '20000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Existing load B', 'Existing load B', 'in_progress', '20000000-0000-0000-0000-000000000002'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'Existing load C', 'Existing load C', 'in_progress', '20000000-0000-0000-0000-000000000003'),
  ('40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'Tie assignment', 'Tie assignment', 'open', null),
  ('40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', 'Least-loaded assignment', 'Least-loaded assignment', 'open', null),
  ('40000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000003', 'Offline assignment', 'Offline assignment', 'open', null),
  ('40000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'First response', 'First response', 'open', null),
  ('40000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'Atomic response', 'Atomic response', 'open', null),
  ('40000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'Automated response', 'Automated response', 'open', null),
  ('40000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'Atomic rollback', 'Atomic rollback', 'open', null),
  ('40000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'Closed before assignment', 'Closed before assignment', 'closed', null),
  ('40000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000001', 'Resolved before assignment', 'Resolved before assignment', 'resolved', null);

select ok(
  (
    select first_response_due_at is not null
    from public.support_tickets
    where id = '40000000-0000-0000-0000-000000000004'
  ),
  'ticket creation computes the first-response deadline'
);

select is(
  public.support_assign_ticket('40000000-0000-0000-0000-000000000001'),
  '20000000-0000-0000-0000-000000000001'::uuid,
  'equal loads use the oldest last assignment'
);
select is(
  public.support_assign_ticket('40000000-0000-0000-0000-000000000001'),
  '20000000-0000-0000-0000-000000000001'::uuid,
  'assigning an already assigned ticket is idempotent'
);
select is(
  (
    select count(*)::integer
    from public.support_ticket_events
    where ticket_id = '40000000-0000-0000-0000-000000000001'
      and event_type = 'assigned'
  ),
  1,
  'idempotent assignment appends exactly one assigned event'
);
select ok(
  lower(pg_get_functiondef('public.support_assign_ticket(uuid)'::regprocedure))
    like '%for update%',
  'assignment locks the ticket row before checking its assignment'
);
select ok(
  lower(pg_get_functiondef('public.support_assign_ticket(uuid)'::regprocedure))
    like '%skip locked%',
  'assignment skips presence rows locked by another transaction'
);

create temporary table support_presence_before_closed_assignment as
select agent_id, last_assigned_at, updated_at
from public.support_agent_presence;

select is(
  public.support_assign_ticket('40000000-0000-0000-0000-000000000008'),
  null::uuid,
  'a ticket closed before its queued assignment runs is not assigned'
);
select is(
  public.support_assign_ticket('40000000-0000-0000-0000-000000000009'),
  null::uuid,
  'a resolved ticket is not assigned'
);
select is(
  (
    select assigned_to
    from public.support_tickets
    where id = '40000000-0000-0000-0000-000000000008'
  ),
  null::uuid,
  'closed assignment leaves assigned_to unchanged'
);
select is(
  (
    select assigned_to
    from public.support_tickets
    where id = '40000000-0000-0000-0000-000000000009'
  ),
  null::uuid,
  'resolved assignment leaves assigned_to unchanged'
);
select is(
  (
    select count(*)::integer
    from public.support_agent_presence presence
    join support_presence_before_closed_assignment baseline using (agent_id)
    where presence.last_assigned_at is distinct from baseline.last_assigned_at
       or presence.updated_at is distinct from baseline.updated_at
  ),
  0,
  'closed or resolved assignment does not update agent presence'
);
select is(
  (
    select count(*)::integer
    from public.support_ticket_events
    where ticket_id in (
      '40000000-0000-0000-0000-000000000008',
      '40000000-0000-0000-0000-000000000009'
    )
      and event_type = 'assigned'
  ),
  0,
  'closed or resolved assignment does not append assigned events'
);

update public.support_tickets
set assigned_to = '20000000-0000-0000-0000-000000000002',
    status = 'in_progress'
where id = '30000000-0000-0000-0000-000000000003';

select is(
  public.support_assign_ticket('40000000-0000-0000-0000-000000000002'),
  '20000000-0000-0000-0000-000000000003'::uuid,
  'least-loaded active agent wins'
);

update public.support_agent_presence
set last_heartbeat_at = now() - interval '91 seconds';

select is(
  public.support_assign_ticket('40000000-0000-0000-0000-000000000003'),
  null::uuid,
  'no active heartbeat leaves the ticket unassigned'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  $$select public.support_agent_heartbeat(
    '20000000-0000-0000-0000-000000000001'::uuid
  )$$,
  'service role can refresh an explicit admin heartbeat'
);
select ok(
  (select last_heartbeat_at >= now() - interval '5 seconds'
   from public.support_agent_presence
   where agent_id = '20000000-0000-0000-0000-000000000001'),
  'heartbeat records a fresh timestamp'
);

select is(
  public.support_mark_first_response(
    '40000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000001'
  ),
  true,
  'first response is marked once'
);
select is(
  public.support_mark_first_response(
    '40000000-0000-0000-0000-000000000004',
    '20000000-0000-0000-0000-000000000001'
  ),
  false,
  'duplicate first response is ignored'
);
select is(
  (
    select count(*)::integer
    from public.support_ticket_events
    where ticket_id = '40000000-0000-0000-0000-000000000004'
      and event_type = 'first_response'
  ),
  1,
  'first response appends exactly one event'
);

select set_config('request.jwt.claim.role', 'service_role', true);
select lives_ok(
  $$select public.support_admin_add_reply(
    '40000000-0000-0000-0000-000000000005',
    '20000000-0000-0000-0000-000000000001',
    'Atomic administrator response',
    '[]'::jsonb
  )$$,
  'admin reply RPC inserts the reply and first-response effects atomically'
);
select is(
  (select count(*)::integer from public.support_ticket_replies
   where ticket_id = '40000000-0000-0000-0000-000000000005'
     and body = 'Atomic administrator response'),
  1,
  'admin reply RPC inserts exactly one reply'
);
select is(
  (select count(*)::integer from public.support_ticket_events
   where ticket_id = '40000000-0000-0000-0000-000000000005'
     and event_type = 'first_response'),
  1,
  'admin reply RPC records exactly one first-response event'
);
select ok(
  (select first_responded_at is not null from public.support_tickets
   where id = '40000000-0000-0000-0000-000000000005'),
  'admin reply RPC marks the ticket first response'
);

create function public.support_test_fail_first_response_event()
returns trigger
language plpgsql
as $$
begin
  if new.ticket_id = '40000000-0000-0000-0000-000000000007'::uuid
     and new.event_type = 'first_response' then
    raise exception 'forced first-response event failure';
  end if;
  return new;
end
$$;

create trigger support_test_fail_first_response_event
before insert on public.support_ticket_events
for each row execute function public.support_test_fail_first_response_event();

select throws_ok(
  $$select public.support_admin_add_reply(
    '40000000-0000-0000-0000-000000000007',
    '20000000-0000-0000-0000-000000000001',
    'This reply must roll back',
    '[]'::jsonb
  )$$,
  'forced first-response event failure',
  'admin reply RPC rolls back when the first-response event fails'
);
select is(
  (select count(*)::integer from public.support_ticket_replies
   where ticket_id = '40000000-0000-0000-0000-000000000007'),
  0,
  'failed admin reply RPC leaves no reply'
);
select is(
  (select first_responded_at from public.support_tickets
   where id = '40000000-0000-0000-0000-000000000007'),
  null::timestamptz,
  'failed admin reply RPC leaves first response unmarked'
);
select is(
  (select count(*)::integer from public.support_ticket_events
   where ticket_id = '40000000-0000-0000-0000-000000000007'
     and event_type = 'first_response'),
  0,
  'failed admin reply RPC leaves no first-response event'
);

insert into public.support_ticket_replies(ticket_id, author_id, is_admin, body, attachments)
values (
  '40000000-0000-0000-0000-000000000006',
  '20000000-0000-0000-0000-000000000001',
  false,
  'Automated acknowledgement',
  '[]'::jsonb
);
select is(
  (select first_responded_at from public.support_tickets
   where id = '40000000-0000-0000-0000-000000000006'),
  null::timestamptz,
  'automated reply does not mark first response'
);
select is(
  (select count(*)::integer from public.support_ticket_events
   where ticket_id = '40000000-0000-0000-0000-000000000006'
     and event_type = 'first_response'),
  0,
  'automated reply does not append a first-response event'
);

insert into public.support_tickets (
  id, user_id, title, description, status, first_response_due_at, attachments
)
values
  (
    '70000000-0000-4000-8000-000000000001',
    '10000000-0000-0000-0000-000000000001',
    'SLA due soon',
    'SLA due soon',
    'open',
    now() + interval '10 minutes',
    '[]'::jsonb
  ),
  (
    '70000000-0000-4000-8000-000000000002',
    '10000000-0000-0000-0000-000000000001',
    'SLA breached',
    'SLA breached',
    'open',
    now() - interval '1 minute',
    '[]'::jsonb
  ),
  (
    '70000000-0000-4000-8000-000000000003',
    '10000000-0000-0000-0000-000000000001',
    'Resolved SLA ignored',
    'Resolved SLA ignored',
    'resolved',
    now() + interval '10 minutes',
    '[]'::jsonb
  ),
  (
    '70000000-0000-4000-8000-000000000004',
    '10000000-0000-0000-0000-000000000001',
    'Closed SLA ignored',
    'Closed SLA ignored',
    'closed',
    now() - interval '1 minute',
    '[]'::jsonb
  ),
  (
    '70000000-0000-4000-8000-000000000005',
    '10000000-0000-0000-0000-000000000001',
    'Expired attachment without storage object',
    'Expired attachment without storage object',
    'open',
    now() + interval '1 day',
    jsonb_build_array(jsonb_build_object(
      'path', '10000000-0000-0000-0000-000000000001/70000000-0000-4000-8000-000000000005/missing.txt',
      'name', 'missing.txt',
      'size', 7,
      'type', 'text/plain',
      'expiresAt', now() - interval '1 minute'
    ))
  );

update public.support_tickets
set first_response_due_at = case id
  when '70000000-0000-4000-8000-000000000001'::uuid then now() + interval '10 minutes'
  when '70000000-0000-4000-8000-000000000002'::uuid then now() - interval '1 minute'
  when '70000000-0000-4000-8000-000000000003'::uuid then now() + interval '10 minutes'
  when '70000000-0000-4000-8000-000000000004'::uuid then now() - interval '1 minute'
  else first_response_due_at
end
where id in (
  '70000000-0000-4000-8000-000000000001',
  '70000000-0000-4000-8000-000000000002',
  '70000000-0000-4000-8000-000000000003',
  '70000000-0000-4000-8000-000000000004'
);

select is(
  (public.support_scan_sla(15) ->> 'dueSoonCreated')::integer,
  1,
  'first SLA scan creates one due-soon event'
);
select is(
  (select count(*)::integer from public.support_ticket_events
   where ticket_id = '70000000-0000-4000-8000-000000000002'
     and event_type = 'sla.breached'),
  1,
  'first SLA scan creates one breach event'
);
select is(
  (public.support_scan_sla(15) ->> 'dueSoonCreated')::integer,
  0,
  'second SLA scan does not recreate due-soon'
);
select is(
  (select count(*)::integer from public.support_ticket_events
   where ticket_id = '70000000-0000-4000-8000-000000000002'
     and event_type = 'sla.breached'),
  1,
  'second SLA scan does not recreate breach'
);
select is(
  (select count(*)::integer from public.support_ticket_events
   where ticket_id = '70000000-0000-4000-8000-000000000001'
     and event_type = 'sla.due_soon'),
  1,
  'due-soon event exists exactly once'
);
select is(
  (select count(*)::integer from public.support_ticket_events
   where ticket_id = '70000000-0000-4000-8000-000000000002'
     and event_type = 'sla.breached'),
  1,
  'breach event exists exactly once'
);
select is(
  (select count(*)::integer from public.support_ticket_events
   where ticket_id = '70000000-0000-4000-8000-000000000003'
     and event_type in ('sla.due_soon', 'sla.breached')),
  0,
  'resolved tickets are ignored by SLA scans'
);
select is(
  (select count(*)::integer from public.support_ticket_events
   where ticket_id = '70000000-0000-4000-8000-000000000004'
     and event_type in ('sla.due_soon', 'sla.breached')),
  0,
  'closed tickets are ignored by SLA scans'
);
select is(
  (select sla_breached_at from public.support_tickets
   where id = '70000000-0000-4000-8000-000000000003'),
  null::timestamptz,
  'resolved tickets are not marked breached'
);
select is(
  (select sla_breached_at from public.support_tickets
   where id = '70000000-0000-4000-8000-000000000004'),
  null::timestamptz,
  'closed tickets are not marked breached'
);

select is(
  (select count(*)::integer
   from public.support_claim_expired_attachments(now(), 100)
   where path = '10000000-0000-0000-0000-000000000001/70000000-0000-4000-8000-000000000005/missing.txt'),
  1,
  'expired database attachment can be claimed without a storage object'
);
select is(
  obj_description(
    'public.support_claim_expired_attachments(timestamptz, integer)'::regprocedure,
    'pg_proc'
  ),
  'Claims attachments whose absolute expiresAt is at or before _expired_before; callers pass the current timestamp because upload already applies the 180-day retention period.',
  'attachment claim RPC documents its absolute expiresAt cutoff contract'
);
select is(
  public.support_fail_attachment_cleanup(
    '10000000-0000-0000-0000-000000000001/70000000-0000-4000-8000-000000000005/missing.txt'
  ),
  true,
  'failed cleanup releases its claim'
);
select is(
  (select count(*)::integer
   from public.support_claim_expired_attachments(now(), 100)
   where path = '10000000-0000-0000-0000-000000000001/70000000-0000-4000-8000-000000000005/missing.txt'),
  1,
  'released database attachment can be claimed again'
);
select is(
  public.support_complete_attachment_cleanup(
    '10000000-0000-0000-0000-000000000001/70000000-0000-4000-8000-000000000005/missing.txt',
    '70000000-0000-4000-8000-000000000005',
    jsonb_build_object(
      'pathHash', encode(extensions.digest(
        '10000000-0000-0000-0000-000000000001/70000000-0000-4000-8000-000000000005/missing.txt',
        'sha256'
      ), 'hex'),
      'name', 'missing.txt',
      'expiredAt', now() - interval '1 minute'
    )
  ),
  true,
  'attachment cleanup finalizes after storage deletion'
);
select is(
  (select jsonb_array_length(attachments) from public.support_tickets
   where id = '70000000-0000-4000-8000-000000000005'),
  0,
  'attachment finalize removes the database JSON reference'
);
select is(
  (select count(*)::integer from public.support_ticket_events
   where ticket_id = '70000000-0000-4000-8000-000000000005'
     and event_type = 'attachment.expired'),
  1,
  'attachment finalize records exactly one expiration event'
);

insert into public.support_ticket_replies (
  id, ticket_id, author_id, is_admin, body
)
values
  ('60000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', false, 'RLS owner one reply'),
  ('60000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000002', false, 'RLS owner two reply');

insert into public.support_ticket_tags (ticket_id, tag, created_by)
values
  ('40000000-0000-0000-0000-000000000001', 'rls-owner-one', '20000000-0000-0000-0000-000000000001'),
  ('40000000-0000-0000-0000-000000000002', 'rls-owner-two', '20000000-0000-0000-0000-000000000001');

insert into public.support_ticket_internal_notes (ticket_id, author_id, body)
values (
  '40000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000001',
  'RLS internal note'
);

insert into public.support_ticket_events (
  ticket_id, actor_id, event_type, payload, is_internal
)
values
  ('40000000-0000-0000-0000-000000000001', null, 'rls_public_fixture', '{}', false),
  ('40000000-0000-0000-0000-000000000002', null, 'rls_public_fixture', '{}', false),
  ('40000000-0000-0000-0000-000000000001', null, 'rls_internal_fixture', '{}', true);

insert into public.support_notification_outbox (
  ticket_id, channel, event_type, payload, idempotency_key
)
values (
  '40000000-0000-0000-0000-000000000001',
  'resend',
  'rls_fixture',
  '{}',
  'support-live-chat-rls-fixture'
);

update public.support_notification_outbox
set next_attempt_at = now() + interval '1 day'
where status in ('pending', 'failed');

insert into public.support_notification_outbox (
  id, ticket_id, channel, event_type, payload, idempotency_key,
  status, attempt_count, next_attempt_at
)
values (
  '80000000-0000-4000-8000-000000000001',
  '40000000-0000-0000-0000-000000000001',
  'n8n',
  'retry_fixture',
  '{}',
  'support-live-chat-retry-fixture',
  'pending',
  2,
  now() - interval '5 minutes'
);

create temporary table support_claimed_retry as
select * from public.support_claim_notification_outbox(1);

select is(
  (select id from support_claimed_retry),
  '80000000-0000-4000-8000-000000000001'::uuid,
  'claim returns the due pending retry fixture'
);
select is(
  public.support_fail_notification_outbox(
    '80000000-0000-4000-8000-000000000001',
    (select lease_token from support_claimed_retry),
    'transient fixture failure',
    null,
    false
  ),
  true,
  'fail RPC accepts a claimed notification'
);
select is(
  (select attempt_count from public.support_notification_outbox
   where id = '80000000-0000-4000-8000-000000000001'),
  3,
  'fail RPC increments the attempt count once'
);
select is(
  (select status from public.support_notification_outbox
   where id = '80000000-0000-4000-8000-000000000001'),
  'pending'::public.support_outbox_status,
  'transient failure returns the notification to pending'
);
select ok(
  (
    select next_attempt_at between
      now() + interval '3 minutes 59 seconds'
      and now() + interval '4 minutes 1 second'
    from public.support_notification_outbox
    where id = '80000000-0000-4000-8000-000000000001'
  ),
  'attempt two schedules the next retry in the four-minute backoff window'
);

insert into public.support_notification_outbox (
  id, ticket_id, channel, event_type, payload, idempotency_key,
  status, next_attempt_at, processed_at, claimed_at, lease_token
)
values
  (
    '80000000-0000-4000-8000-000000000002',
    '40000000-0000-0000-0000-000000000001',
    'n8n',
    'sent_fixture',
    '{}',
    'support-live-chat-sent-fixture',
    'sent',
    now() - interval '1 hour',
    now() - interval '1 hour',
    null,
    null
  ),
  (
    '80000000-0000-4000-8000-000000000003',
    '40000000-0000-0000-0000-000000000001',
    'n8n',
    'pending_due_fixture',
    '{}',
    'support-live-chat-pending-due-fixture',
    'pending',
    now() - interval '30 minutes',
    null,
    null,
    null
  ),
  (
    '80000000-0000-4000-8000-000000000004',
    '40000000-0000-0000-0000-000000000001',
    'n8n',
    'pending_future_fixture',
    '{}',
    'support-live-chat-pending-future-fixture',
    'pending',
    now() + interval '30 minutes',
    null,
    null,
    null
  ),
  (
    '80000000-0000-4000-8000-000000000005',
    '40000000-0000-0000-0000-000000000001',
    'n8n',
    'failed_due_fixture',
    '{}',
    'support-live-chat-failed-due-fixture',
    'failed',
    now() - interval '20 minutes',
    null,
    null,
    null
  ),
  (
    '80000000-0000-4000-8000-000000000006',
    '40000000-0000-0000-0000-000000000001',
    'n8n',
    'failed_future_fixture',
    '{}',
    'support-live-chat-failed-future-fixture',
    'failed',
    now() + interval '20 minutes',
    null,
    null,
    null
  ),
  (
    '80000000-0000-4000-8000-000000000007',
    '40000000-0000-0000-0000-000000000001',
    'n8n',
    'processing_fixture',
    '{}',
    'support-live-chat-processing-fixture',
    'processing',
    now() - interval '10 minutes',
    null,
    now(),
    '11111111-1111-4111-8111-111111111111'
  ),
  (
    '80000000-0000-4000-8000-000000000010',
    '40000000-0000-0000-0000-000000000001',
    'n8n',
    'expired_processing_fixture',
    '{}',
    'support-live-chat-expired-processing-fixture',
    'processing',
    now() - interval '20 minutes',
    null,
    now() - interval '6 minutes',
    '22222222-2222-4222-8222-222222222222'
  );

create temporary table support_claimed_statuses as
select * from public.support_claim_notification_outbox(25);

select results_eq(
  $$select id from support_claimed_statuses order by id$$,
  $$values
    ('80000000-0000-4000-8000-000000000003'::uuid),
    ('80000000-0000-4000-8000-000000000005'::uuid),
    ('80000000-0000-4000-8000-000000000010'::uuid)
  $$,
  'claim returns due rows and recovers an expired processing lease'
);
select isnt(
  (select lease_token from support_claimed_statuses
   where id = '80000000-0000-4000-8000-000000000010'),
  '22222222-2222-4222-8222-222222222222'::uuid,
  'reclaimed processing row receives a new lease token'
);
select is(
  public.support_complete_notification_outbox(
    '80000000-0000-4000-8000-000000000010',
    '22222222-2222-4222-8222-222222222222'
  ),
  false,
  'worker holding the expired token cannot complete a reclaimed row'
);
select is(
  public.support_fail_notification_outbox(
    '80000000-0000-4000-8000-000000000010',
    '22222222-2222-4222-8222-222222222222',
    'stale worker failure',
    503,
    false
  ),
  false,
  'worker holding the expired token cannot fail a reclaimed row'
);
select is(
  public.support_complete_notification_outbox(
    '80000000-0000-4000-8000-000000000010',
    (select lease_token from support_claimed_statuses
     where id = '80000000-0000-4000-8000-000000000010')
  ),
  true,
  'worker holding the current token can complete the reclaimed row'
);
select is(
  (select status from public.support_notification_outbox
   where id = '80000000-0000-4000-8000-000000000002'),
  'sent'::public.support_outbox_status,
  'sent notifications are never claimed'
);
select is(
  (
    select count(*)::integer
    from public.support_notification_outbox
    where id in (
      '80000000-0000-4000-8000-000000000004',
      '80000000-0000-4000-8000-000000000006',
      '80000000-0000-4000-8000-000000000007'
    )
      and status in ('pending', 'failed', 'processing')
  ),
  3,
  'claim leaves future and already-processing rows untouched'
);

insert into public.support_notification_outbox (
  id, ticket_id, channel, event_type, payload, idempotency_key,
  status, attempt_count, next_attempt_at
)
values (
  '80000000-0000-4000-8000-000000000012',
  '40000000-0000-0000-0000-000000000001',
  'n8n',
  'retry_cap_fixture',
  '{}',
  'support-live-chat-retry-cap-fixture',
  'pending',
  7,
  now() - interval '1 minute'
);

create temporary table support_claimed_retry_cap as
select * from public.support_claim_notification_outbox(1);

select is(
  (select id from support_claimed_retry_cap),
  '80000000-0000-4000-8000-000000000012'::uuid,
  'claim accepts the final allowed delivery attempt'
);
select is(
  public.support_fail_notification_outbox(
    '80000000-0000-4000-8000-000000000012',
    (select lease_token from support_claimed_retry_cap),
    'eighth transient failure',
    503,
    false
  ),
  true,
  'eighth transient failure is persisted'
);
select is(
  (select status from public.support_notification_outbox
   where id = '80000000-0000-4000-8000-000000000012'),
  'failed'::public.support_outbox_status,
  'eighth attempt becomes terminal failed'
);
select is(
  (select attempt_count from public.support_notification_outbox
   where id = '80000000-0000-4000-8000-000000000012'),
  8,
  'retry cap records exactly eight attempts'
);
select ok(
  (select processed_at is not null from public.support_notification_outbox
   where id = '80000000-0000-4000-8000-000000000012'),
  'retry cap records terminal processed_at'
);

insert into public.support_notification_outbox (
  id, ticket_id, channel, event_type, payload, idempotency_key
)
values
  (
    '80000000-0000-4000-8000-000000000008',
    '40000000-0000-0000-0000-000000000001',
    'resend',
    'idempotency_fixture',
    '{}',
    'support-live-chat-idempotency-fixture'
  ),
  (
    '80000000-0000-4000-8000-000000000009',
    '40000000-0000-0000-0000-000000000001',
    'resend',
    'idempotency_fixture',
    '{}',
    'support-live-chat-idempotency-fixture'
  )
on conflict (idempotency_key) do nothing;

select is(
  (
    select count(*)::integer
    from public.support_notification_outbox
    where idempotency_key = 'support-live-chat-idempotency-fixture'
  ),
  1,
  'duplicate idempotency keys produce only one outbox row'
);

set local role authenticated;
select set_config('request.jwt.claim.sub', '10000000-0000-0000-0000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);

select is(
  (select count(*)::integer from public.support_agent_presence),
  0,
  'ordinary users cannot read agent presence'
);
select is(
  (select count(*)::integer from public.support_ticket_internal_notes),
  0,
  'ordinary users cannot read internal notes'
);
select is(
  (select count(*)::integer from public.support_notification_outbox),
  0,
  'ordinary users cannot read notification outbox rows'
);
select is(
  (
    select count(*)::integer
    from public.support_tickets
    where id = '40000000-0000-0000-0000-000000000001'
  ),
  1,
  'ordinary users can read their own ticket'
);
select is(
  (
    select count(*)::integer
    from public.support_tickets
    where id = '40000000-0000-0000-0000-000000000002'
  ),
  0,
  'ordinary users cannot read another users ticket'
);
select is(
  (
    select count(*)::integer
    from public.support_ticket_replies
    where id = '60000000-0000-0000-0000-000000000001'
  ),
  1,
  'ordinary users can read replies on their own ticket'
);
select is(
  (
    select count(*)::integer
    from public.support_ticket_replies
    where id = '60000000-0000-0000-0000-000000000002'
  ),
  0,
  'ordinary users cannot read replies on another users ticket'
);
select is(
  (select count(*)::integer from public.support_ticket_tags where tag = 'rls-owner-one'),
  1,
  'ordinary users can read tags on their own ticket'
);
select is(
  (select count(*)::integer from public.support_ticket_tags where tag = 'rls-owner-two'),
  0,
  'ordinary users cannot read tags on another users ticket'
);
select is(
  (
    select count(*)::integer
    from public.support_ticket_events
    where event_type = 'rls_public_fixture'
  ),
  1,
  'ordinary users can read non-internal events only for their own ticket'
);
select is(
  (
    select count(*)::integer
    from public.support_ticket_events
    where event_type = 'rls_internal_fixture'
  ),
  0,
  'ordinary users cannot read internal events on their own ticket'
);

reset role;

-- A deterministic two-session race cannot be created inside this single
-- pgTAP transaction. Run the assignment race through two psql sessions (or a
-- dblink test database) that call support_assign_ticket for the same ticket,
-- then assert one assigned event and one stable assigned_to value. The checks
-- above cover idempotency and verify that the function retains both required
-- locking primitives.

select * from finish();
rollback;
