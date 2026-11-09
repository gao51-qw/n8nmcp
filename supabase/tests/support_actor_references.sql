begin;

create extension if not exists pgtap with schema extensions;
set search_path = public, extensions;

select plan(10);

-- Schema: staff references survive the agent's deletion -----------------------

select col_is_null(
  'public', 'support_ticket_tags', 'created_by',
  'support_ticket_tags.created_by is nullable'
);
select col_is_null(
  'public', 'support_ticket_internal_notes', 'author_id',
  'support_ticket_internal_notes.author_id is nullable'
);
select col_is_null(
  'public', 'support_ticket_events', 'actor_id',
  'support_ticket_events.actor_id is nullable'
);

-- Both sides keep relname as `name`: a text literal carries the default
-- collation while name::text carries "C", and results_eq cannot compare
-- record columns whose collations differ.
select results_eq(
  $$
    select rel.relname, con.confdeltype::text
      from pg_constraint con
      join pg_class rel on rel.oid = con.conrelid
      join pg_namespace nsp on nsp.oid = rel.relnamespace
     where nsp.nspname = 'public'
       and con.contype = 'f'
       and con.confrelid = 'auth.users'::regclass
       and rel.relname in (
         'support_ticket_tags', 'support_ticket_internal_notes', 'support_ticket_events'
       )
     order by rel.relname
  $$,
  $$
    values
      ('support_ticket_events'::name, 'n'),
      ('support_ticket_internal_notes'::name, 'n'),
      ('support_ticket_tags'::name, 'n')
  $$,
  'staff references to auth.users are ON DELETE SET NULL'
);

-- Behaviour: an admin who worked on a customer's ticket can be deleted -------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('ad000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'leaving-admin@example.test', '', now(), '{}', '{}', now(), now()),
  ('c0000000-0000-4000-8000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'customer@example.test', '', now(), '{}', '{}', now(), now());

insert into public.user_roles (user_id, role)
values ('ad000000-0000-4000-8000-000000000001', 'admin');

insert into public.support_tickets (id, user_id, title, description, status, assigned_to)
values (
  '71000000-0000-4000-8000-000000000001',
  'c0000000-0000-4000-8000-000000000001',
  'Customer ticket',
  'The customer keeps this ticket after the agent leaves',
  'in_progress',
  'ad000000-0000-4000-8000-000000000001'
);

insert into public.support_ticket_tags (ticket_id, tag, created_by)
values ('71000000-0000-4000-8000-000000000001', 'vip', 'ad000000-0000-4000-8000-000000000001');

insert into public.support_ticket_internal_notes (id, ticket_id, author_id, body)
values (
  'a0000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'ad000000-0000-4000-8000-000000000001',
  'Staff-only note written by the leaving admin'
);

insert into public.support_ticket_events (id, ticket_id, actor_id, event_type, payload)
values (
  'e0000000-0000-4000-8000-000000000001',
  '71000000-0000-4000-8000-000000000001',
  'ad000000-0000-4000-8000-000000000001',
  'priority_changed',
  '{"old": "normal", "new": "high"}'
);

insert into public.support_agent_presence (agent_id)
values ('ad000000-0000-4000-8000-000000000001');

select lives_ok(
  $$ delete from auth.users where id = 'ad000000-0000-4000-8000-000000000001' $$,
  'deleting an admin with tags, notes, events and presence succeeds'
);

select is(
  (select created_by from public.support_ticket_tags
    where ticket_id = '71000000-0000-4000-8000-000000000001' and tag = 'vip'),
  null::uuid,
  'the tag stays on the ticket and loses its author'
);
select is(
  (select author_id from public.support_ticket_internal_notes
    where id = 'a0000000-0000-4000-8000-000000000001'),
  null::uuid,
  'the internal note stays and loses its author'
);
select is(
  (select actor_id from public.support_ticket_events
    where id = 'e0000000-0000-4000-8000-000000000001'),
  null::uuid,
  'the event stays and loses its actor'
);
select is(
  (select count(*)::integer from public.support_agent_presence
    where agent_id = 'ad000000-0000-4000-8000-000000000001'),
  0,
  'the agent presence row cascades away'
);
select is(
  (select count(*)::integer from public.support_tickets
    where id = '71000000-0000-4000-8000-000000000001'),
  1,
  'the customer ticket is untouched'
);

select * from finish();

rollback;
