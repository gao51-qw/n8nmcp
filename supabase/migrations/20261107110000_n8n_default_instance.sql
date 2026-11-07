-- Selectable default n8n instance for MCP.
--
-- Until now MCP always used a user's oldest instance. Users can now pick which
-- instance MCP works with; the choice is stored in n8n_instances.is_default.
--
-- Invariant: a user who has any instance has exactly one default instance.
--   * At most one: the partial unique index n8n_instances_one_default_per_user.
--   * At least one: enforced by triggers, not by application code.
--       - BEFORE INSERT: the row becomes the default exactly when the user has
--         no default yet (the requested is_default value is ignored), so the
--         first instance is the default and later ones are not.
--       - AFTER DELETE of the default: the oldest remaining instance of the
--         user is promoted.
--       - BEFORE UPDATE: is_default may only change inside
--         set_default_n8n_instance() or the promotion trigger, and user_id
--         never changes (moving a row between users would break the
--         invariant for both of them).
--       - BEFORE DELETE: rows are deleted only inside delete_n8n_instance(),
--         or by the ON DELETE CASCADE of their auth.users row (account
--         deletion).
--
-- Lock order. Every path that decides which row is the default or removes a
-- row takes a transaction-scoped advisory lock for the user FIRST and only
-- then locks or changes n8n_instances rows:
--   * INSERT: the BEFORE INSERT trigger takes it before the row exists.
--   * delete_n8n_instance(): takes it before the DELETE locks the row; the
--     promotion trigger then runs inside the same locked section.
--   * set_default_n8n_instance(): takes it before locking any row.
-- With one lock order no two of these can wait for each other in a cycle:
-- whoever holds the advisory lock only waits for row locks of transactions
-- that do not hold (and never wait for) that lock. Each decision also sees the
-- committed result of the previous one (READ COMMITTED takes a fresh
-- snapshot per statement, and every statement here runs after the lock).
-- A plain DELETE locks its row before any trigger could take the advisory
-- lock, which is why direct deletes are rejected instead of supported.
--
-- Row order. After the advisory lock, delete_n8n_instance() and
-- set_default_n8n_instance() lock all of the user's rows (at most 20) in
-- physical (ctid) order before changing any. The ON DELETE CASCADE of an
-- account deletion cannot take the advisory lock; it locks the same rows in
-- its scan order, which is also physical order (a sequential scan, or a
-- user_id index whose duplicates are kept in heap TID order). So neither side
-- holds one of these rows while waiting for another the other side holds.
-- NO KEY UPDATE is the lock the following UPDATE takes anyway and does not
-- block foreign-key checks of referencing rows.
--
-- Account deletion removes the auth.users row; the cascade deletes all of
-- the user's rows (their row locks come before any trigger runs). The guard
-- lets it through when the user's auth.users row is gone, and the promotion
-- trigger then does nothing, so the cascade never takes the advisory lock and
-- cannot deadlock with an insert that holds it and waits for the user row.
--
-- Whatever still fails (a REPEATABLE READ caller with an old snapshot gets
-- 40001; an account deletion whose cascade scan meets a row that a
-- concurrent switch or update just moved to a new ctid follows it out of
-- physical order and can still cross a switch or delete: 40P01, rare) ends
-- in an error and a rollback, never in a second or a missing default: the
-- unique index and the guards fail closed, and the application retries
-- 40001/40P01 once.

-- 1. Column, backfill, index ------------------------------------------------

alter table public.n8n_instances
  add column if not exists is_default boolean not null default false;

-- The oldest instance of every user without a default becomes the default:
-- the instance MCP used until now.
update public.n8n_instances as i
   set is_default = true
  from (
    select distinct on (user_id) id
      from public.n8n_instances
     order by user_id, created_at, id
  ) as oldest
 where i.id = oldest.id
   and not exists (
     select 1
       from public.n8n_instances d
      where d.user_id = i.user_id
        and d.is_default
   );

create unique index if not exists n8n_instances_one_default_per_user
  on public.n8n_instances (user_id)
  where is_default;

-- 2. Insert: the first instance becomes the default ---------------------------

create or replace function public.tg_n8n_instances_default_on_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The advisory lock comes first: the new row does not exist yet, and an
  -- INSERT locks no other row of the user before this trigger runs.
  perform pg_advisory_xact_lock(
    hashtext('public.n8n_instances.is_default'),
    hashtext(new.user_id::text)
  );

  new.is_default := not exists (
    select 1
      from public.n8n_instances
     where user_id = new.user_id
       and is_default
  );
  return new;
end;
$$;

drop trigger if exists n8n_instances_default_on_insert on public.n8n_instances;
create trigger n8n_instances_default_on_insert
  before insert on public.n8n_instances
  for each row execute function public.tg_n8n_instances_default_on_insert();

-- 3. Update guard -------------------------------------------------------------

create or replace function public.tg_n8n_instances_guard_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.user_id is distinct from old.user_id then
    raise exception 'n8n_instances.user_id cannot change'
      using errcode = '42501';
  end if;
  if new.is_default is distinct from old.is_default
     and coalesce(current_setting('app.n8n_instance_default_change', true), '') <> 'on' then
    raise exception 'n8n_instances.is_default changes only through set_default_n8n_instance()'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists n8n_instances_guard_default on public.n8n_instances;
create trigger n8n_instances_guard_default
  before update of is_default, user_id on public.n8n_instances
  for each row
  when (
    old.is_default is distinct from new.is_default
    or old.user_id is distinct from new.user_id
  )
  execute function public.tg_n8n_instances_guard_default();

-- 4. Delete: only through delete_n8n_instance() or the account cascade ----------

