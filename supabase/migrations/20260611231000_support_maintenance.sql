create unique index support_sla_event_once
  on public.support_ticket_events(ticket_id, event_type)
  where event_type in ('sla.due_soon', 'sla.breached');

create unique index support_attachment_expired_event_once
  on public.support_ticket_events(ticket_id, (payload ->> 'pathHash'))
  where event_type = 'attachment.expired';

create table public.support_attachment_cleanup_claims (
  path text primary key,
  ticket_id uuid not null references public.support_tickets(id) on delete cascade,
  name text not null,
  expired_at timestamptz not null,
  claimed_at timestamptz not null default now()
);

alter table public.support_attachment_cleanup_claims enable row level security;

create or replace function public.support_scan_sla(
  _due_soon_window_minutes integer default 15
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  due_soon_count integer := 0;
  breached_count integer := 0;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  with breached as (
    update public.support_tickets
    set sla_breached_at = now()
    where first_responded_at is null
      and sla_breached_at is null
      and first_response_due_at <= now()
      and status not in ('resolved', 'closed')
    returning *
  ),
  events as (
    insert into public.support_ticket_events(ticket_id, event_type, payload)
    select
      ticket.id,
      'sla.breached',
      jsonb_build_object('breachedAt', ticket.sla_breached_at)
    from breached ticket
    on conflict do nothing
    returning ticket_id
  ),
  outbox as (
    insert into public.support_notification_outbox(
      ticket_id, channel, event_type, payload, idempotency_key
    )
    select
      ticket.id,
      'n8n',
      'sla.breached',
      jsonb_build_object(
        'eventType', 'sla.breached',
        'ticketId', ticket.id,
        'priority', ticket.priority,
        'status', ticket.status,
        'assignedTo', ticket.assigned_to,
        'firstResponseDueAt', ticket.first_response_due_at,
        'requestId', gen_random_uuid()::text
      ),
      ticket.id::text || ':sla.breached:n8n'
    from breached ticket
    on conflict (idempotency_key) do nothing
  )
  select count(*) into breached_count from events;

  with candidates as (
    select ticket.*
    from public.support_tickets ticket
    where ticket.first_responded_at is null
      and ticket.sla_breached_at is null
      and ticket.first_response_due_at > now()
      and ticket.first_response_due_at <=
        now() + make_interval(mins => least(greatest(coalesce(_due_soon_window_minutes, 15), 1), 60))
      and ticket.status not in ('resolved', 'closed')
  ),
  events as (
    insert into public.support_ticket_events(ticket_id, event_type, payload)
    select
      ticket.id,
      'sla.due_soon',
      jsonb_build_object('firstResponseDueAt', ticket.first_response_due_at)
    from candidates ticket
    on conflict do nothing
    returning ticket_id
  ),
  outbox as (
    insert into public.support_notification_outbox(
      ticket_id, channel, event_type, payload, idempotency_key
    )
    select
      ticket.id,
      'n8n',
      'sla.due_soon',
      jsonb_build_object(
        'eventType', 'sla.due_soon',
        'ticketId', ticket.id,
        'priority', ticket.priority,
        'status', ticket.status,
        'assignedTo', ticket.assigned_to,
        'firstResponseDueAt', ticket.first_response_due_at,
        'requestId', gen_random_uuid()::text
      ),
      ticket.id::text || ':sla.due_soon:n8n'
    from candidates ticket
    on conflict (idempotency_key) do nothing
  )
  select count(*) into due_soon_count from events;

  return jsonb_build_object(
    'dueSoonCreated', due_soon_count,
    'breachedCreated', breached_count
  );
end
$$;

create or replace function public.support_claim_expired_attachments(
  _expired_before timestamptz,
  _limit integer default 100
)
returns table(path text, name text, ticket_id uuid, expired_at timestamptz)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;

  delete from public.support_attachment_cleanup_claims
  where claimed_at < now() - interval '30 minutes';

  return query
  with attachment_refs as (
    select
      ticket.id as ticket_id,
      attachment ->> 'path' as path,
      attachment ->> 'name' as name,
      nullif(attachment ->> 'expiresAt', '')::timestamptz as expired_at
    from public.support_tickets ticket
    cross join lateral jsonb_array_elements(ticket.attachments) attachment
    union all
    select
      reply.ticket_id,
      attachment ->> 'path',
      attachment ->> 'name',
      nullif(attachment ->> 'expiresAt', '')::timestamptz
    from public.support_ticket_replies reply
    cross join lateral jsonb_array_elements(reply.attachments) attachment
  ),
  candidates as (
    select distinct on (ref.path)
      ref.path,
      coalesce(nullif(ref.name, ''), split_part(ref.path, '/', -1)) as name,
      ref.ticket_id,
      ref.expired_at
    from attachment_refs ref
    where nullif(ref.path, '') is not null
      and ref.expired_at is not null
      and ref.expired_at <= _expired_before
    order by ref.path, ref.expired_at, ref.ticket_id
    limit least(greatest(coalesce(_limit, 100), 1), 100)
  ),
  inserted as (
    insert into public.support_attachment_cleanup_claims(
      path, ticket_id, name, expired_at
    )
    select candidates.path, candidates.ticket_id, candidates.name, candidates.expired_at
    from candidates
    on conflict (path) do nothing
    returning
      support_attachment_cleanup_claims.path,
      support_attachment_cleanup_claims.name,
      support_attachment_cleanup_claims.ticket_id,
      support_attachment_cleanup_claims.expired_at
  )
  select inserted.path, inserted.name, inserted.ticket_id, inserted.expired_at
  from inserted;
end
$$;

comment on function public.support_claim_expired_attachments(timestamptz, integer) is
  'Claims attachments whose absolute expiresAt is at or before _expired_before; callers pass the current timestamp because upload already applies the 180-day retention period.';

create or replace function public.support_complete_attachment_cleanup(
  _path text,
  _ticket_id uuid,
  _event_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'service role required';
  end if;
  if jsonb_object_length(_event_payload) <> 3
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

create or replace function public.support_fail_attachment_cleanup(_path text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.support_attachment_cleanup_claims
    where path = _path and auth.role() = 'service_role'
    returning 1
  )
  select exists(select 1 from deleted)
$$;

revoke all on function public.support_scan_sla(integer)
  from public, anon, authenticated;
revoke all on function public.support_claim_expired_attachments(timestamptz, integer)
  from public, anon, authenticated;
revoke all on function public.support_complete_attachment_cleanup(text, uuid, jsonb)
  from public, anon, authenticated;
revoke all on function public.support_fail_attachment_cleanup(text)
  from public, anon, authenticated;

grant execute on function public.support_scan_sla(integer) to service_role;
grant execute on function public.support_claim_expired_attachments(timestamptz, integer)
  to service_role;
grant execute on function public.support_complete_attachment_cleanup(text, uuid, jsonb)
  to service_role;
grant execute on function public.support_fail_attachment_cleanup(text)
  to service_role;
