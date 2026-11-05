-- Short-lived MCP protocol state shared by all app replicas (roadmap Phase 6).
--
-- Legacy (2025-06-18) elicitations live between two requests — the server
-- issues an id, the client completes it, then retries the tool call — and those
-- requests may reach different replicas. The 2026-07-28 requestState is
-- stateless, but its single-use nonce must also be remembered across replicas.
-- Rows expire after minutes; prune_mcp_ephemeral_state() runs from the support
-- maintenance cron.

create table if not exists public.mcp_ephemeral_state (
  key text primary key check (char_length(key) between 1 and 300),
  kind text not null check (kind in ('elicitation', 'request_state_nonce')),
  user_id uuid references auth.users (id) on delete cascade,
  value jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists idx_mcp_ephemeral_state_expires_at
  on public.mcp_ephemeral_state (expires_at);

-- Service role only: no permissive policies, and agent tokens are denied like
-- on every other RLS table (see 20261104120000_oauth_grants.sql).
alter table public.mcp_ephemeral_state enable row level security;
revoke all on public.mcp_ephemeral_state from anon, authenticated;

drop policy if exists "deny_oauth_agent_tokens" on public.mcp_ephemeral_state;
create policy "deny_oauth_agent_tokens" on public.mcp_ephemeral_state
  as restrictive for all to public
  using ((auth.jwt() ->> 'client_id') is null)
  with check ((auth.jwt() ->> 'client_id') is null);

create or replace function public.prune_mcp_ephemeral_state()
returns integer
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.mcp_ephemeral_state where expires_at <= now() returning 1
  )
  select count(*)::integer from deleted;
$$;

revoke execute on function public.prune_mcp_ephemeral_state() from public, anon, authenticated;
grant execute on function public.prune_mcp_ephemeral_state() to service_role;
