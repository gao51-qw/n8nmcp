begin;
select plan(61);

-- Schema --------------------------------------------------------------------

select has_column('public', 'n8n_instances', 'is_default', 'n8n_instances.is_default exists');
select col_not_null('public', 'n8n_instances', 'is_default', 'is_default is not null');
select col_default_is('public', 'n8n_instances', 'is_default', 'false', 'is_default defaults to false');

select ok(
  exists (
    select 1
      from pg_index ix
      join pg_class c on c.oid = ix.indexrelid
     where ix.indrelid = 'public.n8n_instances'::regclass
       and c.relname = 'n8n_instances_one_default_per_user'
       and ix.indisunique
       and ix.indpred is not null
       and pg_get_indexdef(ix.indexrelid) ilike '%(user_id)%where is_default%'
  ),
  'a partial unique index allows one default per user'
);

select has_function(
  'public', 'set_default_n8n_instance', array['uuid', 'uuid'],
  'set_default_n8n_instance exists'
);
select function_returns(
  'public', 'set_default_n8n_instance', array['uuid', 'uuid'], 'boolean',
  'set_default_n8n_instance returns boolean'
);
select is_definer(
  'public', 'set_default_n8n_instance', array['uuid', 'uuid'],
  'set_default_n8n_instance is security definer'
);
select ok(
  (select 'search_path=public' = any(proconfig)
     from pg_proc
    where oid = 'public.set_default_n8n_instance(uuid, uuid)'::regprocedure),
  'set_default_n8n_instance pins search_path=public'
);

select has_function(
  'public', 'delete_n8n_instance', array['uuid', 'uuid'],
  'delete_n8n_instance exists'
);
select function_returns(
  'public', 'delete_n8n_instance', array['uuid', 'uuid'], 'boolean',
  'delete_n8n_instance returns boolean'
);
select is_definer(
  'public', 'delete_n8n_instance', array['uuid', 'uuid'],
  'delete_n8n_instance is security definer'
);
select ok(
  (select 'search_path=public' = any(proconfig)
     from pg_proc
    where oid = 'public.delete_n8n_instance(uuid, uuid)'::regprocedure),
  'delete_n8n_instance pins search_path=public'
);
select ok(
  exists (
    select 1
      from pg_trigger
     where tgrelid = 'public.n8n_instances'::regclass
       and tgname = 'n8n_instances_guard_delete'
       and not tgisinternal
       and tgenabled = 'O'
  ),
  'a BEFORE DELETE guard trigger is installed'
);

-- Grants --------------------------------------------------------------------

select ok(
  not has_function_privilege('authenticated', 'public.set_default_n8n_instance(uuid, uuid)', 'EXECUTE'),
  'authenticated users cannot call set_default_n8n_instance'
);
select ok(
  not has_function_privilege('anon', 'public.set_default_n8n_instance(uuid, uuid)', 'EXECUTE'),
  'anon cannot call set_default_n8n_instance'
);
select ok(
  has_function_privilege('service_role', 'public.set_default_n8n_instance(uuid, uuid)', 'EXECUTE'),
  'service role can call set_default_n8n_instance'
);
select ok(
  not has_function_privilege('authenticated', 'public.delete_n8n_instance(uuid, uuid)', 'EXECUTE'),
  'authenticated users cannot call delete_n8n_instance'
);
select ok(
  not has_function_privilege('anon', 'public.delete_n8n_instance(uuid, uuid)', 'EXECUTE'),
  'anon cannot call delete_n8n_instance'
);
select ok(
  not has_function_privilege('public', 'public.delete_n8n_instance(uuid, uuid)', 'EXECUTE'),
  'PUBLIC cannot call delete_n8n_instance'
);
select ok(
  has_function_privilege('service_role', 'public.delete_n8n_instance(uuid, uuid)', 'EXECUTE'),
  'service role can call delete_n8n_instance'
);

