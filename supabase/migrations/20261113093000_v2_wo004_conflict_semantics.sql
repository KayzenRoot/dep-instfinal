-- V2 WO-004 conflict semantics.
-- Business conflicts use P0001 (raise_exception), not 40001 (serialization_failure),
-- because PostgREST retries 40001 automatically and a stale expected_version must
-- return a bounded 409 instead of a retry storm. Status also rejects NULL values.

-- Additive migration: recreate the server-only RPCs with the corrected SQLSTATEs.

drop function if exists public.save_video_edit_plan(uuid, integer, jsonb, text, text);
drop function if exists public.restore_video_edit_plan(uuid, integer, integer, text);
drop function if exists public.set_video_edit_plan_status(uuid, integer, text);

create or replace function public.save_video_edit_plan(
  p_owner_id uuid,
  p_episode_id uuid,
  p_expected_version integer,
  p_plan jsonb,
  p_manifest_hash text,
  p_change_note text default ''
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_episode public.episodes;
  v_plan public.video_edit_plans;
  v_version integer;
begin
  if p_owner_id is null or p_episode_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'edit_plan_expected_version_invalid' using errcode = '23514';
  end if;
  if p_manifest_hash is null or p_manifest_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'edit_plan_manifest_hash_invalid' using errcode = '23514';
  end if;
  if jsonb_typeof(p_plan) is distinct from 'object'
    or p_plan ->> 'schemaVersion' is distinct from '1'
    or p_plan ->> 'episodeId' is distinct from p_episode_id::text
    or jsonb_typeof(p_plan -> 'tracks') is distinct from 'array'
    or jsonb_typeof(p_plan -> 'clips') is distinct from 'array'
    or jsonb_array_length(p_plan -> 'clips') not between 1 and 60
    or coalesce((p_plan ->> 'durationMs')::integer, 0) not between 90000 and 150000 then
    raise exception 'edit_plan_shape_invalid' using errcode = '23514';
  end if;

  select e.* into v_episode from public.episodes e
  where e.owner_id = p_owner_id and e.id = p_episode_id
  for update;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;
  if v_episode.status = 'PUBLISHED' then
    raise exception 'published_episode_is_immutable' using errcode = '55000';
  end if;

  select p.* into v_plan from public.video_edit_plans p
  where p.owner_id = p_owner_id and p.episode_id = p_episode_id
  for update;
  if not found then
    if p_expected_version <> 0 then
      raise exception 'edit_plan_version_conflict' using errcode = 'P0001';
    end if;
    insert into public.video_edit_plans (
      owner_id, episode_id, current_version, current_status, plan, manifest_hash,
      episode_revision_number
    ) values (
      p_owner_id, p_episode_id, 1, 'DRAFT', p_plan, p_manifest_hash,
      nullif(p_plan ->> 'episodeRevisionNumber', '')::integer
    ) returning * into v_plan;
    v_version := 1;
  else
    if v_plan.current_version <> p_expected_version then
      raise exception 'edit_plan_version_conflict' using errcode = 'P0001';
    end if;
    v_version := v_plan.current_version + 1;
    update public.video_edit_plans p
    set current_version = v_version,
        current_status = 'DRAFT',
        plan = p_plan,
        manifest_hash = p_manifest_hash,
        episode_revision_number = nullif(p_plan ->> 'episodeRevisionNumber', '')::integer
    where p.owner_id = p_owner_id and p.id = v_plan.id
    returning * into v_plan;
  end if;

  insert into public.video_edit_plan_versions (
    owner_id, plan_id, episode_id, version, plan, manifest_hash, change_note
  ) values (
    p_owner_id, v_plan.id, p_episode_id, v_version, p_plan, p_manifest_hash,
    left(coalesce(p_change_note, ''), 500)
  );
  return v_version;
end;
$$;

create or replace function public.restore_video_edit_plan(
  p_owner_id uuid,
  p_episode_id uuid,
  p_version integer,
  p_expected_version integer,
  p_change_note text default ''
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_episode public.episodes;
  v_plan public.video_edit_plans;
  v_source public.video_edit_plan_versions;
  v_next integer;
begin
  if p_owner_id is null or p_episode_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_version is null or p_version < 1
    or p_expected_version is null or p_expected_version < 0 then
    raise exception 'edit_plan_version_invalid' using errcode = '23514';
  end if;
  select e.* into v_episode from public.episodes e
  where e.owner_id = p_owner_id and e.id = p_episode_id
  for update;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;
  if v_episode.status = 'PUBLISHED' then
    raise exception 'published_episode_is_immutable' using errcode = '55000';
  end if;
  select p.* into v_plan from public.video_edit_plans p
  where p.owner_id = p_owner_id and p.episode_id = p_episode_id
  for update;
  if not found then raise exception 'edit_plan_not_found' using errcode = 'P0002'; end if;
  if v_plan.current_version <> p_expected_version then
    raise exception 'edit_plan_version_conflict' using errcode = 'P0001';
  end if;
  select v.* into v_source from public.video_edit_plan_versions v
  where v.owner_id = p_owner_id and v.plan_id = v_plan.id and v.version = p_version;
  if not found then raise exception 'edit_plan_version_not_found' using errcode = 'P0002'; end if;

  v_next := v_plan.current_version + 1;
  update public.video_edit_plans p
  set current_version = v_next,
      current_status = 'DRAFT',
      plan = v_source.plan,
      manifest_hash = v_source.manifest_hash,
      episode_revision_number = nullif(v_source.plan ->> 'episodeRevisionNumber', '')::integer
  where p.owner_id = p_owner_id and p.id = v_plan.id;
  insert into public.video_edit_plan_versions (
    owner_id, plan_id, episode_id, version, plan, manifest_hash, change_note
  ) values (
    p_owner_id, v_plan.id, p_episode_id, v_next, v_source.plan, v_source.manifest_hash,
    left(coalesce(nullif(p_change_note, ''), 'Restauração da versão ' || p_version::text), 500)
  );
  return v_next;
end;
$$;

create or replace function public.set_video_edit_plan_status(
  p_owner_id uuid,
  p_episode_id uuid,
  p_expected_version integer,
  p_status text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_episode public.episodes;
  v_plan public.video_edit_plans;
begin
  if p_owner_id is null or p_episode_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'edit_plan_expected_version_invalid' using errcode = '23514';
  end if;
  if p_status is null or p_status not in ('DRAFT', 'APPROVED') then
    raise exception 'edit_plan_status_invalid' using errcode = '23514';
  end if;
  select e.* into v_episode from public.episodes e
  where e.owner_id = p_owner_id and e.id = p_episode_id
  for update;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;
  if v_episode.status = 'PUBLISHED' then
    raise exception 'published_episode_is_immutable' using errcode = '55000';
  end if;
  select p.* into v_plan from public.video_edit_plans p
  where p.owner_id = p_owner_id and p.episode_id = p_episode_id
  for update;
  if not found then raise exception 'edit_plan_not_found' using errcode = 'P0002'; end if;
  if v_plan.current_version <> p_expected_version then
    raise exception 'edit_plan_version_conflict' using errcode = 'P0001';
  end if;
  update public.video_edit_plans p
  set current_status = p_status
  where p.owner_id = p_owner_id and p.id = v_plan.id;
end;
$$;

revoke all on function public.save_video_edit_plan(uuid, uuid, integer, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.restore_video_edit_plan(uuid, uuid, integer, integer, text)
  from public, anon, authenticated;
revoke all on function public.set_video_edit_plan_status(uuid, uuid, integer, text)
  from public, anon, authenticated;
grant execute on function public.save_video_edit_plan(uuid, uuid, integer, jsonb, text, text)
  to service_role;
grant execute on function public.restore_video_edit_plan(uuid, uuid, integer, integer, text)
  to service_role;
grant execute on function public.set_video_edit_plan_status(uuid, uuid, integer, text)
  to service_role;

revoke all on function public.reject_video_edit_plan_version_mutation()
  from public, anon, authenticated;
revoke all on function public.guard_video_upload_session_update()
  from public, anon, authenticated;

comment on function public.save_video_edit_plan(uuid, uuid, integer, jsonb, text, text) is
  'Server-only edit-plan write with optimistic concurrency; the server validates plan and hash.';
comment on function public.restore_video_edit_plan(uuid, uuid, integer, integer, text) is
  'Server-only restore that appends a new plan version rather than rewriting history.';
comment on function public.set_video_edit_plan_status(uuid, uuid, integer, text) is
  'Server-only DRAFT/APPROVED transition for the current plan version.';
