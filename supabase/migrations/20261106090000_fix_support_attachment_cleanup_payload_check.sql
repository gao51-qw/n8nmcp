-- support_complete_attachment_cleanup validated its event payload with
-- jsonb_object_length(), which does not exist in PostgreSQL. Every call raised
-- "function jsonb_object_length(jsonb) does not exist", so the attachment
-- expiry job removed the storage object, failed to complete, released the
-- claim and retried the same row on every run while the ticket kept a
-- reference to the deleted file.
--
-- Same behavior as 20260611231000_support_maintenance.sql, with a payload check
-- that PostgreSQL can run, and the search_path from
-- 20260613100000_harden_support_assignment_and_definers.sql.
create or replace function public.support_complete_attachment_cleanup(
  _path text,
  _ticket_id uuid,
  _event_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  if _event_payload is null
     or jsonb_typeof(_event_payload) <> 'object'
     or (select count(*) from jsonb_object_keys(_event_payload)) <> 3
     or not (_event_payload ?& array['pathHash', 'name', 'expiredAt']) then
    raise exception 'invalid attachment expiration event payload';
  end if;
  if not exists (
    select 1
    from public.support_attachment_cleanup_claims claim
    where claim.path = _path and claim.ticket_id = _ticket_id
  ) then
    return false;
  end if;

  update public.support_tickets
  set attachments = coalesce((
    select jsonb_agg(attachment)
    from jsonb_array_elements(attachments) attachment
    where attachment ->> 'path' is distinct from _path
  ), '[]'::jsonb)
  where id = _ticket_id;

  update public.support_ticket_replies
  set attachments = coalesce((
    select jsonb_agg(attachment)
    from jsonb_array_elements(attachments) attachment
    where attachment ->> 'path' is distinct from _path
  ), '[]'::jsonb)
  where ticket_id = _ticket_id
    and exists (
      select 1
      from jsonb_array_elements(attachments) attachment
      where attachment ->> 'path' = _path
    );

  insert into public.support_ticket_events(ticket_id, event_type, payload)
  values (_ticket_id, 'attachment.expired', _event_payload)
  on conflict do nothing;

  delete from public.support_attachment_cleanup_claims where path = _path;
  return true;
end
$$;

revoke all on function public.support_complete_attachment_cleanup(text, uuid, jsonb)
  from public, anon, authenticated;
grant execute on function public.support_complete_attachment_cleanup(text, uuid, jsonb)
  to service_role;
