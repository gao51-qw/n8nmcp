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
  safe_event jsonb;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  insert into public.support_tickets(
    id, user_id, title, description, category, priority, source, attachments,
    sentry_event_id, mcp_request_id
  )
  values (
    _ticket_id, _user_id, _title, _description, _category, _priority, _source,
    coalesce(_attachments, '[]'::jsonb), _sentry_event_id, _mcp_request_id
  )
  returning * into ticket_row;

  if _source = 'live_chat' then
    insert into public.support_ticket_replies(
      ticket_id, author_id, is_admin, body, attachments
    )
    values (
      ticket_row.id, _user_id, false, _description, coalesce(_attachments, '[]'::jsonb)
    );
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

revoke all on function public.support_create_ticket(
  uuid, uuid, text, text, text, public.ticket_category, public.ticket_priority,
  public.support_ticket_source, jsonb, text, text, text
) from public, anon, authenticated;

grant execute on function public.support_create_ticket(
  uuid, uuid, text, text, text, public.ticket_category, public.ticket_priority,
  public.support_ticket_source, jsonb, text, text, text
) to service_role;
