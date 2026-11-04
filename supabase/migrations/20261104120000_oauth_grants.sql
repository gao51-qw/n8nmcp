-- OAuth 2.1 MCP grants (roadmap Phase 2).
--
-- Supabase Auth's OAuth 2.1 Server issues access tokens to MCP clients. It has
-- no custom scopes yet, so the scopes a user allows on the consent page live
-- here, one row per (user, OAuth client). The MCP gateway rejects tokens whose
-- grant is missing or revoked, which also makes revocation immediate instead
-- of waiting for the access token to expire.

create table if not exists public.oauth_grants (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  client_id text not null check (char_length(client_id) between 1 and 256),
  client_name text not null default '' check (char_length(client_name) <= 200),
  scopes text[] not null default '{}'::text[]
    check (scopes <@ array['mcp:tools:read', 'mcp:tools:execute', 'mcp:workflows:write']::text[]),
  granted_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz,
  constraint oauth_grants_user_client_key unique (user_id, client_id)
);

create index if not exists idx_oauth_grants_active_user
  on public.oauth_grants (user_id)
  where revoked_at is null;

alter table public.oauth_grants enable row level security;

-- Users can see their own grants; all writes go through the service role
-- (the consent and connected-apps API routes).
drop policy if exists "oauth_grants_select_own" on public.oauth_grants;
create policy "oauth_grants_select_own" on public.oauth_grants
  for select to authenticated
  using (auth.uid() = user_id);

revoke insert, update, delete on public.oauth_grants from anon, authenticated;

-- OAuth access tokens are ordinary Supabase user JWTs plus a `client_id`
-- claim, so by default an MCP client holding one could call PostgREST or
-- Storage directly with the user's full privileges. These tokens are meant
-- for the MCP endpoint only. A RESTRICTIVE policy is ANDed with every
-- permissive policy, so this denies agent tokens on each RLS-protected table
-- without touching the existing policies. The service role bypasses RLS and
-- is unaffected. supabase/tests/oauth_grants.sql fails if a table is added
-- later without this policy.
do $$
declare
  t record;
begin
  for t in
    select n.nspname as schema_name, c.relname as table_name
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where c.relkind in ('r', 'p')
      and c.relrowsecurity
      and (n.nspname = 'public' or (n.nspname = 'storage' and c.relname = 'objects'))
  loop
    execute format(
      'drop policy if exists %I on %I.%I',
      'deny_oauth_agent_tokens', t.schema_name, t.table_name
    );
    execute format(
      'create policy %I on %I.%I as restrictive for all to public '
        'using ((auth.jwt() ->> %L) is null) with check ((auth.jwt() ->> %L) is null)',
      'deny_oauth_agent_tokens', t.schema_name, t.table_name, 'client_id', 'client_id'
    );
  end loop;
end
$$;
