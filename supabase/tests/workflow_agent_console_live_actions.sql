begin;
select plan(14);

select has_column('public', 'mcp_call_logs', 'workflow_id', 'mcp_call_logs.workflow_id exists');
select has_column('public', 'mcp_call_logs', 'session_id', 'mcp_call_logs.session_id exists');
select has_column('public', 'mcp_call_logs', 'metadata', 'mcp_call_logs.metadata exists');
select has_index('public', 'mcp_call_logs', 'idx_mcp_call_logs_user_workflow_time', 'index idx_mcp_call_logs_user_workflow_time exists');

select has_table('public', 'workflow_confirmation_challenges', 'workflow_confirmation_challenges table exists');
select has_column('public', 'workflow_confirmation_challenges', 'token_hash', 'workflow_confirmation_challenges.token_hash exists');
select has_column('public', 'workflow_confirmation_challenges', 'scope_hash', 'workflow_confirmation_challenges.scope_hash exists');
select has_column('public', 'workflow_confirmation_challenges', 'expires_at', 'workflow_confirmation_challenges.expires_at exists');
select has_column('public', 'workflow_confirmation_challenges', 'consumed_at', 'workflow_confirmation_challenges.consumed_at exists');

select is(
  (select relrowsecurity from pg_class where oid = 'public.workflow_confirmation_challenges'::regclass),
  true,
  'challenge RLS enabled'
);
select is(
  -- Permissive only: 20261104120000_oauth_grants.sql adds a restrictive
  -- deny_oauth_agent_tokens policy to every RLS table.
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'workflow_confirmation_challenges'
     and permissive = 'PERMISSIVE'),
  0,
  'service-only challenge table (no permissive policies)'
);

select ok(
  exists(
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mcp_call_logs'
  ),
  'mcp logs published'
);
select ok(
  exists(
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workflow_audit_log'
  ),
  'audit logs published'
);

select col_default_is('public', 'mcp_call_logs', 'metadata', '{}'::jsonb, 'mcp_call_logs.metadata defaults to an empty object');

select * from finish();
rollback;
