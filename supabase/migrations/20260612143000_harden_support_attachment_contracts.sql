create or replace function public.support_normalize_attachments(
  _user_id uuid,
  _ticket_id uuid,
  _attachments jsonb,
  _now timestamptz default transaction_timestamp()
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  attachment jsonb;
  normalized jsonb := '[]'::jsonb;
  expected_prefix text := _user_id::text || '/' || _ticket_id::text || '/';
  expires_at timestamptz := transaction_timestamp() + interval '180 days';
begin
  if jsonb_typeof(coalesce(_attachments, '[]'::jsonb)) is distinct from 'array'
     or jsonb_array_length(coalesce(_attachments, '[]'::jsonb)) > 5 then
    raise exception 'invalid attachment count';
  end if;

  for attachment in
    select value from jsonb_array_elements(coalesce(_attachments, '[]'::jsonb))
  loop
    if attachment ->> 'path' !~* (
      '^' || expected_prefix ||
      '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}-' ||
      '[A-Za-z0-9_][A-Za-z0-9_.-]{0,119}$'
    ) then
      raise exception 'invalid attachment path';
    end if;

    normalized := normalized || jsonb_build_array(
      attachment || jsonb_build_object('expiresAt', expires_at)
    );
  end loop;

  return normalized;
end
$$;

create or replace function public.support_attachment_count(_ticket_id uuid)
returns integer
language sql
stable
set search_path = public
as $$
  select
    coalesce(jsonb_array_length(ticket.attachments), 0) +
    coalesce((
      select sum(jsonb_array_length(reply.attachments))::integer
      from public.support_ticket_replies reply
      where reply.ticket_id = ticket.id
    ), 0)
  from public.support_tickets ticket
  where ticket.id = _ticket_id
$$;

create or replace function public.support_create_ticket(
  _ticket_id uuid,
  _user_id uuid,
  _user_email text,
  _title text,
  _description text,
  _category public.ticket_category,
  _priority public.ticket_priority,
  _source public.support_ticket_source,
  _attachments jsonb,
  _sentry_event_id text,
  _mcp_request_id text,
  _request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ticket_row public.support_tickets;
  assigned_agent uuid;
  normalized_attachments jsonb;
  safe_event jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  normalized_attachments := public.support_normalize_attachments(
    _user_id,
    _ticket_id,
    _attachments
  );

  insert into public.support_tickets(
    id, user_id, title, description, category, priority, source, attachments,
    sentry_event_id, mcp_request_id
  )
  values (
    _ticket_id, _user_id, _title, _description, _category, _priority, _source,
    normalized_attachments, _sentry_event_id, _mcp_request_id
  )
  returning * into ticket_row;

  if _source = 'live_chat' then
    insert into public.support_ticket_replies(
      ticket_id, author_id, is_admin, body, attachments
    )
    values (ticket_row.id, _user_id, false, _description, '[]'::jsonb);
  end if;

  assigned_agent := public.support_assign_ticket(ticket_row.id);

  safe_event := jsonb_build_object(
    'eventType', 'ticket.created',
    'ticketId', ticket_row.id,
    'priority', ticket_row.priority,
    'status', case when assigned_agent is null then ticket_row.status else 'in_progress' end,
    'assignedTo', assigned_agent,
    'firstResponseDueAt', ticket_row.first_response_due_at,
    'requestId', _request_id
  );

  insert into public.support_notification_outbox(
    ticket_id, channel, event_type, payload, idempotency_key
  )
  values
    (
      ticket_row.id,
      'resend',
      'ticket.created',
      safe_event || jsonb_build_object('recipientEmail', _user_email),
      ticket_row.id::text || ':ticket.created:resend'
    ),
    (
      ticket_row.id,
      'n8n',
      'ticket.created',
      safe_event,
      ticket_row.id::text || ':ticket.created:n8n'
    );

  select * into ticket_row
  from public.support_tickets
  where id = ticket_row.id;

  return to_jsonb(ticket_row);
end
$$;

create or replace function public.support_add_reply(
  _ticket_id uuid,
  _actor_id uuid,
  _body text,
  _attachments jsonb,
  _automated boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ticket_row public.support_tickets;
  reply_row public.support_ticket_replies;
  normalized_attachments jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  select *
  into ticket_row
  from public.support_tickets
  where id = _ticket_id
  for update;

  if not found then
    raise exception 'ticket not found';
  end if;
  if ticket_row.status = 'closed' then
    raise exception 'closed tickets cannot receive replies';
  end if;
  if not _automated and ticket_row.user_id is distinct from _actor_id then
    raise exception 'ticket owner required';
  end if;

  normalized_attachments := public.support_normalize_attachments(
    ticket_row.user_id,
    _ticket_id,
    _attachments
  );
  if public.support_attachment_count(_ticket_id) +
     jsonb_array_length(normalized_attachments) > 5 then
    raise exception 'ticket attachment limit exceeded';
  end if;

  insert into public.support_ticket_replies(
    ticket_id, author_id, is_admin, body, attachments
  )
  values (_ticket_id, _actor_id, false, _body, normalized_attachments)
  returning * into reply_row;

  return to_jsonb(reply_row);
end
$$;

create or replace function public.support_admin_add_reply(
  _ticket_id uuid,
  _actor_id uuid,
  _body text,
  _attachments jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ticket_row public.support_tickets;
  reply_row public.support_ticket_replies;
  normalized_attachments jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  perform public.support_require_admin_actor(_actor_id);

  select *
  into ticket_row
  from public.support_tickets
  where id = _ticket_id
  for update;

  if not found then
    raise exception 'ticket not found';
  end if;
  if ticket_row.status = 'closed' then
    raise exception 'closed tickets cannot receive replies';
  end if;

  normalized_attachments := public.support_normalize_attachments(
    ticket_row.user_id,
    _ticket_id,
    _attachments
  );
  if public.support_attachment_count(_ticket_id) +
     jsonb_array_length(normalized_attachments) > 5 then
    raise exception 'ticket attachment limit exceeded';
  end if;

  insert into public.support_ticket_replies(
    ticket_id, author_id, is_admin, body, attachments
  )
  values (_ticket_id, _actor_id, true, _body, normalized_attachments)
  returning * into reply_row;

  perform public.support_mark_first_response(_ticket_id, _actor_id);

  return to_jsonb(reply_row);
end
$$;

revoke all on function public.support_normalize_attachments(uuid, uuid, jsonb, timestamptz)
from public, anon, authenticated;
revoke all on function public.support_attachment_count(uuid)
from public, anon, authenticated;
revoke all on function public.support_create_ticket(
  uuid, uuid, text, text, text, public.ticket_category, public.ticket_priority,
  public.support_ticket_source, jsonb, text, text, text
) from public, anon, authenticated;
revoke all on function public.support_add_reply(uuid, uuid, text, jsonb, boolean)
from public, anon, authenticated;
revoke all on function public.support_admin_add_reply(uuid, uuid, text, jsonb)
from public, anon, authenticated;

grant execute on function public.support_normalize_attachments(uuid, uuid, jsonb, timestamptz)
to service_role;
grant execute on function public.support_attachment_count(uuid)
to service_role;
grant execute on function public.support_create_ticket(
  uuid, uuid, text, text, text, public.ticket_category, public.ticket_priority,
  public.support_ticket_source, jsonb, text, text, text
) to service_role;
grant execute on function public.support_add_reply(uuid, uuid, text, jsonb, boolean)
to service_role;
grant execute on function public.support_admin_add_reply(uuid, uuid, text, jsonb)
to service_role;