create or replace function public.tg_n8n_instances_guard_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('app.n8n_instance_delete', true), '') = 'on' then
    return old;
  end if;
  -- Account deletion: the ON DELETE CASCADE from auth.users runs inside the
  -- referential-integrity trigger (depth > 1) after the user row is deleted,
  -- so this transaction no longer sees it. The foreign key keeps every other
  -- row tied to an existing user.
  if pg_trigger_depth() > 1
     and not exists (select 1 from auth.users where id = old.user_id) then
    return old;
  end if;
  raise exception 'n8n_instances rows are deleted only through delete_n8n_instance()'
    using errcode = '42501';
end;
$$;

drop trigger if exists n8n_instances_guard_delete on public.n8n_instances;
create trigger n8n_instances_guard_delete
  before delete on public.n8n_instances
  for each row execute function public.tg_n8n_instances_guard_delete();

-- After the default is deleted, promote the oldest remaining instance.
create or replace function public.tg_n8n_instances_promote_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  _next uuid;
  _updated integer;
begin
  -- Account deletion removes every instance of the user: nothing to promote,
  -- and the cascade must not wait for the advisory lock while it holds row
  -- locks (an insert holding the lock waits for the deleted user row).
  if not exists (select 1 from auth.users where id = old.user_id) then
    return null;
  end if;

  -- Already held by delete_n8n_instance(); taking it again is a no-op.
  perform pg_advisory_xact_lock(
    hashtext('public.n8n_instances.is_default'),
    hashtext(old.user_id::text)
  );

  -- Row-level AFTER triggers see every change of the deleting statement, so a
  -- statement that removes all of a user's instances promotes nothing.
  if exists (
    select 1
      from public.n8n_instances
     where user_id = old.user_id
       and is_default
  ) then
    return null;
  end if;

  loop
    select id
      into _next
      from public.n8n_instances
     where user_id = old.user_id
     order by created_at, id
     limit 1;
    exit when _next is null;

    perform set_config('app.n8n_instance_default_change', 'on', true);
    update public.n8n_instances
       set is_default = true
     where id = _next;
    get diagnostics _updated = row_count;
    perform set_config('app.n8n_instance_default_change', 'off', true);

    -- 0 rows: the candidate was deleted concurrently (only the account
    -- cascade deletes without the advisory lock); the next statement's
    -- snapshot no longer contains it.
    exit when _updated > 0;
  end loop;

  return null;
end;
$$;

drop trigger if exists n8n_instances_promote_default on public.n8n_instances;
create trigger n8n_instances_promote_default
  after delete on public.n8n_instances
  for each row
  when (old.is_default)
  execute function public.tg_n8n_instances_promote_default();

-- Deletes _instance_id when it belongs to _user_id. Returns false (and changes
-- nothing) when the instance does not exist or belongs to someone else. When
-- it was the default, the promotion trigger makes the oldest remaining
-- instance the default within the same advisory-locked section.
create or replace function public.delete_n8n_instance(_user_id uuid, _instance_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  _deleted integer;
begin
  if _user_id is null or _instance_id is null then
    raise exception 'delete_n8n_instance: _user_id and _instance_id are required'
      using errcode = '22004';
  end if;

  -- Advisory lock first, before the DELETE locks the row.
  perform pg_advisory_xact_lock(
    hashtext('public.n8n_instances.is_default'),
    hashtext(_user_id::text)
  );
  -- Then every row of the user, in physical (ctid) order: see "Row order".
  perform 1
     from public.n8n_instances
    where user_id = _user_id
    order by ctid
    for no key update;

  perform set_config('app.n8n_instance_delete', 'on', true);
  delete from public.n8n_instances
   where id = _instance_id
     and user_id = _user_id;
  get diagnostics _deleted = row_count;
  perform set_config('app.n8n_instance_delete', 'off', true);

  return _deleted > 0;
end;
$$;

-- 5. Choosing the default -------------------------------------------------------

-- Makes _instance_id the default instance of _user_id. Returns false (and
-- changes nothing) when the instance does not exist or belongs to someone
-- else; true when it is the default afterwards, including when it already was.
create or replace function public.set_default_n8n_instance(_user_id uuid, _instance_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if _user_id is null or _instance_id is null then
    raise exception 'set_default_n8n_instance: _user_id and _instance_id are required'
      using errcode = '22004';
  end if;

  -- Advisory lock first, before any row lock (see the lock order above).
  perform pg_advisory_xact_lock(
    hashtext('public.n8n_instances.is_default'),
    hashtext(_user_id::text)
  );
  -- Then every row of the user, in physical (ctid) order: see "Row order".
  perform 1
     from public.n8n_instances
    where user_id = _user_id
    order by ctid
    for no key update;

  perform 1
     from public.n8n_instances
    where id = _instance_id
      and user_id = _user_id;
  if not found then
    return false;
  end if;

  perform set_config('app.n8n_instance_default_change', 'on', true);
  update public.n8n_instances
     set is_default = false
   where user_id = _user_id
     and is_default
     and id <> _instance_id;
  update public.n8n_instances
     set is_default = true
   where id = _instance_id
     and not is_default;
  perform set_config('app.n8n_instance_default_change', 'off', true);

  return true;
end;
$$;

revoke all on function public.set_default_n8n_instance(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.set_default_n8n_instance(uuid, uuid) to service_role;

revoke all on function public.delete_n8n_instance(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.delete_n8n_instance(uuid, uuid) to service_role;

revoke all on function public.tg_n8n_instances_default_on_insert()
  from public, anon, authenticated;
revoke all on function public.tg_n8n_instances_guard_default()
  from public, anon, authenticated;
revoke all on function public.tg_n8n_instances_guard_delete()
  from public, anon, authenticated;
revoke all on function public.tg_n8n_instances_promote_default()
  from public, anon, authenticated;
