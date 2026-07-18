-- support notification outbox leases
alter table public.support_notification_outbox
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_token uuid;

create index if not exists idx_support_outbox_processing_lease
  on public.support_notification_outbox(claimed_at)
  where status = 'processing';

create or replace function public.support_claim_notification_outbox(_limit integer default 25)
returns setof public.support_notification_outbox
language sql
security definer
set search_path = pg_catalog, public
as $$
  with claimed as (
    select id
    from public.support_notification_outbox
    where attempt_count < 8
      and (
        (
          status in ('pending', 'failed')
          and processed_at is null
          and next_attempt_at <= now()
        )
        or (
          status = 'processing'
          and (claimed_at is null or claimed_at <= now() - interval '5 minutes')
        )
      )
    order by next_attempt_at, created_at
    for update skip locked
    limit least(greatest(coalesce(_limit, 25), 1), 25)
  )
  update public.support_notification_outbox outbox
  set status = 'processing',
      claimed_at = now(),
      lease_token = gen_random_uuid()
  from claimed
  where outbox.id = claimed.id
  returning outbox.*
$$;

drop function if exists public.support_complete_notification_outbox(uuid);

create function public.support_complete_notification_outbox(
  _id uuid,
  _lease_token uuid
)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  with updated as (
    update public.support_notification_outbox
    set status = 'sent',
        processed_at = now(),
        last_error = null,
        claimed_at = null,
        lease_token = null
    where id = _id
      and status = 'processing'
      and lease_token = _lease_token
    returning 1
  )
  select exists(select 1 from updated)
$$;

drop function if exists public.support_fail_notification_outbox(uuid, text, boolean);

create or replace function public.support_notification_failure_is_terminal(
  _http_status integer,
  _terminal boolean default false
)
returns boolean
language sql
immutable
parallel safe
set search_path = pg_catalog, public
as $$
  select coalesce(_terminal, false)
    or coalesce((
      _http_status between 400 and 499
      and _http_status not in (408, 429)
    ), false)
$$;

create function public.support_fail_notification_outbox(
  _id uuid,
  _lease_token uuid,
  _error text,
  _http_status integer default null,
  _terminal boolean default false
)
returns boolean
language sql
security definer
set search_path = pg_catalog, public
as $$
  with updated as (
    update public.support_notification_outbox
    set status = case
          when public.support_notification_failure_is_terminal(_http_status, _terminal)
            or attempt_count + 1 >= 8 then 'failed'
          else 'pending'
        end::public.support_outbox_status,
        attempt_count = attempt_count + 1,
        next_attempt_at = case
          when public.support_notification_failure_is_terminal(_http_status, _terminal)
            or attempt_count + 1 >= 8 then next_attempt_at
          else now() + make_interval(mins => power(2, least(attempt_count, 10))::integer)
        end,
        last_error = left(coalesce(_error, 'Support notification failed'), 500),
        processed_at = case
          when public.support_notification_failure_is_terminal(_http_status, _terminal)
            or attempt_count + 1 >= 8 then now()
          else null
        end,
        claimed_at = null,
        lease_token = null
    where id = _id
      and status = 'processing'
      and lease_token = _lease_token
    returning 1
  )
  select exists(select 1 from updated)
$$;

revoke all on function public.support_claim_notification_outbox(integer)
  from public, anon, authenticated;
revoke all on function public.support_complete_notification_outbox(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.support_notification_failure_is_terminal(integer, boolean)
  from public, anon, authenticated;
revoke all on function public.support_fail_notification_outbox(uuid, uuid, text, integer, boolean)
  from public, anon, authenticated;

grant execute on function public.support_claim_notification_outbox(integer) to service_role;
grant execute on function public.support_complete_notification_outbox(uuid, uuid) to service_role;
grant execute on function public.support_notification_failure_is_terminal(integer, boolean)
  to service_role;
grant execute on function public.support_fail_notification_outbox(uuid, uuid, text, integer, boolean)
  to service_role;
