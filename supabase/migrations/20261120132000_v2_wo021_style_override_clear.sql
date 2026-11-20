-- V2 WO-021 follow-up: explicit removal of episode/scene style overrides.
create or replace function public.clear_episode_style_override(
  p_owner_id uuid,
  p_episode_id uuid
)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if p_owner_id is null or p_episode_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.episodes e where e.owner_id = p_owner_id and e.id = p_episode_id) then
    raise exception 'episode_not_found' using errcode = 'P0002';
  end if;
  delete from public.episode_style_overrides
  where owner_id = p_owner_id and episode_id = p_episode_id;
  return found;
end;
$$;

create or replace function public.clear_scene_style_override(
  p_owner_id uuid,
  p_scene_id uuid
)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if p_owner_id is null or p_scene_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if not exists (select 1 from public.scenes s where s.owner_id = p_owner_id and s.id = p_scene_id) then
    raise exception 'style_scene_not_found' using errcode = 'P0002';
  end if;
  delete from public.scene_style_overrides
  where owner_id = p_owner_id and scene_id = p_scene_id;
  return found;
end;
$$;

revoke all on function public.clear_episode_style_override(uuid, uuid) from public, anon, authenticated;
revoke all on function public.clear_scene_style_override(uuid, uuid) from public, anon, authenticated;
grant execute on function public.clear_episode_style_override(uuid, uuid) to service_role;
grant execute on function public.clear_scene_style_override(uuid, uuid) to service_role;

comment on function public.clear_episode_style_override(uuid, uuid) is
  'Server-only removal of an episode style override; the episode returns to inheritance.';
comment on function public.clear_scene_style_override(uuid, uuid) is
  'Server-only removal of a scene style override; the scene returns to inheritance.';