-- Fixtures ------------------------------------------------------------------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('50000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'default1@example.test', '', now(), '{}', '{}', now(), now()),
  ('50000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'default2@example.test', '', now(), '{}', '{}', now(), now()),
  ('50000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'default3@example.test', '', now(), '{}', '{}', now(), now());

-- User 1: A (oldest), B, C, inserted one at a time.
insert into public.n8n_instances (id, user_id, name, base_url, api_key_encrypted, api_key_iv, api_key_tag, created_at)
values ('5a000000-0000-0000-0000-00000000000a', '50000000-0000-0000-0000-000000000001', 'A', 'https://a.example.test', 'c', 'i', 't', '2026-01-01T00:00:00Z');
insert into public.n8n_instances (id, user_id, name, base_url, api_key_encrypted, api_key_iv, api_key_tag, created_at)
values ('5a000000-0000-0000-0000-00000000000b', '50000000-0000-0000-0000-000000000001', 'B', 'https://b.example.test', 'c', 'i', 't', '2026-02-01T00:00:00Z');
-- Asking for is_default on insert is ignored while a default exists.
insert into public.n8n_instances (id, user_id, name, base_url, api_key_encrypted, api_key_iv, api_key_tag, created_at, is_default)
values ('5a000000-0000-0000-0000-00000000000c', '50000000-0000-0000-0000-000000000001', 'C', 'https://c.example.test', 'c', 'i', 't', '2026-03-01T00:00:00Z', true);

select results_eq(
  $$ select name, is_default from public.n8n_instances
      where user_id = '50000000-0000-0000-0000-000000000001' order by created_at $$,
  $$ values ('A'::text, true), ('B'::text, false), ('C'::text, false) $$,
  'the first instance becomes the default and later inserts do not'
);

-- set_default_n8n_instance ----------------------------------------------------

select ok(
  public.set_default_n8n_instance('50000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-00000000000b'),
  'the owner can make B the default'
);
select results_eq(
  $$ select name from public.n8n_instances
      where user_id = '50000000-0000-0000-0000-000000000001' and is_default $$,
  $$ values ('B'::text) $$,
  'B is the only default afterwards'
);
select ok(
  public.set_default_n8n_instance('50000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-00000000000b'),
  'choosing the current default again succeeds'
);
select ok(
  not public.set_default_n8n_instance('50000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-00000000000c'),
  'another user cannot choose the instance'
);
select ok(
  not public.set_default_n8n_instance('50000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-0000000000ff'),
  'an unknown instance is refused'
);
select results_eq(
  $$ select name from public.n8n_instances
      where user_id = '50000000-0000-0000-0000-000000000001' and is_default $$,
  $$ values ('B'::text) $$,
  'refused calls change nothing'
);
select throws_ok(
  $$ select public.set_default_n8n_instance(null, '5a000000-0000-0000-0000-00000000000b') $$,
  '22004',
  null,
  'a null user id is rejected'
);

-- Update guards -----------------------------------------------------------------

select throws_ok(
  $$ update public.n8n_instances set is_default = true
      where id = '5a000000-0000-0000-0000-00000000000c' $$,
  '42501',
  null,
  'is_default cannot be set directly'
);
select throws_ok(
  $$ update public.n8n_instances set is_default = false
      where id = '5a000000-0000-0000-0000-00000000000b' $$,
  '42501',
  null,
  'the default cannot be unset directly'
);
select throws_ok(
  $$ update public.n8n_instances set user_id = '50000000-0000-0000-0000-000000000002'
      where id = '5a000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'an instance cannot move to another user'
);
select lives_ok(
  $$ update public.n8n_instances set name = 'A renamed'
      where id = '5a000000-0000-0000-0000-00000000000a' $$,
  'other columns still update normally'
);

-- The index itself, past the guard.
do $$ begin perform set_config('app.n8n_instance_default_change', 'on', true); end $$;
select throws_ok(
  $$ update public.n8n_instances set is_default = true
      where id = '5a000000-0000-0000-0000-00000000000c' $$,
  '23505',
  null,
  'the partial unique index rejects a second default'
);
do $$ begin perform set_config('app.n8n_instance_default_change', 'off', true); end $$;

-- Delete guard and delete_n8n_instance ------------------------------------------

select throws_ok(
  $$ delete from public.n8n_instances where id = '5a000000-0000-0000-0000-00000000000c' $$,
  '42501',
  null,
  'a direct DELETE is rejected'
);
select throws_ok(
  $$ delete from public.n8n_instances where user_id = '50000000-0000-0000-0000-000000000001' $$,
  '42501',
  null,
  'a direct multi-row DELETE is rejected'
);
select is(
  (select count(*)::integer from public.n8n_instances
    where user_id = '50000000-0000-0000-0000-000000000001'),
  3,
  'rejected deletes remove nothing'
);
select ok(
  not public.delete_n8n_instance('50000000-0000-0000-0000-000000000002', '5a000000-0000-0000-0000-00000000000c'),
  'another user cannot delete the instance'
);
select ok(
  not public.delete_n8n_instance('50000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-0000000000ff'),
  'deleting an unknown instance returns false'
);
select throws_ok(
  $$ select public.delete_n8n_instance('50000000-0000-0000-0000-000000000001', null) $$,
  '22004',
  null,
  'a null instance id is rejected'
);

-- Promotion on delete ---------------------------------------------------------

select ok(
  public.delete_n8n_instance('50000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-00000000000c'),
  'delete_n8n_instance deletes a non-default instance'
);
select results_eq(
  $$ select name from public.n8n_instances
      where user_id = '50000000-0000-0000-0000-000000000001' and is_default $$,
  $$ values ('B'::text) $$,
  'deleting a non-default instance keeps the default'
);
select throws_ok(
  $$ delete from public.n8n_instances where id = '5a000000-0000-0000-0000-00000000000a' $$,
  '42501',
  null,
  'the permission to delete ends with the function call'
);

select ok(
  public.delete_n8n_instance('50000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-00000000000b'),
  'delete_n8n_instance deletes the default'
);
select results_eq(
  $$ select name from public.n8n_instances
      where user_id = '50000000-0000-0000-0000-000000000001' and is_default $$,
  $$ values ('A renamed'::text) $$,
  'deleting the default promotes the oldest remaining instance'
);

insert into public.n8n_instances (id, user_id, name, base_url, api_key_encrypted, api_key_iv, api_key_tag, created_at)
values
  ('5a000000-0000-0000-0000-00000000000d', '50000000-0000-0000-0000-000000000001', 'D', 'https://d.example.test', 'c', 'i', 't', '2026-04-01T00:00:00Z'),
  ('5a000000-0000-0000-0000-00000000000e', '50000000-0000-0000-0000-000000000001', 'E', 'https://e.example.test', 'c', 'i', 't', '2026-05-01T00:00:00Z');
select ok(
  public.delete_n8n_instance('50000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-00000000000a'),
  'the oldest instance, now the default, is deleted'
);
select results_eq(
  $$ select name, is_default from public.n8n_instances
      where user_id = '50000000-0000-0000-0000-000000000001' order by created_at $$,
  $$ values ('D'::text, true), ('E'::text, false) $$,
  'the next-oldest instance takes over'
);

-- Deleting the default and then the next-oldest in one transaction still
-- leaves exactly one default.
insert into public.n8n_instances (id, user_id, name, base_url, api_key_encrypted, api_key_iv, api_key_tag, created_at)
values ('5a000000-0000-0000-0000-0000000000f1', '50000000-0000-0000-0000-000000000001', 'F', 'https://f.example.test', 'c', 'i', 't', '2026-06-01T00:00:00Z');
select ok(
  public.delete_n8n_instance('50000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-00000000000d')
  and public.delete_n8n_instance('50000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-00000000000e'),
  'two instances are deleted in one transaction'
);
select results_eq(
  $$ select name, is_default from public.n8n_instances
      where user_id = '50000000-0000-0000-0000-000000000001' $$,
  $$ values ('F'::text, true) $$,
  'the surviving instance is the default'
);

select ok(
  public.delete_n8n_instance('50000000-0000-0000-0000-000000000001', '5a000000-0000-0000-0000-0000000000f1'),
  'the last instance is deleted'
);
select is(
  (select count(*)::integer from public.n8n_instances
    where user_id = '50000000-0000-0000-0000-000000000001'),
  0,
  'deleting the last instance leaves nothing to promote'
);

insert into public.n8n_instances (id, user_id, name, base_url, api_key_encrypted, api_key_iv, api_key_tag, created_at)
values ('5a000000-0000-0000-0000-0000000000f2', '50000000-0000-0000-0000-000000000001', 'G', 'https://g.example.test', 'c', 'i', 't', '2026-07-01T00:00:00Z');
select is(
  (select is_default from public.n8n_instances where id = '5a000000-0000-0000-0000-0000000000f2'),
  true,
  'an instance added after all were removed becomes the default'
);

-- User 2: several instances in one statement.
insert into public.n8n_instances (id, user_id, name, base_url, api_key_encrypted, api_key_iv, api_key_tag, created_at)
values
  ('5b000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002', 'X', 'https://x.example.test', 'c', 'i', 't', '2026-01-01T00:00:00Z'),
  ('5b000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000002', 'Y', 'https://y.example.test', 'c', 'i', 't', '2026-02-01T00:00:00Z'),
  ('5b000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000002', 'Z', 'https://z.example.test', 'c', 'i', 't', '2026-03-01T00:00:00Z');
select is(
  (select count(*)::integer from public.n8n_instances
    where user_id = '50000000-0000-0000-0000-000000000002' and is_default),
  1,
  'a multi-row insert yields exactly one default'
);

-- Account deletion: the auth.users cascade ---------------------------------------

-- User 3's default is not its oldest instance, so the cascade meets
-- non-default rows before and after the default.
insert into public.n8n_instances (id, user_id, name, base_url, api_key_encrypted, api_key_iv, api_key_tag, created_at)
values
  ('5c000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000003', 'P', 'https://p.example.test', 'c', 'i', 't', '2026-01-01T00:00:00Z'),
  ('5c000000-0000-0000-0000-000000000002', '50000000-0000-0000-0000-000000000003', 'Q', 'https://q.example.test', 'c', 'i', 't', '2026-02-01T00:00:00Z'),
  ('5c000000-0000-0000-0000-000000000003', '50000000-0000-0000-0000-000000000003', 'R', 'https://r.example.test', 'c', 'i', 't', '2026-03-01T00:00:00Z');
select ok(
  public.set_default_n8n_instance('50000000-0000-0000-0000-000000000003', '5c000000-0000-0000-0000-000000000002'),
  'user 3 makes the middle instance the default'
);

select lives_ok(
  $$ delete from auth.users where id = '50000000-0000-0000-0000-000000000003' $$,
  'deleting a user cascades through the delete guard and the promotion trigger'
);
select is(
  (select count(*)::integer from public.n8n_instances
    where user_id = '50000000-0000-0000-0000-000000000003'),
  0,
  'the cascade removes every instance of the deleted user'
);
select is(
  (select count(*)::integer from public.n8n_instances
    where user_id in ('50000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000002') and is_default),
  2,
  'other users keep their defaults'
);
select lives_ok(
  $$ delete from auth.users where id = '50000000-0000-0000-0000-000000000002' $$,
  'a user whose instances came from a multi-row insert is deleted too'
);
select is(
  (select count(*)::integer from public.n8n_instances
    where user_id = '50000000-0000-0000-0000-000000000002'),
  0,
  'no instance of that user is left or resurrected'
);
select lives_ok(
  $$ delete from auth.users where id = '50000000-0000-0000-0000-000000000001' $$,
  'deleting a user with a single default instance works'
);
select is(
  (select count(*)::integer from public.n8n_instances
    where user_id = '50000000-0000-0000-0000-000000000001'),
  0,
  'that instance is gone as well'
);

-- The cascade exception is narrow: a direct DELETE inside the same
-- transaction as the account deletion still needs the function.
insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values ('50000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'default4@example.test', '', now(), '{}', '{}', now(), now());
insert into public.n8n_instances (id, user_id, name, base_url, api_key_encrypted, api_key_iv, api_key_tag, created_at)
values ('5d000000-0000-0000-0000-000000000001', '50000000-0000-0000-0000-000000000004', 'S', 'https://s.example.test', 'c', 'i', 't', '2026-01-01T00:00:00Z');
select throws_ok(
  $$ delete from public.n8n_instances where user_id = '50000000-0000-0000-0000-000000000004' $$,
  '42501',
  null,
  'a direct DELETE of a live user''s instance is still rejected'
);

select * from finish();
rollback;
