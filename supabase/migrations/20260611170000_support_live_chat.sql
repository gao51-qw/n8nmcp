create type public.support_ticket_source as enum ('ticket_form', 'live_chat');
create type public.support_presence_status as enum ('online', 'away');
create type public.support_calendar_kind as enum ('holiday', 'makeup_workday');
create type public.support_outbox_channel as enum ('resend', 'n8n');
create type public.support_outbox_status as enum ('pending', 'processing', 'sent', 'failed');

alter table public.support_tickets
  add column source public.support_ticket_source not null default 'ticket_form',
  add column first_response_due_at timestamptz,
  add column first_responded_at timestamptz,
  add column resolved_due_at timestamptz,
  add column sla_breached_at timestamptz,
  add column sentry_event_id text check (char_length(sentry_event_id) <= 128),
  add column mcp_request_id text check (char_length(mcp_request_id) <= 128);

create index idx_support_tickets_assignment
  on public.support_tickets(assigned_to, status, first_response_due_at);
create index idx_support_tickets_sla
  on public.support_tickets(first_response_due_at)
  where first_responded_at is null and status not in ('resolved', 'closed');

create table public.support_agent_presence (
  agent_id uuid primary key references auth.users(id) on delete cascade,
  status public.support_presence_status not null default 'online',
  last_heartbeat_at timestamptz not null default now(),
  last_assigned_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.support_ticket_tags (
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  tag text not null check (char_length(tag) between 1 and 40),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  primary key (ticket_id, tag)
);

create table public.support_ticket_internal_notes (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  author_id uuid not null references auth.users(id),
  body text not null check (char_length(body) between 1 and 10000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.support_ticket_events (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  actor_id uuid references auth.users(id),
  event_type text not null check (char_length(event_type) between 1 and 80),
  payload jsonb not null default '{}'::jsonb,
  is_internal boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.support_calendar_days (
  day date primary key,
  kind public.support_calendar_kind not null,
  name text not null check (char_length(name) between 1 and 100)
);

create table public.support_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid references public.support_tickets(id) on delete cascade,
  channel public.support_outbox_channel not null,
  event_type text not null check (char_length(event_type) between 1 and 80),
  payload jsonb not null,
  idempotency_key text not null unique,
  status public.support_outbox_status not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  next_attempt_at timestamptz not null default now(),
  last_error text,
  created_at timestamptz not null default now(),
  processed_at timestamptz
);

create index idx_support_outbox_pending
  on public.support_notification_outbox(status, next_attempt_at);
create index idx_support_ticket_events_ticket
  on public.support_ticket_events(ticket_id, created_at);
create index idx_support_internal_notes_ticket
  on public.support_ticket_internal_notes(ticket_id, created_at);

alter table public.support_agent_presence enable row level security;
alter table public.support_ticket_tags enable row level security;
alter table public.support_ticket_internal_notes enable row level security;
alter table public.support_ticket_events enable row level security;
alter table public.support_calendar_days enable row level security;
alter table public.support_notification_outbox enable row level security;

create policy support_presence_admin_select
on public.support_agent_presence for select to authenticated
using (public.has_role(auth.uid(), 'admin'));

create policy support_tags_select
on public.support_ticket_tags for select to authenticated
using (
  public.has_role(auth.uid(), 'admin')
  or exists (
    select 1
    from public.support_tickets ticket
    where ticket.id = ticket_id and ticket.user_id = auth.uid()
  )
);

create policy support_tags_admin_insert
on public.support_ticket_tags for insert to authenticated
with check (
  public.has_role(auth.uid(), 'admin') and created_by = auth.uid()
);

create policy support_tags_admin_delete
on public.support_ticket_tags for delete to authenticated
using (public.has_role(auth.uid(), 'admin'));

create policy support_internal_notes_admin_all
on public.support_ticket_internal_notes for all to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (
  public.has_role(auth.uid(), 'admin') and author_id = auth.uid()
);

create policy support_events_select
on public.support_ticket_events for select to authenticated
using (
  public.has_role(auth.uid(), 'admin')
  or (
    not is_internal
    and exists (
      select 1
      from public.support_tickets ticket
      where ticket.id = ticket_id and ticket.user_id = auth.uid()
    )
  )
);

create policy support_events_admin_insert
on public.support_ticket_events for insert to authenticated
with check (
  public.has_role(auth.uid(), 'admin')
  and (actor_id is null or actor_id = auth.uid())
);

create policy support_calendar_authenticated_select
on public.support_calendar_days for select to authenticated
using (true);

create policy support_calendar_admin_all
on public.support_calendar_days for all to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

create policy support_outbox_admin_select
on public.support_notification_outbox for select to authenticated
using (public.has_role(auth.uid(), 'admin'));

alter table public.support_tickets replica identity full;
alter table public.support_ticket_replies replica identity full;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_tickets'
  ) then
    alter publication supabase_realtime add table public.support_tickets;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'support_ticket_replies'
  ) then
    alter publication supabase_realtime add table public.support_ticket_replies;
  end if;
end
$$;

create or replace function public.support_is_working_day(_day date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when exists (
      select 1
      from public.support_calendar_days
      where day = _day and kind = 'holiday'
    ) then false
    when exists (
      select 1
      from public.support_calendar_days
      where day = _day and kind = 'makeup_workday'
    ) then true
    else extract(isodow from _day) between 1 and 5
  end
$$;

create or replace function public.support_sla_minutes(_priority public.ticket_priority)
returns integer
language sql
immutable
security definer
set search_path = public
as $$
  select case _priority
    when 'urgent' then 30
    when 'high' then 120
    when 'normal' then 480
    when 'low' then 960
  end
$$;

create or replace function public.support_add_working_minutes(
  _start timestamptz,
  _minutes integer
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  cursor_local timestamp := _start at time zone 'Asia/Shanghai';
  remaining integer := _minutes;
  iterations integer := 0;
begin
  if _start is null then
    raise exception '_start is required';
  end if;
  if _minutes is null or _minutes < 0 then
    raise exception '_minutes must be a non-negative integer';
  end if;

  while remaining > 0 loop
    if iterations >= 2635200 then
      raise exception 'working-time calculation exceeded five years';
    end if;

    if public.support_is_working_day(cursor_local::date)
       and cursor_local::time >= time '09:00'
       and cursor_local::time < time '18:00' then
      remaining := remaining - 1;
    end if;

    cursor_local := cursor_local + interval '1 minute';
    iterations := iterations + 1;
  end loop;

  return cursor_local at time zone 'Asia/Shanghai';
end
$$;

create or replace function public.tg_support_ticket_set_sla()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.first_response_due_at := public.support_add_working_minutes(
    coalesce(new.created_at, now()),
    public.support_sla_minutes(new.priority)
  );
  return new;
end
$$;

create trigger support_ticket_set_sla
before insert on public.support_tickets
for each row execute function public.tg_support_ticket_set_sla();

create or replace function public.tg_support_tickets_user_update_guard()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if session_user = 'postgres'
     or auth.role() = 'service_role'
     or public.has_role(auth.uid(), 'admin'::public.app_role) then
    return new;
  end if;

  if new.user_id is distinct from old.user_id
     or new.status is distinct from old.status
     or new.priority is distinct from old.priority
     or new.assigned_to is distinct from old.assigned_to
     or new.category is distinct from old.category
     or new.source is distinct from old.source
     or new.first_response_due_at is distinct from old.first_response_due_at
     or new.first_responded_at is distinct from old.first_responded_at
     or new.resolved_due_at is distinct from old.resolved_due_at
     or new.sla_breached_at is distinct from old.sla_breached_at
     or new.sentry_event_id is distinct from old.sentry_event_id
     or new.mcp_request_id is distinct from old.mcp_request_id then
    raise exception 'Only admins can change protected ticket fields';
  end if;

  return new;
end
$$;

create or replace function public.support_agent_heartbeat()
returns public.support_agent_presence
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.support_agent_presence;
begin
  if not public.has_role(auth.uid(), 'admin') then
    raise exception 'admin required';
  end if;

  insert into public.support_agent_presence(
    agent_id,
    status,
    last_heartbeat_at,
    updated_at
  )
  values (auth.uid(), 'online', now(), now())
  on conflict (agent_id) do update
    set status = 'online',
        last_heartbeat_at = now(),
        updated_at = now()
  returning * into row_out;

  return row_out;
end
$$;

create or replace function public.support_assign_ticket(_ticket_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_agent uuid;
  current_agent uuid;
begin
  select assigned_to
  into current_agent
  from public.support_tickets
  where id = _ticket_id
  for update;

  if not found then
    raise exception 'ticket not found';
  end if;
  if current_agent is not null then
    return current_agent;
  end if;

  select presence.agent_id
  into selected_agent
  from public.support_agent_presence presence
  where presence.status = 'online'
    and presence.last_heartbeat_at >= now() - interval '90 seconds'
  order by (
    select count(*)
    from public.support_tickets ticket
    where ticket.assigned_to = presence.agent_id
      and ticket.status in ('open', 'in_progress', 'waiting_user')
  ),
  presence.last_assigned_at nulls first,
  presence.agent_id
  for update of presence skip locked
  limit 1;

  if selected_agent is null then
    return null;
  end if;

  update public.support_tickets
  set assigned_to = selected_agent,
      status = case when status = 'open' then 'in_progress' else status end
  where id = _ticket_id;

  update public.support_agent_presence
  set last_assigned_at = now(),
      updated_at = now()
  where agent_id = selected_agent;

  insert into public.support_ticket_events(
    ticket_id,
    actor_id,
    event_type,
    payload
  )
  values (
    _ticket_id,
    selected_agent,
    'assigned',
    jsonb_build_object('agentId', selected_agent)
  );

  return selected_agent;
end
$$;

create or replace function public.support_mark_first_response(
  _ticket_id uuid,
  _agent_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  responded_at timestamptz := now();
begin
  if not public.has_role(_agent_id, 'admin') then
    raise exception 'agent must be an admin';
  end if;

  update public.support_tickets
  set first_responded_at = responded_at
  where id = _ticket_id
    and first_responded_at is null;

  if not found then
    return false;
  end if;

  insert into public.support_ticket_events(
    ticket_id,
    actor_id,
    event_type,
    payload
  )
  values (
    _ticket_id,
    _agent_id,
    'first_response',
    jsonb_build_object('respondedAt', responded_at)
  );

  return true;
end
$$;

revoke all on function public.support_is_working_day(date) from public, anon;
revoke all on function public.support_sla_minutes(public.ticket_priority) from public, anon;
revoke all on function public.support_add_working_minutes(timestamptz, integer) from public, anon;
revoke all on function public.support_agent_heartbeat() from public, anon;
revoke all on function public.support_assign_ticket(uuid) from public, anon, authenticated;
revoke all on function public.support_mark_first_response(uuid, uuid) from public, anon, authenticated;
revoke all on function public.tg_support_ticket_set_sla() from public, anon, authenticated;

grant execute on function public.support_is_working_day(date) to authenticated, service_role;
grant execute on function public.support_sla_minutes(public.ticket_priority) to authenticated, service_role;
grant execute on function public.support_add_working_minutes(timestamptz, integer) to authenticated, service_role;
grant execute on function public.support_agent_heartbeat() to authenticated;
grant execute on function public.support_assign_ticket(uuid) to service_role;
grant execute on function public.support_mark_first_response(uuid, uuid) to service_role;
