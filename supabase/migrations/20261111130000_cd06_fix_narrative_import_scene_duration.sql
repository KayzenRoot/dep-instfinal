-- CD06 correction: the narrative import must honor the episode's configured
-- scene duration and must not silently delete scenes that already contain
-- narration, direction, prompts, frames, or image references.
create or replace function public.import_narrative_response(
  p_episode_id uuid,
  p_title text,
  p_logline text,
  p_hook text,
  p_narrative text,
  p_reveal text,
  p_cliffhanger text,
  p_narration_pt_br text,
  p_duration_ms integer,
  p_platform_metadata jsonb,
  p_option_1_label text,
  p_option_1_consequence text,
  p_option_2_label text,
  p_option_2_consequence text
)
returns integer
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_episode public.episodes;
  v_is_finale boolean;
  v_has_option_1 boolean;
  v_has_option_2 boolean;
  v_scene_count integer;
  v_scene_duration_ms integer;
  v_scene integer;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_duration_ms not between 90000 and 150000 then
    raise exception 'episode_duration_out_of_range' using errcode = '23514';
  end if;
  if jsonb_typeof(p_platform_metadata) <> 'object' then
    raise exception 'platform_metadata_must_be_object' using errcode = '23514';
  end if;

  select e.* into v_episode
  from public.episodes e
  where e.owner_id = v_owner_id and e.id = p_episode_id
  for update;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;
  if v_episode.status = 'PUBLISHED' then
    raise exception 'published_episode_is_immutable' using errcode = '55000';
  end if;
  v_scene_duration_ms := coalesce(v_episode.scene_duration_ms, 8000);

  select e.episode_number = s.planned_episode_count into v_is_finale
  from public.episodes e
  join public.seasons s on s.owner_id = e.owner_id and s.id = e.season_id
  where e.owner_id = v_owner_id and e.id = p_episode_id;

  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 180
    or char_length(btrim(coalesce(p_logline, ''))) not between 1 and 1000
    or char_length(btrim(coalesce(p_hook, ''))) not between 1 and 2000
    or char_length(btrim(coalesce(p_narrative, ''))) not between 1 and 30000
    or char_length(btrim(coalesce(p_reveal, ''))) not between 1 and 2000
    or char_length(btrim(coalesce(p_cliffhanger, ''))) not between 1 and 2000
    or char_length(btrim(coalesce(p_narration_pt_br, ''))) not between 1 and 30000 then
    raise exception 'narrative_response_required_fields_invalid' using errcode = '23514';
  end if;

  v_has_option_1 := char_length(btrim(coalesce(p_option_1_label, ''))) > 0
    or char_length(btrim(coalesce(p_option_1_consequence, ''))) > 0;
  v_has_option_2 := char_length(btrim(coalesce(p_option_2_label, ''))) > 0
    or char_length(btrim(coalesce(p_option_2_consequence, ''))) > 0;
  if (not v_is_finale and (not v_has_option_1 or not v_has_option_2))
    or (v_has_option_1 <> v_has_option_2) then
    raise exception 'episode_requires_two_choices_unless_finale' using errcode = '23514';
  end if;
  if v_has_option_1 and (
    char_length(btrim(coalesce(p_option_1_label, ''))) not between 1 and 180
    or char_length(btrim(coalesce(p_option_2_label, ''))) not between 1 and 180
    or char_length(btrim(coalesce(p_option_1_consequence, ''))) not between 1 and 4000
    or char_length(btrim(coalesce(p_option_2_consequence, ''))) not between 1 and 4000
    or lower(btrim(p_option_1_label)) = lower(btrim(p_option_2_label))
    or lower(btrim(p_option_1_consequence)) = lower(btrim(p_option_2_consequence))
  ) then
    raise exception 'episode_choices_must_differ' using errcode = '23514';
  end if;

  v_scene_count := ceil(p_duration_ms::numeric / v_scene_duration_ms)::integer;
  if exists (
    select 1
    from public.scenes s
    where s.owner_id = v_owner_id
      and s.episode_id = p_episode_id
      and s.scene_index > v_scene_count
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
    where r.owner_id = v_owner_id
      and s.episode_id = p_episode_id
      and s.scene_index > v_scene_count
  ) then
    raise exception 'episode_scenes_would_be_truncated' using errcode = '23514';
  end if;

  update public.episodes set
    title = p_title,
    logline = p_logline,
    hook = p_hook,
    narrative = p_narrative,
    reveal = p_reveal,
    cliffhanger = p_cliffhanger,
    narration_pt_br = p_narration_pt_br,
    duration_ms = p_duration_ms,
    status = 'DRAFT',
    platform_metadata = p_platform_metadata
  where owner_id = v_owner_id and id = p_episode_id;

  delete from public.scenes s
  where s.owner_id = v_owner_id and s.episode_id = p_episode_id and s.scene_index > v_scene_count;
  for v_scene in 1..v_scene_count loop
    update public.scenes set
      start_ms = (v_scene - 1) * v_scene_duration_ms,
      end_ms = least(v_scene * v_scene_duration_ms, p_duration_ms)
    where owner_id = v_owner_id and episode_id = p_episode_id and scene_index = v_scene;
    if not found then
      insert into public.scenes (owner_id, episode_id, scene_index, start_ms, end_ms)
      values (
        v_owner_id, p_episode_id, v_scene,
        (v_scene - 1) * v_scene_duration_ms,
        least(v_scene * v_scene_duration_ms, p_duration_ms)
      );
    end if;
  end loop;

  if v_has_option_1 then
    insert into public.choices (owner_id, episode_id, option_key, label, consequence)
    values
      (v_owner_id, p_episode_id, '1', p_option_1_label, p_option_1_consequence),
      (v_owner_id, p_episode_id, '2', p_option_2_label, p_option_2_consequence)
    on conflict (owner_id, episode_id, option_key) do update
    set label = excluded.label, consequence = excluded.consequence;
  else
    delete from public.choices c
    where c.owner_id = v_owner_id and c.episode_id = p_episode_id;
  end if;

  return public.append_episode_revision(p_episode_id, 'Importação validada de roteiro e opções');
end;
$$;
