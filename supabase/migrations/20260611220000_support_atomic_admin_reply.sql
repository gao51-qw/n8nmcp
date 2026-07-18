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

  insert into public.support_ticket_replies(
    ticket_id, author_id, is_admin, body, attachments
  )
  values (
    _ticket_id, _actor_id, true, _body, coalesce(_attachments, '[]'::jsonb)
  )
  returning * into reply_row;

  perform public.support_mark_first_response(_ticket_id, _actor_id);

  return to_jsonb(reply_row);
end
$$;

revoke all on function public.support_admin_add_reply(
  uuid, uuid, text, jsonb
) from public, anon, authenticated;

grant execute on function public.support_admin_add_reply(
  uuid, uuid, text, jsonb
) to service_role;
