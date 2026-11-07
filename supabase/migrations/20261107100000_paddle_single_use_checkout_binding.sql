-- Paddle checkout bindings: single-use signed customData and event ordering.
--
-- 1. billing_checkout_nonces remembers the nonce of every signed checkout
--    binding (customData v2: user_id, ts, nonce, sig; see
--    src/lib/billing/checkout-binding.server.ts) that created a binding. A
--    nonce binds exactly one Paddle subscription, so a signed blob replayed on
--    another subscription within its 24h validity is rejected.
-- 2. subscriptions.billing_last_event_at holds the Paddle occurred_at of the
--    last event applied to the row. The webhook ignores older events.
-- 3. bind_paddle_subscription() consumes the nonce and writes the binding in
--    one transaction, so there is never a consumed nonce without its binding
--    or a new binding without its nonce.
--
-- Retention: nonces are not pruned. The table gains one small row per Paddle
-- subscription ever created, the same order of magnitude as subscriptions.
-- Pruning would be unsafe: the signature's age is checked against the
-- subscription's own Paddle createdAt, so a late event for a superseded
-- subscription would verify again once its nonce had been forgotten.

alter table public.subscriptions
  add column if not exists billing_last_event_at timestamptz;

create table if not exists public.billing_checkout_nonces (
  nonce text primary key check (nonce ~ '^[A-Za-z0-9_-]{22}$'),
  user_id uuid not null references auth.users (id) on delete cascade,
  subscription_id text not null check (char_length(subscription_id) between 1 and 200),
  consumed_at timestamptz not null default now()
);

create index if not exists idx_billing_checkout_nonces_user_id
  on public.billing_checkout_nonces (user_id);

-- Service role only: no permissive policies, and agent tokens are denied like
-- on every other RLS table (see 20261104120000_oauth_grants.sql).
alter table public.billing_checkout_nonces enable row level security;
revoke all on public.billing_checkout_nonces from public, anon, authenticated;
grant select, insert, update, delete on public.billing_checkout_nonces to service_role;

drop policy if exists "deny_oauth_agent_tokens" on public.billing_checkout_nonces;
create policy "deny_oauth_agent_tokens" on public.billing_checkout_nonces
  as restrictive for all to public
  using ((auth.jwt() ->> 'client_id') is null)
  with check ((auth.jwt() ->> 'client_id') is null);

-- Binds a Paddle subscription to the user named by verified, signed customData.
-- The caller (the Paddle webhook) has already verified the HMAC signature and
-- its age; this function enforces single use and ordering. Outcomes:
--   bound                         new binding written, nonce consumed
--   updated                       already bound to this user; row updated
--   stale                         already bound; the event is older than the row
--   nonce_reused                  nonce consumed by another subscription; no write
--   binding_superseded            nonce consumed by this subscription, but the
--                                 user is now bound to another one; no write
--   subscription_bound_elsewhere  another user holds this subscription; no write
create or replace function public.bind_paddle_subscription(
  _nonce text,
  _user_id uuid,
  _subscription_id text,
  _tier text,
  _status text,
  _event_at timestamptz,
  _customer_id text default null,
  _current_period_end timestamptz default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  _row public.subscriptions%rowtype;
  _already_bound boolean := false;
  _nonce_user uuid;
  _nonce_subscription text;
begin
  if _nonce is null or _nonce !~ '^[A-Za-z0-9_-]{22}$' then
    raise exception 'invalid checkout nonce' using errcode = '22023';
  end if;
  if _user_id is null
     or _subscription_id is null
     or char_length(_subscription_id) not between 1 and 200
     or _status is null
     or _event_at is null then
    raise exception 'invalid binding arguments' using errcode = '22023';
  end if;
  if _tier is null or _tier not in ('free', 'pro', 'enterprise') then
    raise exception 'invalid tier' using errcode = '22023';
  end if;

  -- Serialize every binding attempt for this Paddle subscription, then lock
  -- the user's row so the checks below see the state that will be written.
  perform pg_advisory_xact_lock(hashtextextended('paddle_subscription:' || _subscription_id, 0));

  select * into _row from public.subscriptions where user_id = _user_id for update;
  if found then
    _already_bound := _row.billing_provider = 'paddle'
      and _row.billing_subscription_id is not distinct from _subscription_id;
  end if;

  if exists (
    select 1 from public.subscriptions
     where billing_provider = 'paddle'
       and billing_subscription_id = _subscription_id
       and user_id <> _user_id
  ) then
    return 'subscription_bound_elsewhere';
  end if;

  insert into public.billing_checkout_nonces (nonce, user_id, subscription_id)
  values (_nonce, _user_id, _subscription_id)
  on conflict (nonce) do nothing;

  if not found then
    select n.user_id, n.subscription_id
      into _nonce_user, _nonce_subscription
      from public.billing_checkout_nonces n
     where n.nonce = _nonce;
    if _nonce_subscription is distinct from _subscription_id
       or _nonce_user is distinct from _user_id then
      return 'nonce_reused';
    end if;
    -- A Paddle retry for the same subscription stays idempotent, but it must
    -- never move the user back from a newer subscription.
    if not _already_bound then
      return 'binding_superseded';
    end if;
  end if;

  if _already_bound
     and _row.billing_last_event_at is not null
     and _row.billing_last_event_at > _event_at then
    return 'stale';
  end if;

  insert into public.subscriptions (
    user_id, tier, status, billing_provider, billing_customer_id,
    billing_subscription_id, current_period_end, billing_last_event_at, updated_at
  )
  values (
    _user_id, _tier, _status, 'paddle', _customer_id,
    _subscription_id, _current_period_end, _event_at, now()
  )
  on conflict (user_id) do update
     set tier = excluded.tier,
         status = excluded.status,
         billing_provider = excluded.billing_provider,
         billing_customer_id = excluded.billing_customer_id,
         billing_subscription_id = excluded.billing_subscription_id,
         current_period_end = excluded.current_period_end,
         billing_last_event_at = excluded.billing_last_event_at,
         updated_at = excluded.updated_at;

  return case when _already_bound then 'updated' else 'bound' end;
end;
$$;

revoke all on function public.bind_paddle_subscription(
  text, uuid, text, text, text, timestamptz, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.bind_paddle_subscription(
  text, uuid, text, text, text, timestamptz, text, timestamptz
) to service_role;
