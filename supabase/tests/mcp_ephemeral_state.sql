begin;
select plan(7);

select has_table('public', 'mcp_ephemeral_state', 'mcp_ephemeral_state exists');
select has_index('public', 'mcp_ephemeral_state', 'idx_mcp_ephemeral_state_expires_at', 'index idx_mcp_ephemeral_state_expires_at exists');

select is(
  (select relrowsecurity from pg_class where oid = 'public.mcp_ephemeral_state'::regclass),
  true,
  'row level security is enabled'
);

select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'mcp_ephemeral_state' and permissive = 'PERMISSIVE'),
  0,
  'no permissive policies: only the service role can read or write'
);

select ok(
  not has_table_privilege('authenticated', 'public.mcp_ephemeral_state', 'SELECT'),
  'authenticated users cannot read protocol state'
);

select ok(
  not has_function_privilege('authenticated', 'public.prune_mcp_ephemeral_state()', 'EXECUTE'),
  'only the service role can prune'
);

insert into public.mcp_ephemeral_state (key, kind, expires_at)
values ('test:expired', 'request_state_nonce', now() - interval '1 minute'),
       ('test:live', 'request_state_nonce', now() + interval '5 minutes');
select is(public.prune_mcp_ephemeral_state(), 1, 'prune removes expired rows only');

select * from finish();
rollback;
