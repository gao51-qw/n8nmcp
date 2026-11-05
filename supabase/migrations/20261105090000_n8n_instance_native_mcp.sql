-- Native n8n instance-level MCP (roadmap Phase 4).
--
-- n8n 2.12+ serves its own MCP endpoint (<base>/mcp-server/http) with tools the
-- Public API lacks: workflow execution, execution lookup, native version history
-- and node-option resolution. Each instance can store the user's personal MCP
-- access token, encrypted with the app key exactly like the n8n API key, plus the
-- native tools found the last time the token was checked.

alter table public.n8n_instances
  add column if not exists mcp_token_encrypted text,
  add column if not exists mcp_token_iv text,
  add column if not exists mcp_token_tag text,
  add column if not exists mcp_capabilities jsonb not null default '{}'::jsonb,
  add column if not exists mcp_checked_at timestamptz;

alter table public.n8n_instances
  drop constraint if exists n8n_instances_mcp_token_parts;
alter table public.n8n_instances
  add constraint n8n_instances_mcp_token_parts check (
    (mcp_token_encrypted is null and mcp_token_iv is null and mcp_token_tag is null)
    or (mcp_token_encrypted is not null and mcp_token_iv is not null and mcp_token_tag is not null)
  );
