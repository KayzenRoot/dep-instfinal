-- CD06: respect the episode's configured scene duration when saving content.
-- The original function always rebuilt the timeline in 8-second scenes, which
-- silently undid a 4/6-second timeline immediately after a content save.
create or replace function public.save_episode_content(
  p_episode_id uuid,
  p_title text,
  p_logline text,
  p_hook text,
  p_narrative text,
  p_reveal text,
  p_cliffhanger text,
  p_narration_pt_br text,
  p_duration_ms integer,
  p_is_season_finale boolean,
  p_platform_metadata jsonb
)
returns integer language plpgsql set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_episode public.episodes;
  v_scene_count integer;
  v_scene_duration_ms integer;
  v_scene integer;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_duration_ms not between 90000 and 150000 then raise exception 'episode_duration_out_of_range' using errcode = '23514'; end if;
  select e.* into v_episode from public.episodes e
  where e.owner_id = v_owner_id and e.id = p_episode_id for update;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;
  if v_episode.status = 'PUBLISHED' then raise exception 'published_episode_is_immutable' using errcode = '55000'; end if;
  if jsonb_typeof(p_platform_metadata) <> 'object' then raise exception 'platform_metadata_must_be_object' using errcode = '23514'; end if;
  v_scene_duration_ms := coalesce(v_episode.scene_duration_ms, 8000);

  update public.episodes set
    title = p_title,
    logline = p_logline,
    hook = p_hook,
    narrative = p_narrative,
    reveal = p_reveal,
    cliffhanger = p_cliffhanger,
    narration_pt_br = p_narration_pt_br,
    duration_ms = p_duration_ms,
    is_season_finale = p_is_season_finale,
    platform_metadata = p_platform_metadata
  where owner_id = v_owner_id and id = p_episode_id
  returning * into v_episode;

  v_scene_count := ceil(p_duration_ms::numeric / v_scene_duration_ms)::integer;
  delete from public.scenes s where s.owner_id = v_owner_id and s.episode_id = p_episode_id and s.scene_index > v_scene_count;
  for v_scene in 1..v_scene_count loop
    update public.scenes
    set start_ms = (v_scene - 1) * v_scene_duration_ms,
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
  return public.append_episode_revision(p_episode_id, 'Edição do roteiro e da duração');
end;
$$;
