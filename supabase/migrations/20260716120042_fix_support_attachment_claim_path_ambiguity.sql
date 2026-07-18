create or replace function public.support_claim_expired_attachments(
  _expired_before timestamptz,
  _limit integer default 100
)
returns table(path text, name text, ticket_id uuid, expired_at timestamptz)
language plpgsql
security definer
set search_path = pg_catalog, public
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
    on conflict on constraint support_attachment_cleanup_claims_pkey do nothing
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

revoke all on function public.support_claim_expired_attachments(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.support_claim_expired_attachments(timestamptz, integer)
  to service_role;
