begin;
select plan(27);

select has_function(
  'public', 'check_mcp_rate_limit', array['uuid', 'integer', 'integer', 'integer', 'integer'],
  'check_mcp_rate_limit exists'
);
select has_function(
  'public', 'authenticate_mcp_platform_key', array['text'],
  'authenticate_mcp_platform_key exists'
);
select col_is_pk(
  'public', 'mcp_rate_limit_windows', array['user_id', 'window_seconds', 'bucket_start'],
  'rate limit buckets are keyed by user, window size and start'
);

select ok(
  not has_function_privilege('authenticated', 'public.check_mcp_rate_limit(uuid, integer, integer, integer, integer)', 'EXECUTE'),
  'authenticated users cannot call the rate limiter'
);
select ok(
  not has_function_privilege('anon', 'public.check_mcp_rate_limit(uuid, integer, integer, integer, integer)', 'EXECUTE'),
  'anon cannot call the rate limiter'
);
select ok(
  has_function_privilege('service_role', 'public.check_mcp_rate_limit(uuid, integer, integer, integer, integer)', 'EXECUTE'),
  'service role can call the rate limiter'
);
select ok(
  not has_function_privilege('authenticated', 'public.authenticate_mcp_platform_key(text)', 'EXECUTE'),
  'authenticated users cannot resolve key hashes'
);
select ok(
  not has_function_privilege('anon', 'public.authenticate_mcp_platform_key(text)', 'EXECUTE'),
  'anon cannot resolve key hashes'
);
select ok(
  has_function_privilege('service_role', 'public.authenticate_mcp_platform_key(text)', 'EXECUTE'),
  'service role can resolve key hashes'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rate1@example.test', '', now(), '{}', '{}', now(), now()),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rate2@example.test', '', now(), '{}', '{}', now(), now()),
  ('40000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'rate3@example.test', '', now(), '{}', '{}', now(), now());

-- now() is fixed inside this transaction, so every call lands in the same buckets.
-- User 1: burst 5 / 10s, 3 / 60s -> the per-minute window binds.
select ok(public.check_mcp_rate_limit('40000000-0000-0000-0000-000000000001', 10, 5, 60, 3), 'request 1 allowed');
select ok(public.check_mcp_rate_limit('40000000-0000-0000-0000-000000000001', 10, 5, 60, 3), 'request 2 allowed');
select ok(public.check_mcp_rate_limit('40000000-0000-0000-0000-000000000001', 10, 5, 60, 3), 'request 3 allowed');
select ok(
  not public.check_mcp_rate_limit('40000000-0000-0000-0000-000000000001', 10, 5, 60, 3),
  'request 4 is denied by the per-minute window'
);
select results_eq(
  $$ select window_seconds, request_count from public.mcp_rate_limit_windows
      where user_id = '40000000-0000-0000-0000-000000000001' order by window_seconds $$,
  $$ values (10, 3), (60, 3) $$,
  'both windows keep separate rows and a denied request counts in neither'
);

-- User 2: burst 2 / 10s, 10 / 60s -> the burst window binds.
select ok(public.check_mcp_rate_limit('40000000-0000-0000-0000-000000000002', 10, 2, 60, 10), 'burst request 1 allowed');
select ok(public.check_mcp_rate_limit('40000000-0000-0000-0000-000000000002', 10, 2, 60, 10), 'burst request 2 allowed');
select ok(
  not public.check_mcp_rate_limit('40000000-0000-0000-0000-000000000002', 10, 2, 60, 10),
  'burst request 3 is denied by the burst window'
);
select is(
  (select request_count from public.mcp_rate_limit_windows
    where user_id = '40000000-0000-0000-0000-000000000002' and window_seconds = 60),
  2,
  'a burst denial does not consume the per-minute budget'
);

select throws_ok(
  $$ select public.check_mcp_rate_limit('40000000-0000-0000-0000-000000000002', 60, 2, 60, 10) $$,
  'P0001',
  'the burst window must be shorter than the rate window',
  'equal windows are rejected'
);

-- The legacy single-window function still works next to the new buckets.
select ok(
  public.check_mcp_short_window('40000000-0000-0000-0000-000000000003', 10, 1),
  'legacy short-window check allows the first request'
);
select ok(
  not public.check_mcp_short_window('40000000-0000-0000-0000-000000000003', 10, 1),
  'legacy short-window check denies above its limit'
);

-- Platform key authentication.
insert into public.subscriptions (user_id, tier, status)
values ('40000000-0000-0000-0000-000000000001', 'pro', 'active')
on conflict (user_id) do update set tier = excluded.tier, status = excluded.status;
delete from public.subscriptions where user_id = '40000000-0000-0000-0000-000000000002';

insert into public.platform_api_keys (id, user_id, name, key_prefix, key_hash, revoked_at, last_used_at)
values
  ('41000000-0000-0000-0000-000000000001', '40000000-0000-0000-0000-000000000001', 'live', 'nmcp_a', 'hash-live', null, null),
  ('41000000-0000-0000-0000-000000000002', '40000000-0000-0000-0000-000000000001', 'revoked', 'nmcp_b', 'hash-revoked', now(), null),
  ('41000000-0000-0000-0000-000000000003', '40000000-0000-0000-0000-000000000002', 'nosub', 'nmcp_c', 'hash-nosub', null, now());

select results_eq(
  $$ select key_id, user_id, tier, status from public.authenticate_mcp_platform_key('hash-live') $$,
  $$ values ('41000000-0000-0000-0000-000000000001'::uuid, '40000000-0000-0000-0000-000000000001'::uuid, 'pro'::text, 'active'::text) $$,
  'a live key resolves to its owner and subscription'
);
select ok(
  (select last_used_at is not null from public.platform_api_keys where id = '41000000-0000-0000-0000-000000000001'),
  'authenticating touches last_used_at'
);
select is_empty(
  $$ select * from public.authenticate_mcp_platform_key('hash-revoked') $$,
  'a revoked key resolves to nothing'
);
select results_eq(
  $$ select key_id, tier from public.authenticate_mcp_platform_key('hash-nosub') $$,
  $$ values ('41000000-0000-0000-0000-000000000003'::uuid, null::text) $$,
  'a key whose owner has no subscription row still resolves (tier null = free)'
);

-- Session capabilities are an accepted kind of shared protocol state.
select lives_ok(
  $$ insert into public.mcp_ephemeral_state (key, kind, user_id, value, expires_at)
     values ('session:test', 'session_capabilities', '40000000-0000-0000-0000-000000000001',
             '{"elicitation": true}', now() + interval '1 day') $$,
  'session_capabilities rows are accepted'
);
select throws_ok(
  $$ insert into public.mcp_ephemeral_state (key, kind, expires_at)
     values ('bogus:test', 'bogus', now() + interval '1 day') $$,
  '23514',
  null,
  'unknown kinds are still rejected'
);

select * from finish();
rollback;
