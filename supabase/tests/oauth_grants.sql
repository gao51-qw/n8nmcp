begin;
select plan(13);

-- table + columns
select has_table('public', 'oauth_grants', 'oauth_grants table exists');
select has_column('public', 'oauth_grants', 'user_id', 'oauth_grants.user_id exists');
select has_column('public', 'oauth_grants', 'client_id', 'oauth_grants.client_id exists');
select has_column('public', 'oauth_grants', 'scopes', 'oauth_grants.scopes exists');
select has_column('public', 'oauth_grants', 'revoked_at', 'oauth_grants.revoked_at exists');
select has_index('public', 'oauth_grants', 'idx_oauth_grants_active_user', 'index idx_oauth_grants_active_user exists');

select is(
  (select relrowsecurity from pg_class where oid = 'public.oauth_grants'::regclass),
  true,
  'row level security is enabled on oauth_grants'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'oauth_grants' and permissive = 'PERMISSIVE'),
  1,
  'oauth_grants has exactly one permissive (select-own) policy'
);

select ok(
  not has_table_privilege('authenticated', 'public.oauth_grants', 'INSERT')
    and not has_table_privilege('authenticated', 'public.oauth_grants', 'UPDATE')
    and not has_table_privilege('authenticated', 'public.oauth_grants', 'DELETE'),
  'authenticated users cannot write oauth_grants directly'
);

select throws_ok(
  $$insert into public.oauth_grants (user_id, client_id, scopes)
    values (gen_random_uuid(), 'client', array['mcp:admin'])$$,
  '23514',
  null,
  'unknown scopes are rejected'
);

-- Every RLS-protected table in public (and storage.objects) denies OAuth agent tokens.
select is(
  (select array_agg(c.relname::text order by c.relname)
   from pg_class c
   join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind in ('r', 'p') and c.relrowsecurity
     and not exists (
       select 1 from pg_policies p
       where p.schemaname = 'public' and p.tablename = c.relname
         and p.policyname = 'deny_oauth_agent_tokens' and p.permissive = 'RESTRICTIVE'
     )),
  null::text[],
  'no RLS table in public is missing the deny_oauth_agent_tokens policy'
);

select ok(
  exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects'
      and policyname = 'deny_oauth_agent_tokens' and permissive = 'RESTRICTIVE'
  ),
  'storage.objects denies OAuth agent tokens'
);

select ok(
  (select qual from pg_policies
   where schemaname = 'public' and tablename = 'oauth_grants'
     and policyname = 'deny_oauth_agent_tokens') like '%client_id%',
  'the deny policy keys on the client_id claim'
);

select * from finish();
rollback;
