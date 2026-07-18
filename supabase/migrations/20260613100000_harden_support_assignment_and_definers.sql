create or replace function public.support_assign_ticket(_ticket_id uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  selected_agent uuid;
  current_agent uuid;
  current_status public.ticket_status;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  select assigned_to, status
  into current_agent, current_status
  from public.support_tickets
  where id = _ticket_id
  for update;

  if not found then
    raise exception 'ticket not found';
  end if;
  if current_status not in ('open', 'in_progress', 'waiting_user') then
    return null;
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

alter function public.support_is_working_day(date)
  set search_path = pg_catalog, public;
alter function public.support_sla_minutes(public.ticket_priority)
  set search_path = pg_catalog, public;
alter function public.support_add_working_minutes(timestamptz, integer)
  set search_path = pg_catalog, public;
alter function public.tg_support_ticket_set_sla()
  set search_path = pg_catalog, public;
alter function public.tg_support_tickets_user_update_guard()
  set search_path = pg_catalog, public;
alter function public.support_agent_heartbeat(uuid)
  set search_path = pg_catalog, public;
alter function public.support_assign_ticket(uuid)
  set search_path = pg_catalog, public;
alter function public.support_mark_first_response(uuid, uuid)
  set search_path = pg_catalog, public;
alter function public.support_create_ticket(
  uuid, uuid, text, text, text, public.ticket_category, public.ticket_priority,
  public.support_ticket_source, jsonb, text, text, text
) set search_path = pg_catalog, public;
alter function public.support_require_admin_actor(uuid)
  set search_path = pg_catalog, public;
alter function public.support_admin_transfer_ticket(uuid, uuid, uuid)
  set search_path = pg_catalog, public;
alter function public.support_admin_set_status(uuid, uuid, public.ticket_status)
  set search_path = pg_catalog, public;
alter function public.support_admin_set_priority(uuid, uuid, public.ticket_priority)
  set search_path = pg_catalog, public;
alter function public.support_admin_add_tag(uuid, uuid, text)
  set search_path = pg_catalog, public;
alter function public.support_admin_remove_tag(uuid, uuid, text)
  set search_path = pg_catalog, public;
alter function public.support_admin_add_note(uuid, uuid, text)
  set search_path = pg_catalog, public;
alter function public.support_admin_update_note(uuid, uuid, uuid, text)
  set search_path = pg_catalog, public;
alter function public.support_admin_add_reply(uuid, uuid, text, jsonb)
  set search_path = pg_catalog, public;
alter function public.support_claim_notification_outbox(integer)
  set search_path = pg_catalog, public;
alter function public.support_complete_notification_outbox(uuid)
  set search_path = pg_catalog, public;
alter function public.support_fail_notification_outbox(uuid, text, boolean)
  set search_path = pg_catalog, public;
alter function public.support_scan_sla(integer)
  set search_path = pg_catalog, public;
alter function public.support_claim_expired_attachments(timestamptz, integer)
  set search_path = pg_catalog, public;
alter function public.support_complete_attachment_cleanup(text, uuid, jsonb)
  set search_path = pg_catalog, public;
alter function public.support_fail_attachment_cleanup(text)
  set search_path = pg_catalog, public;
alter function public.support_add_reply(uuid, uuid, text, jsonb, boolean)
  set search_path = pg_catalog, public;

revoke create on schema public from public, anon, authenticated;
