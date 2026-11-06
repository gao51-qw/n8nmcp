-- Atomic daily MCP quota reservation.
--
-- get_today_mcp_usage() + increment_mcp_usage() is check-then-act: concurrent
-- tools/call requests all read the same counter, all pass the limit check, and
-- only increment after the tool has run, so parallel calls overshoot the tier
-- limit. reserve_mcp_usage() reserves the units *before* the call runs, in one
-- statement that cannot overshoot; release_mcp_usage() refunds a reservation
-- for a call that ended up doing no billable work.
--
-- Both read and write public.usage_daily (one row per user per CURRENT_DATE),
-- the same counter that get_today_mcp_usage() / increment_mcp_usage() use.

-- Returns one row: whether the reservation was taken, the counter after the
-- call (unchanged when denied) and the limit it was checked against.
--
-- Atomicity: the reservation is a single INSERT ... ON CONFLICT DO UPDATE ...
-- WHERE statement. When the day's row exists, ON CONFLICT takes the row lock
-- and evaluates `mcp_calls + _n <= _limit` against the latest committed row
-- version, so concurrent reservations for the same user serialise on that row
-- and the counter can never pass _limit. When no row exists yet, the
-- `WHERE _n <= _limit` guard on the inserted row enforces the same bound, and a
-- concurrent first insert falls into the ON CONFLICT branch.
create or replace function public.reserve_mcp_usage(
  _user_id uuid,
  _limit integer,
  _n integer default 1
)
returns table (allowed boolean, used integer, quota_limit integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  _after integer;
begin
  if _user_id is null then
    raise exception 'reserve_mcp_usage: _user_id is required' using errcode = '22004';
  end if;
  if _limit is null or _limit < 0 then
    raise exception 'reserve_mcp_usage: _limit must be >= 0' using errcode = '22023';
  end if;
  if _n is null or _n < 1 then
    raise exception 'reserve_mcp_usage: _n must be >= 1' using errcode = '22023';
  end if;

  insert into public.usage_daily as u (user_id, day, mcp_calls)
  select _user_id, current_date, _n
  where _n <= _limit
  on conflict (user_id, day)
  do update set mcp_calls = u.mcp_calls + excluded.mcp_calls
    where u.mcp_calls + excluded.mcp_calls <= _limit
  returning u.mcp_calls into _after;

  if _after is not null then
    return query select true, _after, _limit;
    return;
  end if;

  -- Denied: report the current counter (informational only).
  select u.mcp_calls into _after
  from public.usage_daily u
  where u.user_id = _user_id and u.day = current_date;

  return query select false, coalesce(_after, 0), _limit;
end $$;

revoke all on function public.reserve_mcp_usage(uuid, integer, integer) from public;
revoke execute on function public.reserve_mcp_usage(uuid, integer, integer) from anon, authenticated;
grant execute on function public.reserve_mcp_usage(uuid, integer, integer) to service_role;

-- Refunds _n reserved units for today; the counter never goes below 0.
-- Returns the counter after the refund (0 when there is no row for today).
-- A refund that crosses midnight lands on the new day's row and is clamped at
-- 0, so it can only ever favour the user by at most the refunded units.
create or replace function public.release_mcp_usage(_user_id uuid, _n integer default 1)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  _after integer;
begin
  update public.usage_daily u
  set mcp_calls = greatest(u.mcp_calls - greatest(coalesce(_n, 0), 0), 0)
  where u.user_id = _user_id and u.day = current_date
  returning u.mcp_calls into _after;

  return coalesce(_after, 0);
end $$;

revoke all on function public.release_mcp_usage(uuid, integer) from public;
revoke execute on function public.release_mcp_usage(uuid, integer) from anon, authenticated;
grant execute on function public.release_mcp_usage(uuid, integer) to service_role;
