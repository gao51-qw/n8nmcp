begin;
select plan(14);

-- table + columns
select has_table('public', 'workflow_audit_log', 'audit table exists');
select has_column('public', 'workflow_audit_log', 'user_id');
select has_column('public', 'workflow_audit_log', 'instance_id');
select has_column('public', 'workflow_audit_log', 'workflow_id');
select has_column('public', 'workflow_audit_log', 'operation');
select has_column('public', 'workflow_audit_log', 'snapshot_before');
select has_column('public', 'workflow_audit_log', 'snapshot_after');
select has_column('public', 'workflow_audit_log', 'changes');
select has_column('public', 'workflow_audit_log', 'is_rolled_back');

-- enum
select has_type('public', 'workflow_audit_operation', 'operation enum exists');

-- indexes
select has_index('public', 'workflow_audit_log', 'idx_workflow_audit_user_time');
select has_index('public', 'workflow_audit_log', 'idx_workflow_audit_workflow');

-- RLS enabled, exactly one (select-only) policy
select is(
  (select relrowsecurity from pg_class where oid = 'public.workflow_audit_log'::regclass),
  true,
  'row level security is enabled'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename = 'workflow_audit_log'),
  1,
  'exactly one (select-own-or-admin) policy; writes are service-role only'
);

select * from finish();
rollback;
