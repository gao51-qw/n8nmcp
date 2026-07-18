create type public.workflow_audit_operation as enum
  ('create', 'update', 'delete', 'activate', 'deactivate');

create table public.workflow_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  instance_id uuid references public.n8n_instances(id) on delete set null,
  workflow_id text not null check (char_length(workflow_id) between 1 and 128),
  operation public.workflow_audit_operation not null,
  snapshot_before jsonb,
  snapshot_after jsonb,
  changes jsonb,
  ai_reasoning text check (ai_reasoning is null or char_length(ai_reasoning) <= 10000),
  tool_name text check (tool_name is null or char_length(tool_name) <= 80),
  tool_params jsonb,
  ip_address text check (ip_address is null or char_length(ip_address) <= 64),
  user_agent text check (user_agent is null or char_length(user_agent) <= 200),
  session_id text check (session_id is null or char_length(session_id) <= 128),
  is_rolled_back boolean not null default false,
  created_at timestamptz not null default now()
);

create index idx_workflow_audit_user_time
  on public.workflow_audit_log(user_id, created_at desc);
create index idx_workflow_audit_workflow
  on public.workflow_audit_log(workflow_id, created_at desc);

alter table public.workflow_audit_log enable row level security;

-- Owners (and admins) may read their audit history. Writes happen through the
-- service-role gateway client, which bypasses RLS, so there is intentionally no
-- insert/update policy here -- mirroring public.mcp_call_logs.
create policy "workflow_audit_select_own_or_admin"
  on public.workflow_audit_log
  for select to authenticated
  using (user_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
