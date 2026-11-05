begin;
select plan(6);

select has_column('public', 'n8n_instances', 'mcp_token_encrypted');
select has_column('public', 'n8n_instances', 'mcp_token_iv');
select has_column('public', 'n8n_instances', 'mcp_token_tag');
select has_column('public', 'n8n_instances', 'mcp_capabilities');
select has_column('public', 'n8n_instances', 'mcp_checked_at');

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
