-- MCP gateway: tier-aware rate limits, one-round-trip key authentication and
-- shared session capabilities.
--
-- 1. Rate limit windows are now keyed by window size as well as by user, so a
--    10-second burst bucket and a 60-second bucket that start at the same
--    instant (every full minute) no longer share a counter row.
--    check_mcp_rate_limit() checks the burst window and the tier's
--    per-minute window together and counts the request only when both allow.
-- 2. authenticate_mcp_platform_key() resolves a key hash to its owner and
--    subscription in one call (there is no foreign key between
--    platform_api_keys and subscriptions to embed through PostgREST) and
--    touches last_used_at at most once a minute.
-- 3. mcp_ephemeral_state accepts 'session_capabilities' rows: the client
--    capabilities a legacy MCP client declared in initialize, so a tools/call
--    served by another replica still sees them.

-- 1. Rate limit windows ------------------------------------------------------

alter table public.mcp_rate_limit_windows
  add column if not exists window_seconds integer not null default 10;

alter table public.mcp_rate_limit_windows
  drop constraint if exists mcp_rate_limit_windows_pkey;
alter table public.mcp_rate_limit_windows
  add constraint mcp_rate_limit_windows_pkey primary key (user_id, window_seconds, bucket_start);

-- Same signature and semantics as before; only the conflict target changes.
create or replace function public.check_mcp_short_window(
  _user_id uuid,
  _window_seconds integer default 10,
  _max_requests integer default 60
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _bucket_start timestamptz;
  _allowed boolean;
begin
  if _window_seconds <= 0 or _max_requests <= 0 then
    raise exception 'window_seconds and max_requests must be positive';
  end if;

  _bucket_start :=
    to_timestamp(floor(extract(epoch from now()) / _window_seconds) * _window_seconds);

  delete from public.mcp_rate_limit_windows
   where bucket_start < now() - interval '10 minutes';

  with upserted as (
    insert into public.mcp_rate_limit_windows (user_id, window_seconds, bucket_start, request_count)
    values (_user_id, _window_seconds, _bucket_start, 1)
    on conflict (user_id, window_seconds, bucket_start)
    do update
       set request_count = public.mcp_rate_limit_windows.request_count + 1,
           updated_at = now()
     where public.mcp_rate_limit_windows.request_count < _max_requests
    returning request_count
  )
  select exists (select 1 from upserted) into _allowed;

  return coalesce(_allowed, false);
end;
$$;

create or replace function public.check_mcp_rate_limit(
  _user_id uuid,
  _burst_window_seconds integer,
  _burst_max integer,
  _window_seconds integer,
  _max_requests integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _epoch double precision := extract(epoch from now());
  _burst_start timestamptz;
  _window_start timestamptz;
  _burst_count integer;
  _window_count integer;
begin
  if _burst_window_seconds <= 0 or _window_seconds <= 0
     or _burst_max <= 0 or _max_requests <= 0 then
    raise exception 'window sizes and limits must be positive';
  end if;
  if _burst_window_seconds >= _window_seconds then
    raise exception 'the burst window must be shorter than the rate window';
  end if;
  -- Rows older than 10 minutes are pruned below.
  if _window_seconds > 300 then
    raise exception 'rate windows longer than 300 seconds are not supported';
  end if;

  _burst_start := to_timestamp(floor(_epoch / _burst_window_seconds) * _burst_window_seconds);
  _window_start := to_timestamp(floor(_epoch / _window_seconds) * _window_seconds);

  delete from public.mcp_rate_limit_windows
   where bucket_start < now() - interval '10 minutes';

  -- Make sure both buckets exist, then lock them in a fixed order (shorter
  -- window first) so concurrent requests of one user serialize without
  -- deadlocking, and count the request only when both windows allow it.
  insert into public.mcp_rate_limit_windows (user_id, window_seconds, bucket_start, request_count)
  values (_user_id, _burst_window_seconds, _burst_start, 0),
         (_user_id, _window_seconds, _window_start, 0)
  on conflict (user_id, window_seconds, bucket_start) do nothing;

  select request_count into _burst_count
    from public.mcp_rate_limit_windows
   where user_id = _user_id
     and window_seconds = _burst_window_seconds
     and bucket_start = _burst_start
   for update;

  select request_count into _window_count
    from public.mcp_rate_limit_windows
   where user_id = _user_id
     and window_seconds = _window_seconds
     and bucket_start = _window_start
   for update;

  if _burst_count >= _burst_max or _window_count >= _max_requests then
    return false;
  end if;

  update public.mcp_rate_limit_windows
     set request_count = request_count + 1,
         updated_at = now()
   where user_id = _user_id
     and (
       (window_seconds = _burst_window_seconds and bucket_start = _burst_start)
       or (window_seconds = _window_seconds and bucket_start = _window_start)
     );

  return true;
end;
$$;

revoke all on function public.check_mcp_rate_limit(uuid, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.check_mcp_rate_limit(uuid, integer, integer, integer, integer)
  to service_role;

-- 2. Platform key authentication --------------------------------------------

create or replace function public.authenticate_mcp_platform_key(_key_hash text)
returns table (key_id uuid, user_id uuid, tier text, status text)
language plpgsql
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  _key_id uuid;
  _key_user_id uuid;
  _last_used_at timestamptz;
begin
  select k.id, k.user_id, k.last_used_at
    into _key_id, _key_user_id, _last_used_at
    from public.platform_api_keys k
   where k.key_hash = _key_hash
     and k.revoked_at is null;

  if not found then
    return;
  end if;

  if _last_used_at is null or _last_used_at < now() - interval '1 minute' then
    update public.platform_api_keys
       set last_used_at = now()
     where id = _key_id;
  end if;

  return query
    select _key_id, _key_user_id, s.tier, s.status
      from (select 1) as one
      left join public.subscriptions s on s.user_id = _key_user_id;
end;
$$;

revoke all on function public.authenticate_mcp_platform_key(text)
  from public, anon, authenticated;
grant execute on function public.authenticate_mcp_platform_key(text) to service_role;

-- 3. Shared session capabilities --------------------------------------------

alter table public.mcp_ephemeral_state
  drop constraint if exists mcp_ephemeral_state_kind_check;
alter table public.mcp_ephemeral_state
  add constraint mcp_ephemeral_state_kind_check
  check (kind in ('elicitation', 'request_state_nonce', 'session_capabilities'));
