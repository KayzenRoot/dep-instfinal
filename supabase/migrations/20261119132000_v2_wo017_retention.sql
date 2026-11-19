-- V2 WO-017 retention: bounded append-only histories and an owner-scoped,
-- service-only pruning path for old revisions. Latest decisions remain intact.

create or replace function public.reject_character_identity_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if current_setting('dif.continuity_prune', true) = 'on' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'character_identity_history_is_immutable' using errcode = '55000';
end;
$$;

create or replace function public.enforce_character_identity_history_quota()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (select count(*) from public.character_identity_profile_versions
      where owner_id = new.owner_id and profile_id = new.profile_id) >= 500 then
    raise exception 'identity_version_quota' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger character_identity_version_quota
  before insert on public.character_identity_profile_versions
  for each row execute function public.enforce_character_identity_history_quota();

create or replace function public.enforce_visual_continuity_history_quota()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (select count(*) from public.visual_continuity_reports
      where owner_id = new.owner_id and episode_id = new.episode_id) >= 500 then
    raise exception 'continuity_revision_quota' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger visual_continuity_revision_quota
  before insert on public.visual_continuity_reports
  for each row execute function public.enforce_visual_continuity_history_quota();

create or replace function public.prune_visual_continuity_reports(
  p_owner_id uuid,
  p_episode_id uuid,
  p_keep integer default 50
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  if p_owner_id is null or p_episode_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_keep is null or p_keep < 1 or p_keep > 500 then
    raise exception 'continuity_retention_invalid' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.episodes e
    where e.owner_id = p_owner_id and e.id = p_episode_id
  ) then
    raise exception 'episode_not_found' using errcode = 'P0002';
  end if;
  perform set_config('dif.continuity_prune', 'on', true);
  with doomed as (
    select r.id from public.visual_continuity_reports r
    where r.owner_id = p_owner_id and r.episode_id = p_episode_id
    order by r.revision_number desc
    offset p_keep
  )
  update public.visual_continuity_reports r
  set supersedes_report_id = null
  from doomed d
  where r.supersedes_report_id = d.id;
  with doomed as (
    select r.id from public.visual_continuity_reports r
    where r.owner_id = p_owner_id and r.episode_id = p_episode_id
    order by r.revision_number desc
    offset p_keep
  )
  delete from public.visual_continuity_reports r
  using doomed d where r.id = d.id;
  get diagnostics v_deleted = row_count;
  perform set_config('dif.continuity_prune', 'off', true);
  return v_deleted;
end;
$$;

create or replace function public.prune_character_identity_profile_versions(
  p_owner_id uuid,
  p_character_id uuid,
  p_keep integer default 50
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_profile_id uuid;
  v_deleted integer;
begin
  if p_owner_id is null or p_character_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_keep is null or p_keep < 1 or p_keep > 500 then
    raise exception 'identity_retention_invalid' using errcode = '23514';
  end if;
  select p.id into v_profile_id from public.character_identity_profiles p
  where p.owner_id = p_owner_id and p.character_id = p_character_id;
  if not found then
    raise exception 'identity_profile_not_found' using errcode = 'P0002';
  end if;
  perform set_config('dif.continuity_prune', 'on', true);
  with doomed as (
    select v.id from public.character_identity_profile_versions v
    where v.owner_id = p_owner_id and v.profile_id = v_profile_id
    order by v.version desc
    offset p_keep
  )
  delete from public.character_identity_profile_versions v
  using doomed d where v.id = d.id;
  get diagnostics v_deleted = row_count;
  perform set_config('dif.continuity_prune', 'off', true);
  return v_deleted;
end;
$$;

revoke all on function public.enforce_character_identity_history_quota()
  from public, anon, authenticated;
revoke all on function public.enforce_visual_continuity_history_quota()
  from public, anon, authenticated;
revoke all on function public.prune_visual_continuity_reports(uuid, uuid, integer)
  from public, anon, authenticated;
revoke all on function public.prune_character_identity_profile_versions(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.prune_visual_continuity_reports(uuid, uuid, integer)
  to service_role;
grant execute on function public.prune_character_identity_profile_versions(uuid, uuid, integer)
  to service_role;

comment on function public.prune_visual_continuity_reports(uuid, uuid, integer) is
  'Service-only owner-scoped retention; keeps the newest revisions and preserves the latest decisions.';
comment on function public.prune_character_identity_profile_versions(uuid, uuid, integer) is
  'Service-only owner-scoped retention for profile history; restoring an old version remains possible until pruned.';
