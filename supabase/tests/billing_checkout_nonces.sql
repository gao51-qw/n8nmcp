begin;
select plan(43);

-- Schema --------------------------------------------------------------------

select has_table('public', 'billing_checkout_nonces', 'billing_checkout_nonces exists');
select col_is_pk('public', 'billing_checkout_nonces', 'nonce', 'nonce is the primary key');
select col_not_null('public', 'billing_checkout_nonces', 'user_id', 'user_id is not null');
select col_type_is('public', 'billing_checkout_nonces', 'user_id', 'uuid', 'user_id is a uuid');
select col_not_null('public', 'billing_checkout_nonces', 'subscription_id', 'subscription_id is not null');
select col_type_is('public', 'billing_checkout_nonces', 'consumed_at', 'timestamp with time zone', 'consumed_at is a timestamptz');
select col_has_default('public', 'billing_checkout_nonces', 'consumed_at', 'consumed_at defaults to now()');
select has_column('public', 'subscriptions', 'billing_last_event_at', 'subscriptions.billing_last_event_at exists');
select col_type_is('public', 'subscriptions', 'billing_last_event_at', 'timestamp with time zone', 'billing_last_event_at is a timestamptz');

-- RLS and grants ------------------------------------------------------------

select is(
  (select relrowsecurity from pg_class where oid = 'public.billing_checkout_nonces'::regclass),
  true,
  'row level security is enabled'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'billing_checkout_nonces' and permissive = 'PERMISSIVE'),
  0,
  'no permissive policies: only the service role can read or write'
);
select ok(
  exists (select 1 from pg_policies
          where schemaname = 'public' and tablename = 'billing_checkout_nonces'
            and policyname = 'deny_oauth_agent_tokens' and permissive = 'RESTRICTIVE'),
  'OAuth agent tokens are denied'
);
select ok(not has_table_privilege('anon', 'public.billing_checkout_nonces', 'SELECT'), 'anon cannot read nonces');
select ok(not has_table_privilege('authenticated', 'public.billing_checkout_nonces', 'SELECT'), 'authenticated cannot read nonces');
select ok(not has_table_privilege('authenticated', 'public.billing_checkout_nonces', 'INSERT'), 'authenticated cannot consume nonces');
select ok(not has_table_privilege('authenticated', 'public.billing_checkout_nonces', 'DELETE'), 'authenticated cannot delete nonces');
select ok(has_table_privilege('service_role', 'public.billing_checkout_nonces', 'SELECT'), 'service role can read nonces');
select ok(has_table_privilege('service_role', 'public.billing_checkout_nonces', 'INSERT'), 'service role can insert nonces');

select has_function(
  'public', 'bind_paddle_subscription',
  array['text', 'uuid', 'text', 'text', 'text', 'timestamp with time zone', 'text', 'timestamp with time zone'],
  'bind_paddle_subscription exists'
);
select is(
  (select prosecdef from pg_proc where oid = 'public.bind_paddle_subscription(text, uuid, text, text, text, timestamptz, text, timestamptz)'::regprocedure),
  true,
  'bind_paddle_subscription is security definer'
);
select ok(
  (select proconfig from pg_proc where oid = 'public.bind_paddle_subscription(text, uuid, text, text, text, timestamptz, text, timestamptz)'::regprocedure)
    @> array['search_path=public'],
  'bind_paddle_subscription pins search_path'
);
select ok(
  not has_function_privilege('anon', 'public.bind_paddle_subscription(text, uuid, text, text, text, timestamptz, text, timestamptz)', 'EXECUTE'),
  'anon cannot bind subscriptions'
);
select ok(
  not has_function_privilege('authenticated', 'public.bind_paddle_subscription(text, uuid, text, text, text, timestamptz, text, timestamptz)', 'EXECUTE'),
  'authenticated cannot bind subscriptions'
);
select ok(
  has_function_privilege('service_role', 'public.bind_paddle_subscription(text, uuid, text, text, text, timestamptz, text, timestamptz)', 'EXECUTE'),
  'service role can bind subscriptions'
);

-- Fixtures (handle_new_user creates a free subscriptions row per user) -------

