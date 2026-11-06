begin;
select plan(6);

select has_column('public', 'n8n_instances', 'mcp_token_encrypted', 'n8n_instances.mcp_token_encrypted exists');
select has_column('public', 'n8n_instances', 'mcp_token_iv', 'n8n_instances.mcp_token_iv exists');
select has_column('public', 'n8n_instances', 'mcp_token_tag', 'n8n_instances.mcp_token_tag exists');
select has_column('public', 'n8n_instances', 'mcp_capabilities', 'n8n_instances.mcp_capabilities exists');
select has_column('public', 'n8n_instances', 'mcp_checked_at', 'n8n_instances.mcp_checked_at exists');

select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.n8n_instances'::regclass
      and conname = 'n8n_instances_mcp_token_parts'
  ),
  'the encrypted token is stored whole or not at all'
);

select * from finish();
rollback;
