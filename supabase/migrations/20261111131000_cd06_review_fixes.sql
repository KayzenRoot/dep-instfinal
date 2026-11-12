-- CD06 correction: revisioned scene production/reorder, stricter prompt
-- approval, continuity-review enforcement at the database boundary, and
-- bounded scene text fields.
alter table public.scenes
	add constraint scenes_location_length check (char_length(location) <= 300),
	add constraint scenes_character_notes_length check (char_length(character_notes) <= 1000),
	add constraint scenes_vhs_effects_length check (char_length(vhs_effects) <= 1000),
	add constraint scenes_transition_length check (char_length(transition) <= 300);

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
  v_episode_id uuid;
  v_episode_status text;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_prompt_status is null or p_prompt_status not in ('TODO', 'READY', 'GENERATED', 'APPROVED') then
    raise exception 'invalid_prompt_status' using errcode = '22023';
  end if;
  if p_generation_attempts is null or p_generation_attempts < 0 or p_generation_attempts > 10 then
    raise exception 'invalid_generation_attempts' using errcode = '22023';
  end if;

  select s.episode_id, e.status into v_episode_id, v_episode_status
  from public.scenes s
  join public.episodes e on e.owner_id = s.owner_id and e.id = s.episode_id
  where s.owner_id = v_owner_id and s.id = p_scene_id;
  if not found then raise exception 'scene_not_found' using errcode = 'P0002'; end if;
  if v_episode_status = 'PUBLISHED' then raise exception 'published_episode_immutable' using errcode = '23514'; end if;

  if p_prompt_status = 'APPROVED' and exists (
    select 1 from public.scenes s
    where s.owner_id = v_owner_id and s.id = p_scene_id
      and (
        btrim(coalesce(s.start_frame_prompt_en, '')) = ''
        or btrim(coalesce(s.end_frame_prompt_en, '')) = ''
        or btrim(coalesce(s.motion_prompt_en, '')) = ''
      )
  ) then
    raise exception 'approved_scene_requires_prompts' using errcode = '23514';
  end if;

  update public.scenes
  set location = btrim(p_location),
      character_notes = btrim(p_character_notes),
      vhs_effects = btrim(p_vhs_effects),
      transition = btrim(p_transition),
      prompt_status = p_prompt_status,
      generation_attempts = p_generation_attempts,
      updated_at = now()
  where owner_id = v_owner_id and id = p_scene_id;

  perform public.append_episode_revision(v_episode_id, 'Direção de produção da cena atualizada');
end;
$$;

create or replace function public.swap_scene_order(p_scene_id uuid, p_direction text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_owner_id uuid := auth.uid();
  v_episode_id uuid;
  v_scene_index smallint;
  v_duration_ms integer;
  v_scene_duration_ms integer;
  v_status text;
  v_target_index smallint;
  v_target_scene_id uuid;
  v_scene record;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_direction is null or p_direction not in ('up', 'down') then
    raise exception 'invalid_scene_direction' using errcode = '22023';
  end if;

  select s.episode_id, s.scene_index, e.duration_ms, e.scene_duration_ms, e.status
    into v_episode_id, v_scene_index, v_duration_ms, v_scene_duration_ms, v_status
  from public.scenes s
  join public.episodes e on e.owner_id = s.owner_id and e.id = s.episode_id
  where s.owner_id = v_owner_id and s.id = p_scene_id;
  if not found then raise exception 'scene_not_found' using errcode = 'P0002'; end if;
  if v_status = 'PUBLISHED' then raise exception 'published_episode_immutable' using errcode = '23514'; end if;

  v_target_index := v_scene_index + case when p_direction = 'up' then -1 else 1 end;
  if v_target_index < 1 then return; end if;

  select s.id into v_target_scene_id
  from public.scenes s
  where s.owner_id = v_owner_id and s.episode_id = v_episode_id and s.scene_index = v_target_index;
  if not found then return; end if;

  set constraints scenes_owner_id_episode_id_scene_index_key deferred;

  update public.scenes
  set scene_index = v_target_index, updated_at = now()
  where owner_id = v_owner_id and id = p_scene_id;

  update public.scenes
  set scene_index = v_scene_index, updated_at = now()
  where owner_id = v_owner_id and id = v_target_scene_id;

  for v_scene in
    select id, scene_index
    from public.scenes
    where owner_id = v_owner_id and episode_id = v_episode_id
    order by scene_index
  loop
    update public.scenes
    set start_ms = (v_scene.scene_index - 1) * v_scene_duration_ms,
        end_ms = least(v_scene.scene_index * v_scene_duration_ms, v_duration_ms),
        updated_at = now()
    where owner_id = v_owner_id and id = v_scene.id;
  end loop;

  perform public.append_episode_revision(v_episode_id, 'Ordem das cenas atualizada');
end;
$$;

create or replace function public.require_continuity_review()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.continuity_review is null
    or jsonb_typeof(new.continuity_review) <> 'object'
    or not (new.continuity_review ? 'reviewedAt')
    or not (new.continuity_review ? 'reviewedBy')
    or not (new.continuity_review ? 'warnings') then
    raise exception 'continuity_review_required' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists require_continuity_review_before_insert on public.canonical_decisions;
create trigger require_continuity_review_before_insert
before insert on public.canonical_decisions
for each row execute function public.require_continuity_review();