insert into auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at
)
values
  ('40000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'billing1@example.test', '', now(), '{}', '{}', now(), now()),
  ('40000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'billing2@example.test', '', now(), '{}', '{}', now(), now());

-- Constraints ---------------------------------------------------------------

select throws_ok(
  $$ insert into public.billing_checkout_nonces (nonce, user_id, subscription_id)
     values ('short', '40000000-0000-0000-0000-000000000001', 'sub_x') $$,
  '23514', null,
  'a nonce that is not 22 base64url characters is rejected'
);
select throws_ok(
  $$ insert into public.billing_checkout_nonces (nonce, user_id, subscription_id)
     values ('AAAAAAAAAAAAAAAAAAAAAA', '40000000-0000-0000-0000-000000000001', '') $$,
  '23514', null,
  'an empty subscription id is rejected'
);
select throws_ok(
  $$ insert into public.billing_checkout_nonces (nonce, user_id, subscription_id)
     values ('AAAAAAAAAAAAAAAAAAAAAA', '4fffffff-0000-0000-0000-000000000000', 'sub_x') $$,
  '23503', null,
  'a nonce must belong to an existing user'
);

-- bind_paddle_subscription --------------------------------------------------

select throws_ok(
  $$ select public.bind_paddle_subscription('bad', '40000000-0000-0000-0000-000000000001', 'sub_1', 'pro', 'active', now()) $$,
  '22023', null,
  'a malformed nonce is rejected'
);
select throws_ok(
  $$ select public.bind_paddle_subscription('nonce1_nonce1_nonce1_1', '40000000-0000-0000-0000-000000000001', 'sub_1', 'root', 'active', now()) $$,
  '22023', null,
  'an unknown tier is rejected'
);

select is(
  public.bind_paddle_subscription(
    'nonce1_nonce1_nonce1_1', '40000000-0000-0000-0000-000000000001', 'sub_1',
    'pro', 'active', '2026-11-06 12:00:00+00', 'ctm_1', '2026-12-06 12:00:00+00'
  ),
  'bound',
  'a fresh nonce binds the subscription'
);
select results_eq(
  $$ select tier, status, billing_provider, billing_customer_id, billing_subscription_id, billing_last_event_at
       from public.subscriptions where user_id = '40000000-0000-0000-0000-000000000001' $$,
  $$ values ('pro'::text, 'active'::text, 'paddle'::text, 'ctm_1'::text, 'sub_1'::text, '2026-11-06 12:00:00+00'::timestamptz) $$,
  'the binding row carries the subscription and the event time'
);
select results_eq(
  $$ select user_id, subscription_id from public.billing_checkout_nonces where nonce = 'nonce1_nonce1_nonce1_1' $$,
  $$ values ('40000000-0000-0000-0000-000000000001'::uuid, 'sub_1'::text) $$,
  'the nonce is consumed by that subscription'
);

select is(
  public.bind_paddle_subscription(
    'nonce1_nonce1_nonce1_1', '40000000-0000-0000-0000-000000000001', 'sub_1',
    'pro', 'past_due', '2026-11-06 12:05:00+00', 'ctm_1'
  ),
  'updated',
  'a retry for the same subscription is idempotent and applies newer state'
);
select is(
  public.bind_paddle_subscription(
    'nonce1_nonce1_nonce1_1', '40000000-0000-0000-0000-000000000001', 'sub_1',
    'pro', 'active', '2026-11-06 11:00:00+00', 'ctm_1'
  ),
  'stale',
  'an event older than the stored one is ignored'
);
select is(
  (select status from public.subscriptions where user_id = '40000000-0000-0000-0000-000000000001'),
  'past_due',
  'a stale event writes nothing'
);

select is(
  public.bind_paddle_subscription(
    'nonce1_nonce1_nonce1_1', '40000000-0000-0000-0000-000000000001', 'sub_other',
    'pro', 'active', '2026-11-06 13:00:00+00', 'ctm_9'
  ),
  'nonce_reused',
  'a nonce cannot bind a second subscription'
);
select results_eq(
  $$ select billing_subscription_id, status from public.subscriptions
      where user_id = '40000000-0000-0000-0000-000000000001' $$,
  $$ values ('sub_1'::text, 'past_due'::text) $$,
  'a reused nonce leaves the binding unchanged'
);
select is(
  (select count(*)::int from public.billing_checkout_nonces where subscription_id = 'sub_other'),
  0,
  'a reused nonce records nothing'
);

select is(
  public.bind_paddle_subscription(
    'nonce2_nonce2_nonce2_2', '40000000-0000-0000-0000-000000000002', 'sub_1',
    'pro', 'active', '2026-11-06 13:00:00+00', 'ctm_2'
  ),
  'subscription_bound_elsewhere',
  'a subscription bound to one user cannot be claimed by another'
);
select is(
  (select count(*)::int from public.billing_checkout_nonces where nonce = 'nonce2_nonce2_nonce2_2'),
  0,
  'a rejected claim does not consume its nonce'
);

-- The user moves to a newer subscription; a late retry for the old one must
-- not move them back.
select is(
  public.bind_paddle_subscription(
    'nonce3_nonce3_nonce3_3', '40000000-0000-0000-0000-000000000001', 'sub_2',
    'pro', 'active', '2026-11-07 12:00:00+00', 'ctm_1'
  ),
  'bound',
  'a new checkout binds the newer subscription'
);
select is(
  public.bind_paddle_subscription(
    'nonce1_nonce1_nonce1_1', '40000000-0000-0000-0000-000000000001', 'sub_1',
    'free', 'canceled', '2026-11-08 12:00:00+00', 'ctm_1'
  ),
  'binding_superseded',
  'a retry for a superseded subscription is ignored'
);
select is(
  (select billing_subscription_id from public.subscriptions where user_id = '40000000-0000-0000-0000-000000000001'),
  'sub_2',
  'the newer binding is kept'
);

select * from finish();
rollback;
