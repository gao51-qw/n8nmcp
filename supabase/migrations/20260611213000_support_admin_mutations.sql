create or replace function public.support_require_admin_actor(_actor_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(_actor_id, 'admin') then
    raise exception 'admin required';
  end if;
end
$$;

create or replace function public.support_admin_transfer_ticket(
  _ticket_id uuid,
  _actor_id uuid,
  _assigned_to uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  old_assigned_to uuid;
  ticket_row public.support_tickets;
begin
  perform public.support_require_admin_actor(_actor_id);
  if _assigned_to is not null and not public.has_role(_assigned_to, 'admin') then
    raise exception 'assignee must be an admin';
  end if;

  select assigned_to into old_assigned_to
  from public.support_tickets
  where id = _ticket_id
  for update;
  if not found then raise exception 'ticket not found'; end if;

  update public.support_tickets
  set assigned_to = _assigned_to,
      status = case when status = 'open' and _assigned_to is not null then 'in_progress' else status end
  where id = _ticket_id
  returning * into ticket_row;

  insert into public.support_ticket_events(ticket_id, actor_id, event_type, payload)
  values (
    _ticket_id,
    _actor_id,
    'transfer',
    jsonb_build_object('old', old_assigned_to, 'new', _assigned_to)
  );

  return to_jsonb(ticket_row);
end
$$;

create or replace function public.support_admin_set_status(
  _ticket_id uuid,
  _actor_id uuid,
  _status public.ticket_status
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  old_status public.ticket_status;
  ticket_row public.support_tickets;
begin
  perform public.support_require_admin_actor(_actor_id);
  select status into old_status
  from public.support_tickets where id = _ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;

  update public.support_tickets set status = _status
  where id = _ticket_id returning * into ticket_row;

  insert into public.support_ticket_events(ticket_id, actor_id, event_type, payload)
  values (
    _ticket_id,
    _actor_id,
    'status_changed',
    jsonb_build_object('old', old_status, 'new', _status)
  );
  return to_jsonb(ticket_row);
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
  perform public.support_require_admin_actor(_actor_id);
  select priority, first_response_due_at
  into old_priority, old_due_at
  from public.support_tickets where id = _ticket_id for update;
  if not found then raise exception 'ticket not found'; end if;

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

create or replace function public.support_admin_add_tag(
  _ticket_id uuid,
  _actor_id uuid,
  _tag text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tag_row public.support_ticket_tags;
begin
  perform public.support_require_admin_actor(_actor_id);
  insert into public.support_ticket_tags(ticket_id, tag, created_by)
  values (_ticket_id, _tag, _actor_id)
  returning * into tag_row;

  insert into public.support_ticket_events(ticket_id, actor_id, event_type, payload)
  values (
    _ticket_id,
    _actor_id,
    'tag_added',
    jsonb_build_object('old', null, 'new', _tag)
  );
  return to_jsonb(tag_row);
end
$$;

create or replace function public.support_admin_remove_tag(
  _ticket_id uuid,
  _actor_id uuid,
  _tag text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  tag_row public.support_ticket_tags;
begin
  perform public.support_require_admin_actor(_actor_id);
  delete from public.support_ticket_tags
  where ticket_id = _ticket_id and tag = _tag
  returning * into tag_row;
  if not found then raise exception 'tag not found'; end if;

  insert into public.support_ticket_events(ticket_id, actor_id, event_type, payload)
  values (
    _ticket_id,
    _actor_id,
    'tag_removed',
    jsonb_build_object('old', _tag, 'new', null)
  );
  return to_jsonb(tag_row);
end
$$;

create or replace function public.support_admin_add_note(
  _ticket_id uuid,
  _actor_id uuid,
  _body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  note_row public.support_ticket_internal_notes;
begin
  perform public.support_require_admin_actor(_actor_id);
  insert into public.support_ticket_internal_notes(ticket_id, author_id, body)
  values (_ticket_id, _actor_id, _body)
  returning * into note_row;

  insert into public.support_ticket_events(
    ticket_id, actor_id, event_type, payload, is_internal
  )
  values (
    _ticket_id,
    _actor_id,
    'internal_note_added',
    jsonb_build_object('old', null, 'new', _body, 'noteId', note_row.id),
    true
  );
  return to_jsonb(note_row);
end
$$;

create or replace function public.support_admin_update_note(
  _ticket_id uuid,
  _note_id uuid,
  _actor_id uuid,
  _body text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  old_body text;
  note_row public.support_ticket_internal_notes;
begin
  perform public.support_require_admin_actor(_actor_id);
  select body into old_body
  from public.support_ticket_internal_notes
  where id = _note_id and ticket_id = _ticket_id
  for update;
  if not found then raise exception 'note not found'; end if;

  update public.support_ticket_internal_notes
  set body = _body, updated_at = now()
  where id = _note_id and ticket_id = _ticket_id
  returning * into note_row;

  insert into public.support_ticket_events(
    ticket_id, actor_id, event_type, payload, is_internal
  )
  values (
    _ticket_id,
    _actor_id,
    'internal_note_updated',
    jsonb_build_object('old', old_body, 'new', _body, 'noteId', _note_id),
    true
  );
  return to_jsonb(note_row);
end
$$;

revoke all on function public.support_require_admin_actor(uuid) from public, anon, authenticated;
revoke all on function public.support_admin_transfer_ticket(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.support_admin_set_status(uuid, uuid, public.ticket_status) from public, anon, authenticated;
revoke all on function public.support_admin_set_priority(uuid, uuid, public.ticket_priority) from public, anon, authenticated;
revoke all on function public.support_admin_add_tag(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.support_admin_remove_tag(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.support_admin_add_note(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.support_admin_update_note(uuid, uuid, uuid, text) from public, anon, authenticated;

grant execute on function public.support_admin_transfer_ticket(uuid, uuid, uuid) to service_role;
grant execute on function public.support_admin_set_status(uuid, uuid, public.ticket_status) to service_role;
grant execute on function public.support_admin_set_priority(uuid, uuid, public.ticket_priority) to service_role;
grant execute on function public.support_admin_add_tag(uuid, uuid, text) to service_role;
grant execute on function public.support_admin_remove_tag(uuid, uuid, text) to service_role;
grant execute on function public.support_admin_add_note(uuid, uuid, text) to service_role;
grant execute on function public.support_admin_update_note(uuid, uuid, uuid, text) to service_role;
