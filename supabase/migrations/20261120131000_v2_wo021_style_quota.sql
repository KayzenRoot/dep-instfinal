-- V2 WO-021 follow-up: bounded style history. The preset row is updated
-- before the revision insert, so concurrent writers serialize per preset and
-- the quota cannot be exceeded by a race between two servers.
create or replace function public.enforce_style_revision_quota()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
declare
  v_count integer;
begin
  select count(*) into v_count
  from public.style_preset_revisions r
  where r.owner_id = new.owner_id and r.preset_id = new.preset_id;
  if v_count >= 200 then
    raise exception 'style_revision_quota' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger style_preset_revisions_quota
  before insert on public.style_preset_revisions
  for each row execute function public.enforce_style_revision_quota();

revoke all on function public.enforce_style_revision_quota() from public, anon, authenticated;

comment on function public.enforce_style_revision_quota() is
  'Caps one preset at 200 revisions so the immutable history stays bounded.';
