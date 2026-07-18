create or replace function public.support_claim_notification_outbox(_limit integer default 25)
returns setof public.support_notification_outbox
language sql
security definer
set search_path = public
as $$
  with claimed as (
    select id
    from public.support_notification_outbox
    where status = 'pending' and next_attempt_at <= now()
    order by next_attempt_at, created_at
    for update skip locked
    limit least(greatest(coalesce(_limit, 25), 1), 25)
  )
  update public.support_notification_outbox outbox
  set status = 'processing'
  from claimed
  where outbox.id = claimed.id
  returning outbox.*
$$;

create or replace function public.support_complete_notification_outbox(_id uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  with updated as (
    update public.support_notification_outbox
    set status = 'sent', processed_at = now(), last_error = null
    where id = _id and status = 'processing'
    returning 1
  )
  select exists(select 1 from updated)
$$;

create or replace function public.support_fail_notification_outbox(
  _id uuid,
  _error text,
  _terminal boolean default false
)
returns boolean
language sql
security definer
set search_path = public
as $$
  with updated as (
    update public.support_notification_outbox
    set status = case when _terminal then 'failed' else 'pending' end::public.support_outbox_status,
        attempt_count = attempt_count + 1,
        next_attempt_at = case
          when _terminal then next_attempt_at
          else now() + make_interval(mins => power(2, least(attempt_count, 10))::integer)
        end,
        last_error = left(coalesce(_error, 'Support notification failed'), 500),
        processed_at = case when _terminal then now() else null end
    where id = _id and status = 'processing'
    returning 1
  )
  select exists(select 1 from updated)
$$;

revoke all on function public.support_claim_notification_outbox(integer)
  from public, anon, authenticated;
revoke all on function public.support_complete_notification_outbox(uuid)
  from public, anon, authenticated;
revoke all on function public.support_fail_notification_outbox(uuid, text, boolean)
  from public, anon, authenticated;

grant execute on function public.support_claim_notification_outbox(integer) to service_role;
grant execute on function public.support_complete_notification_outbox(uuid) to service_role;
grant execute on function public.support_fail_notification_outbox(uuid, text, boolean)
  to service_role;
