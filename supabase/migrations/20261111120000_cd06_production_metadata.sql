-- CD06 production metadata: configurable scene duration, richer scene direction,
-- prompt production status, continuity review, and reorder support.
alter table public.episodes
	add column if not exists scene_duration_ms integer not null default 8000;

alter table public.episodes
	drop constraint if exists episodes_scene_duration_ms_check;

alter table public.episodes
	add constraint episodes_scene_duration_ms_check
	check (scene_duration_ms in (4000, 6000, 8000));

alter table public.scenes
	add column if not exists location text not null default '',
	add column if not exists character_notes text not null default '',
	add column if not exists vhs_effects text not null default '',
	add column if not exists transition text not null default '',
	add column if not exists prompt_status text not null default 'TODO',
	add column if not exists generation_attempts smallint not null default 0;

alter table public.scenes
	drop constraint if exists scenes_prompt_status_check;

alter table public.scenes
	add constraint scenes_prompt_status_check
	check (prompt_status in ('TODO', 'READY', 'GENERATED', 'APPROVED'));

alter table public.scenes
	drop constraint if exists scenes_generation_attempts_check;

alter table public.scenes
	add constraint scenes_generation_attempts_check
	check (generation_attempts between 0 and 10);

alter table public.canonical_decisions
	add column if not exists continuity_review jsonb not null default '{}'::jsonb;

alter table public.canonical_decisions
	drop constraint if exists canonical_decisions_continuity_review_check;

alter table public.canonical_decisions
	add constraint canonical_decisions_continuity_review_check
	check (jsonb_typeof(continuity_review) = 'object');

-- Reordering needs to swap two scene indexes inside one transaction. The
-- original unique constraint is not deferrable, so make it deferrable before
-- the RPC swaps the adjacent positions.
alter table public.scenes
	drop constraint if exists scenes_owner_id_episode_id_scene_index_key;

alter table public.scenes
	add constraint scenes_owner_id_episode_id_scene_index_key
	unique (owner_id, episode_id, scene_index) deferrable initially immediate;

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
  if p_direction not in ('up', 'down') then
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

  select s.id
    into v_target_scene_id
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
end;
$$;

revoke all on function public.swap_scene_order(uuid, text) from public, anon;
grant execute on function public.swap_scene_order(uuid, text) to authenticated;

comment on function public.swap_scene_order(uuid, text)
is 'CD06: swaps a scene with its adjacent scene and recalculates the fixed-duration timeline.';
