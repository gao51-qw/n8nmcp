create or replace function public.support_claim_notification_outbox(_limit integer default 25)
returns setof public.support_notification_outbox
language sql
security definer
set search_path = public
as $$
  with claimed as (
    select id
    from public.support_notification_outbox
    where (
        status = 'pending'
        or (status = 'failed' and processed_at is null)
      )
      and next_attempt_at <= now()
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
