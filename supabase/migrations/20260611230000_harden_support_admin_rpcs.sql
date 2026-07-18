drop function if exists public.support_agent_heartbeat();

create function public.support_agent_heartbeat(_agent_id uuid)
returns public.support_agent_presence
language plpgsql
security definer
set search_path = public
as $$
declare
  row_out public.support_agent_presence;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  perform public.support_require_admin_actor(_agent_id);

  insert into public.support_agent_presence(
    agent_id,
    status,
    last_heartbeat_at,
    updated_at
  )
  values (_agent_id, 'online', now(), now())
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
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

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
    jsonb_build_object('old', current_agent, 'new', selected_agent)
  );

  return selected_agent;
end
$$;

create or replace function public.support_admin_set_priority(
  _ticket_id uuid,
  _actor_id uuid,
  _priority public.ticket_priority
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  old_priority public.ticket_priority;
  old_due_at timestamptz;
  ticket_row public.support_tickets;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  perform public.support_require_admin_actor(_actor_id);

  select priority, first_response_due_at
  into old_priority, old_due_at
  from public.support_tickets
  where id = _ticket_id
  for update;
  if not found then
    raise exception 'ticket not found';
  end if;

  update public.support_tickets
  set priority = _priority,
      first_response_due_at = case
        when first_responded_at is null
          then public.support_add_working_minutes(created_at, public.support_sla_minutes(_priority))
        else first_response_due_at
      end
  where id = _ticket_id
  returning * into ticket_row;

  insert into public.support_ticket_events(ticket_id, actor_id, event_type, payload)
  values (
    _ticket_id,
    _actor_id,
    'priority_changed',
    jsonb_build_object(
      'old', old_priority,
      'new', _priority,
      'oldFirstResponseDueAt', old_due_at,
      'newFirstResponseDueAt', ticket_row.first_response_due_at
    )
  );

  return to_jsonb(ticket_row);
end
$$;

revoke all on function public.support_agent_heartbeat(uuid) from public, anon, authenticated;
revoke all on function public.support_assign_ticket(uuid) from public, anon, authenticated;
revoke all on function public.support_admin_set_priority(
  uuid, uuid, public.ticket_priority
) from public, anon, authenticated;

grant execute on function public.support_agent_heartbeat(uuid) to service_role;
grant execute on function public.support_assign_ticket(uuid) to service_role;
grant execute on function public.support_admin_set_priority(
  uuid, uuid, public.ticket_priority
) to service_role;
