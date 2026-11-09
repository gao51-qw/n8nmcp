-- Account deletion for support staff.
--
-- support_ticket_tags.created_by, support_ticket_internal_notes.author_id and
-- support_ticket_events.actor_id reference auth.users without an ON DELETE
-- action, so auth.admin.deleteUser() fails for any admin who ever tagged,
-- annotated or acted on another user's ticket (an account's own tickets are
-- deleted first and cascade, so customers were never affected). Those rows
-- are the ticket's history, not the agent's data: they stay and lose their
-- author (ON DELETE SET NULL), with the two NOT NULL constraints relaxed.
-- support_ticket_replies.author_id has no foreign key and is unchanged.
--
-- The existing constraint names are looked up rather than assumed, so this
-- applies whether the originals were auto-named or renamed. Re-running it is
-- harmless.

do $$
declare
  target record;
  existing text;
begin
  for target in
    select *
      from (values
        ('support_ticket_tags', 'created_by', 'support_ticket_tags_created_by_fkey'),
        ('support_ticket_internal_notes', 'author_id', 'support_ticket_internal_notes_author_id_fkey'),
        ('support_ticket_events', 'actor_id', 'support_ticket_events_actor_id_fkey')
      ) as t(table_name, column_name, constraint_name)
  loop
    for existing in
      select con.conname
        from pg_constraint con
        join pg_class rel on rel.oid = con.conrelid
        join pg_namespace nsp on nsp.oid = rel.relnamespace
        join pg_attribute att on att.attrelid = rel.oid and att.attnum = any (con.conkey)
       where nsp.nspname = 'public'
         and rel.relname = target.table_name
         and con.contype = 'f'
         and con.confrelid = 'auth.users'::regclass
         and att.attname = target.column_name
    loop
      execute format('alter table public.%I drop constraint %I', target.table_name, existing);
    end loop;

    execute format(
      'alter table public.%I alter column %I drop not null',
      target.table_name,
      target.column_name
    );
    execute format(
      'alter table public.%I add constraint %I foreign key (%I) '
        || 'references auth.users(id) on delete set null',
      target.table_name,
      target.constraint_name,
      target.column_name
    );
  end loop;
end
$$;
