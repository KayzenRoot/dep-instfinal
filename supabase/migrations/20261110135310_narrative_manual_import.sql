-- Store a validated manual narrative response and both choices as one owner-scoped revision.
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
  v_scene_count integer;
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
  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 180
    or char_length(btrim(coalesce(p_logline, ''))) not between 1 and 1000
    or char_length(btrim(coalesce(p_hook, ''))) not between 1 and 2000
    or char_length(btrim(coalesce(p_narrative, ''))) not between 1 and 30000
    or char_length(btrim(coalesce(p_reveal, ''))) not between 1 and 2000
    or char_length(btrim(coalesce(p_cliffhanger, ''))) not between 1 and 2000
    or char_length(btrim(coalesce(p_narration_pt_br, ''))) not between 1 and 30000 then
    raise exception 'narrative_response_required_fields_invalid' using errcode = '23514';
  end if;
  if char_length(btrim(coalesce(p_option_1_label, ''))) not between 1 and 180
    or char_length(btrim(coalesce(p_option_2_label, ''))) not between 1 and 180
    or char_length(btrim(coalesce(p_option_1_consequence, ''))) not between 1 and 4000
    or char_length(btrim(coalesce(p_option_2_consequence, ''))) not between 1 and 4000
    or lower(btrim(p_option_1_label)) = lower(btrim(p_option_2_label))
    or lower(btrim(p_option_1_consequence)) = lower(btrim(p_option_2_consequence)) then
    raise exception 'episode_choices_must_differ' using errcode = '23514';
  end if;

  select e.* into v_episode
  from public.episodes e
  where e.owner_id = v_owner_id and e.id = p_episode_id
  for update;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;
  if v_episode.status = 'PUBLISHED' then
    raise exception 'published_episode_is_immutable' using errcode = '55000';
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

  v_scene_count := ceil(p_duration_ms::numeric / 8000)::integer;
  delete from public.scenes s
  where s.owner_id = v_owner_id and s.episode_id = p_episode_id and s.scene_index > v_scene_count;
  for v_scene in 1..v_scene_count loop
    update public.scenes set
      start_ms = (v_scene - 1) * 8000,
      end_ms = least(v_scene * 8000, p_duration_ms)
    where owner_id = v_owner_id and episode_id = p_episode_id and scene_index = v_scene;
    if not found then
      insert into public.scenes (owner_id, episode_id, scene_index, start_ms, end_ms)
      values (v_owner_id, p_episode_id, v_scene, (v_scene - 1) * 8000, least(v_scene * 8000, p_duration_ms));
    end if;
  end loop;

  insert into public.choices (owner_id, episode_id, option_key, label, consequence)
  values
    (v_owner_id, p_episode_id, '1', p_option_1_label, p_option_1_consequence),
    (v_owner_id, p_episode_id, '2', p_option_2_label, p_option_2_consequence)
  on conflict (owner_id, episode_id, option_key) do update
  set label = excluded.label, consequence = excluded.consequence;

  return public.append_episode_revision(p_episode_id, 'Importação validada de roteiro e opções');
end;
$$;

revoke all on function public.import_narrative_response(uuid, text, text, text, text, text, text, text, integer, jsonb, text, text, text, text) from public, anon;
grant execute on function public.import_narrative_response(uuid, text, text, text, text, text, text, text, integer, jsonb, text, text, text, text) to authenticated;
