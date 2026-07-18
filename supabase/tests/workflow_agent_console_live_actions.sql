begin;
select plan(14);

select has_column('public', 'mcp_call_logs', 'workflow_id');
select has_column('public', 'mcp_call_logs', 'session_id');
select has_column('public', 'mcp_call_logs', 'metadata');
select has_index('public', 'mcp_call_logs', 'idx_mcp_call_logs_user_workflow_time');

select has_table('public', 'workflow_confirmation_challenges');
select has_column('public', 'workflow_confirmation_challenges', 'token_hash');
select has_column('public', 'workflow_confirmation_challenges', 'scope_hash');
select has_column('public', 'workflow_confirmation_challenges', 'expires_at');
select has_column('public', 'workflow_confirmation_challenges', 'consumed_at');

select is(
  (select relrowsecurity from pg_class where oid = 'public.workflow_confirmation_challenges'::regclass),
  true,
  'challenge RLS enabled'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'workflow_confirmation_challenges'),
  0,
  'service-only challenge table'
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

select col_default_is('public', 'mcp_call_logs', 'metadata', '''{}''::jsonb');

select * from finish();
rollback;
