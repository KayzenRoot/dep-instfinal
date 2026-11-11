-- CD06 actions for configurable scene duration and production metadata.
create or replace function public.set_episode_scene_duration(
  p_episode_id uuid,
  p_scene_duration_ms integer,
  p_duration_ms integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_owner_id uuid := auth.uid();
  v_status text;
  v_has_scene_content boolean;
  v_duration_ms integer := p_duration_ms;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_scene_duration_ms not in (4000, 6000, 8000) then
    raise exception 'invalid_scene_duration' using errcode = '22023';
  end if;
  if v_duration_ms is null or v_duration_ms < 90000 or v_duration_ms > 150000 then
    raise exception 'invalid_episode_duration' using errcode = '22023';
  end if;

  select e.status into v_status
  from public.episodes e
  where e.owner_id = v_owner_id and e.id = p_episode_id;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;
  if v_status = 'PUBLISHED' then raise exception 'published_episode_immutable' using errcode = '23514'; end if;

  v_has_scene_content := exists (
    select 1
    from public.scenes s
    where s.owner_id = v_owner_id
      and s.episode_id = p_episode_id
      and (
        btrim(s.narration_pt_br) <> '' or btrim(s.visual_description) <> ''
        or btrim(s.camera_notes) <> '' or btrim(s.lighting_notes) <> ''
        or btrim(s.start_frame_prompt_en) <> '' or btrim(s.end_frame_prompt_en) <> ''
        or btrim(s.motion_prompt_en) <> '' or btrim(s.audio_notes) <> ''
        or btrim(s.location) <> '' or btrim(s.character_notes) <> ''
        or btrim(s.vhs_effects) <> '' or btrim(s.transition) <> ''
        or s.start_frame_asset_id is not null or s.end_frame_asset_id is not null
        or s.prompt_status <> 'TODO' or s.generation_attempts <> 0
      )
  ) or exists (
    select 1
    from public.image_references r
    join public.scenes s on s.owner_id = r.owner_id and s.id = r.scene_id
    where r.owner_id = v_owner_id and s.episode_id = p_episode_id
  );

  if v_has_scene_content then
    raise exception 'episode_scenes_not_empty' using errcode = '23514';
  end if;

  delete from public.scenes
  where owner_id = v_owner_id and episode_id = p_episode_id;

  update public.episodes
  set scene_duration_ms = p_scene_duration_ms,
      duration_ms = v_duration_ms,
      updated_at = now()
  where owner_id = v_owner_id and id = p_episode_id;

  insert into public.scenes (owner_id, episode_id, scene_index, start_ms, end_ms)
  select
    v_owner_id,
    p_episode_id,
    g,
    (g - 1) * p_scene_duration_ms,
    least(g * p_scene_duration_ms, v_duration_ms)
  from generate_series(1, ceil(v_duration_ms::numeric / p_scene_duration_ms)::integer) as g;
end;
$$;

revoke all on function public.set_episode_scene_duration(uuid, integer, integer) from public, anon;
grant execute on function public.set_episode_scene_duration(uuid, integer, integer) to authenticated;

create or replace function public.save_scene_production(
  p_scene_id uuid,
  p_location text,
  p_character_notes text,
  p_vhs_effects text,
  p_transition text,
  p_prompt_status text,
  p_generation_attempts integer
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_owner_id uuid := auth.uid();
  v_episode_status text;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_prompt_status not in ('TODO', 'READY', 'GENERATED', 'APPROVED') then
    raise exception 'invalid_prompt_status' using errcode = '22023';
  end if;
  if p_generation_attempts < 0 or p_generation_attempts > 10 then
    raise exception 'invalid_generation_attempts' using errcode = '22023';
  end if;

  select e.status into v_episode_status
  from public.scenes s
  join public.episodes e on e.owner_id = s.owner_id and e.id = s.episode_id
  where s.owner_id = v_owner_id and s.id = p_scene_id;
  if not found then raise exception 'scene_not_found' using errcode = 'P0002'; end if;
  if v_episode_status = 'PUBLISHED' then raise exception 'published_episode_immutable' using errcode = '23514'; end if;

  update public.scenes
  set location = btrim(p_location),
      character_notes = btrim(p_character_notes),
      vhs_effects = btrim(p_vhs_effects),
      transition = btrim(p_transition),
      prompt_status = p_prompt_status,
      generation_attempts = p_generation_attempts,
      updated_at = now()
  where owner_id = v_owner_id and id = p_scene_id;
end;
$$;

revoke all on function public.save_scene_production(uuid, text, text, text, text, text, integer) from public, anon;
grant execute on function public.save_scene_production(uuid, text, text, text, text, text, integer) to authenticated;

comment on function public.set_episode_scene_duration(uuid, integer, integer)
is 'CD06: rebuilds an empty draft episode timeline for a 4/6/8 second scene length.';
comment on function public.save_scene_production(uuid, text, text, text, text, text, integer)
is 'CD06: saves per-scene location, character, VHS, transition, prompt status and attempt count.';
