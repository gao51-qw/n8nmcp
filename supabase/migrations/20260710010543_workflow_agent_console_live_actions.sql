alter table public.mcp_call_logs
  add column workflow_id text
    check (workflow_id is null or char_length(workflow_id) between 1 and 128),
  add column session_id text
    check (session_id is null or char_length(session_id) between 1 and 128),
  add column metadata jsonb not null default '{}'::jsonb;

create index idx_mcp_call_logs_user_workflow_time
  on public.mcp_call_logs(user_id, workflow_id, created_at desc);

create table public.workflow_confirmation_challenges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  action text not null check (char_length(action) between 1 and 80),
  scope_hash text not null check (char_length(scope_hash) = 64),
  token_hash text not null unique check (char_length(token_hash) = 64),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index idx_workflow_confirmation_challenges_lookup
  on public.workflow_confirmation_challenges(user_id, action, scope_hash, expires_at)
  where consumed_at is null;

alter table public.workflow_confirmation_challenges enable row level security;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'mcp_call_logs'
  ) then
    alter publication supabase_realtime add table public.mcp_call_logs;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'workflow_audit_log'
  ) then
    alter publication supabase_realtime add table public.workflow_audit_log;
  end if;
end
$$;
