begin;
select plan(14);

-- table + columns
select has_table('public', 'workflow_audit_log', 'audit table exists');
select has_column('public', 'workflow_audit_log', 'user_id', 'workflow_audit_log.user_id exists');
select has_column('public', 'workflow_audit_log', 'instance_id', 'workflow_audit_log.instance_id exists');
select has_column('public', 'workflow_audit_log', 'workflow_id', 'workflow_audit_log.workflow_id exists');
select has_column('public', 'workflow_audit_log', 'operation', 'workflow_audit_log.operation exists');
select has_column('public', 'workflow_audit_log', 'snapshot_before', 'workflow_audit_log.snapshot_before exists');
select has_column('public', 'workflow_audit_log', 'snapshot_after', 'workflow_audit_log.snapshot_after exists');
select has_column('public', 'workflow_audit_log', 'changes', 'workflow_audit_log.changes exists');
select has_column('public', 'workflow_audit_log', 'is_rolled_back', 'workflow_audit_log.is_rolled_back exists');

-- enum
select has_type('public', 'workflow_audit_operation', 'operation enum exists');

-- indexes
select has_index('public', 'workflow_audit_log', 'idx_workflow_audit_user_time', 'index idx_workflow_audit_user_time exists');
select has_index('public', 'workflow_audit_log', 'idx_workflow_audit_workflow', 'index idx_workflow_audit_workflow exists');

-- RLS enabled, exactly one (select-only) policy
select is(
  (select relrowsecurity from pg_class where oid = 'public.workflow_audit_log'::regclass),
  true,
  'row level security is enabled'
);
select is(
  -- Permissive only: 20261104120000_oauth_grants.sql adds a restrictive
  -- deny_oauth_agent_tokens policy to every RLS table.
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'workflow_audit_log'
     and permissive = 'PERMISSIVE'),
  1,
  'exactly one (select-own-or-admin) permissive policy; writes are service-role only'
);

select * from finish();
rollback;
