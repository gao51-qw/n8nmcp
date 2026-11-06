begin;
select plan(22);

select has_function('public', 'reserve_mcp_usage', array['uuid', 'integer', 'integer'], 'reserve_mcp_usage exists');
select has_function('public', 'release_mcp_usage', array['uuid', 'integer'], 'release_mcp_usage exists');

select ok(
  not has_function_privilege('authenticated', 'public.reserve_mcp_usage(uuid, integer, integer)', 'EXECUTE'),
  'authenticated users cannot reserve quota'
);
select ok(
  not has_function_privilege('anon', 'public.reserve_mcp_usage(uuid, integer, integer)', 'EXECUTE'),
  'anon cannot reserve quota'
);
select ok(
  not has_function_privilege('authenticated', 'public.release_mcp_usage(uuid, integer)', 'EXECUTE'),
  'authenticated users cannot refund quota'
);
select ok(
  has_function_privilege('service_role', 'public.reserve_mcp_usage(uuid, integer, integer)', 'EXECUTE'),
  'service role can reserve quota'
);
select ok(
  has_function_privilege('service_role', 'public.release_mcp_usage(uuid, integer)', 'EXECUTE'),
  'service role can refund quota'
);

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'quota1@example.test', '', now(), '{}', '{}', now(), now()),
  ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'quota2@example.test', '', now(), '{}', '{}', now(), now());

-- Reservations up to the limit succeed and return the new counter.
select results_eq(
  $$ select allowed, used, quota_limit from public.reserve_mcp_usage('30000000-0000-0000-0000-000000000001', 2) $$,
  $$ values (true, 1, 2) $$,
  'first reservation creates the day row'
);
select results_eq(
  $$ select allowed, used, quota_limit from public.reserve_mcp_usage('30000000-0000-0000-0000-000000000001', 2) $$,
  $$ values (true, 2, 2) $$,
  'second reservation reaches the limit'
);

-- At the limit the reservation is denied and the counter is unchanged.
select results_eq(
  $$ select allowed, used, quota_limit from public.reserve_mcp_usage('30000000-0000-0000-0000-000000000001', 2) $$,
  $$ values (false, 2, 2) $$,
  'reservation at the limit is denied'
);
select is(
  public.get_today_mcp_usage('30000000-0000-0000-0000-000000000001'),
  2,
  'a denied reservation does not increment usage'
);

-- A multi-unit reservation is all-or-nothing.
select results_eq(
  $$ select allowed, used from public.reserve_mcp_usage('30000000-0000-0000-0000-000000000001', 3, 2) $$,
  $$ values (false, 2) $$,
  'a reservation that would exceed the limit is denied whole'
);
select is(
  public.get_today_mcp_usage('30000000-0000-0000-0000-000000000001'),
  2,
  'a denied multi-unit reservation reserves nothing'
);

-- A first reservation larger than the limit creates no usage.
select results_eq(
  $$ select allowed, used from public.reserve_mcp_usage('30000000-0000-0000-0000-000000000002', 1, 2) $$,
  $$ values (false, 0) $$,
  'an oversized first reservation is denied'
);
select is(
  (select count(*)::int from public.usage_daily where user_id = '30000000-0000-0000-0000-000000000002'),
  0,
  'an oversized first reservation inserts no row'
);
select results_eq(
  $$ select allowed, used from public.reserve_mcp_usage('30000000-0000-0000-0000-000000000002', 0) $$,
  $$ values (false, 0) $$,
  'a zero limit denies every reservation'
);

select throws_ok(
  $$ select * from public.reserve_mcp_usage('30000000-0000-0000-0000-000000000001', 10, 0) $$,
  '22023',
  null,
  'a non-positive reservation size is rejected'
);

-- Refunds free capacity again and never go below zero.
select is(
  public.release_mcp_usage('30000000-0000-0000-0000-000000000001'),
  1,
  'release refunds one unit'
);
select results_eq(
  $$ select allowed, used from public.reserve_mcp_usage('30000000-0000-0000-0000-000000000001', 2) $$,
  $$ values (true, 2) $$,
  'a refunded unit can be reserved again'
);
select is(
  public.release_mcp_usage('30000000-0000-0000-0000-000000000001', 5),
  0,
  'release never takes the counter below zero'
);
select is(
  public.release_mcp_usage('30000000-0000-0000-0000-000000000002'),
  0,
  'release without a day row is a no-op'
);
select is(
  (select count(*)::int from public.usage_daily where user_id = '30000000-0000-0000-0000-000000000002'),
  0,
  'release without a day row inserts nothing'
);

select * from finish();
rollback;
