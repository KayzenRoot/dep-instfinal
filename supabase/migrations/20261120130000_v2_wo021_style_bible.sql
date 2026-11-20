-- V2 WO-021: versioned audiovisual style bibles for series/seasons plus
-- owner-scoped episode and scene overrides. Configs are allowlisted enums and
-- IDs; no font files, shell commands, URLs or arbitrary filter strings.

create table public.style_presets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  scope_type text not null check (scope_type in ('SERIES', 'SEASON')),
  scope_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, scope_type, scope_id)
);

create table public.style_preset_revisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  preset_id uuid not null,
  revision_number integer not null check (revision_number between 1 and 10000),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  config_hash text not null check (config_hash ~ '^[0-9a-f]{64}$'),
  hash_version integer not null default 1 check (hash_version = 1),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED')),
  created_at timestamptz not null default now(),
  unique (owner_id, preset_id, revision_number),
  unique (owner_id, id),
  foreign key (owner_id, preset_id) references public.style_presets (owner_id, id) on delete restrict
);

create table public.episode_style_overrides (
  episode_id uuid primary key,
  owner_id uuid not null,
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, episode_id),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict
);

create table public.scene_style_overrides (
  scene_id uuid primary key,
  owner_id uuid not null,
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, scene_id),
  foreign key (owner_id, scene_id) references public.scenes (owner_id, id) on delete restrict
);

create index style_preset_revisions_by_preset
  on public.style_preset_revisions (owner_id, preset_id, revision_number desc);

alter table public.style_presets enable row level security;
alter table public.style_presets force row level security;
alter table public.style_preset_revisions enable row level security;
alter table public.style_preset_revisions force row level security;
alter table public.episode_style_overrides enable row level security;
alter table public.episode_style_overrides force row level security;
alter table public.scene_style_overrides enable row level security;
alter table public.scene_style_overrides force row level security;

revoke all on table public.style_presets from public, anon, authenticated;
revoke all on table public.style_preset_revisions from public, anon, authenticated;
revoke all on table public.episode_style_overrides from public, anon, authenticated;
revoke all on table public.scene_style_overrides from public, anon, authenticated;

grant select on table public.style_presets to authenticated;
grant select on table public.style_preset_revisions to authenticated;
grant select on table public.episode_style_overrides to authenticated;
grant select on table public.scene_style_overrides to authenticated;
grant select, insert, update, delete on table public.style_presets to service_role;
grant select, insert, update, delete on table public.style_preset_revisions to service_role;
grant select, insert, update, delete on table public.episode_style_overrides to service_role;
grant select, insert, update, delete on table public.scene_style_overrides to service_role;

create policy owner_select on public.style_presets for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true');
create policy owner_select on public.style_preset_revisions for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true');
create policy owner_select on public.episode_style_overrides for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true');
create policy owner_select on public.scene_style_overrides for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true');

create or replace function public.reject_style_revision_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  if current_setting('dif.style_prune', true) = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'style_revision_is_immutable' using errcode = '55000';
end;
$$;

create trigger style_preset_revisions_immutable
  before update or delete on public.style_preset_revisions
  for each row execute function public.reject_style_revision_mutation();

create or replace function public.save_style_preset_revision(
  p_owner_id uuid,
  p_scope_type text,
  p_scope_id uuid,
  p_name text,
  p_expected_revision integer,
  p_config jsonb,
  p_config_hash text,
  p_status text default 'DRAFT'
)
returns integer
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_preset public.style_presets;
  v_latest integer;
  v_revision integer;
begin
  if p_owner_id is null or p_scope_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_scope_type not in ('SERIES', 'SEASON') then
    raise exception 'style_scope_invalid' using errcode = '23514';
  end if;
  if char_length(btrim(coalesce(p_name, ''))) not between 1 and 80
    or p_config_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_config) is distinct from 'object'
    or p_status not in ('DRAFT', 'APPROVED')
    or p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'style_revision_invalid' using errcode = '23514';
  end if;
  if p_scope_type = 'SERIES' then
    if not exists (select 1 from public.series s where s.owner_id = p_owner_id and s.id = p_scope_id) then
      raise exception 'style_scope_not_found' using errcode = 'P0002';
    end if;
  else
    if not exists (select 1 from public.seasons s where s.owner_id = p_owner_id and s.id = p_scope_id) then
      raise exception 'style_scope_not_found' using errcode = 'P0002';
    end if;
  end if;
  select * into v_preset from public.style_presets p
  where p.owner_id = p_owner_id and p.scope_type = p_scope_type and p.scope_id = p_scope_id;
  if not found then
    insert into public.style_presets (owner_id, scope_type, scope_id, name)
    values (p_owner_id, p_scope_type, p_scope_id, btrim(p_name))
    returning * into v_preset;
  else
    update public.style_presets
      set name = btrim(p_name), updated_at = now()
      where id = v_preset.id and owner_id = p_owner_id
      returning * into v_preset;
  end if;
  select coalesce(max(r.revision_number), 0) into v_latest
  from public.style_preset_revisions r
  where r.owner_id = p_owner_id and r.preset_id = v_preset.id;
  if v_latest <> p_expected_revision then
    raise exception 'style_revision_conflict' using errcode = '40001';
  end if;
  v_revision := v_latest + 1;
  insert into public.style_preset_revisions (
    owner_id, preset_id, revision_number, config, config_hash, hash_version, status
  ) values (
    p_owner_id, v_preset.id, v_revision, p_config, p_config_hash, 1, p_status
  );
  return v_revision;
end;
$$;

create or replace function public.save_episode_style_override(
  p_owner_id uuid,
  p_episode_id uuid,
  p_config jsonb
)
returns void
language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if p_owner_id is null or p_episode_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_config) is distinct from 'object' then
    raise exception 'style_override_invalid' using errcode = '23514';
  end if;
  if not exists (select 1 from public.episodes e where e.owner_id = p_owner_id and e.id = p_episode_id) then
    raise exception 'episode_not_found' using errcode = 'P0002';
  end if;
  insert into public.episode_style_overrides (episode_id, owner_id, config)
  values (p_episode_id, p_owner_id, p_config)
  on conflict (episode_id) do update
    set config = excluded.config, owner_id = excluded.owner_id, updated_at = now();
end;
$$;

create or replace function public.save_scene_style_override(
  p_owner_id uuid,
  p_scene_id uuid,
  p_config jsonb
)
returns void
language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if p_owner_id is null or p_scene_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_config) is distinct from 'object' then
    raise exception 'style_override_invalid' using errcode = '23514';
  end if;
  if not exists (select 1 from public.scenes s where s.owner_id = p_owner_id and s.id = p_scene_id) then
    raise exception 'style_scene_not_found' using errcode = 'P0002';
  end if;
  insert into public.scene_style_overrides (scene_id, owner_id, config)
  values (p_scene_id, p_owner_id, p_config)
  on conflict (scene_id) do update
    set config = excluded.config, owner_id = excluded.owner_id, updated_at = now();
end;
$$;

revoke all on function public.save_style_preset_revision(uuid, text, uuid, text, integer, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.save_episode_style_override(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.save_scene_style_override(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.reject_style_revision_mutation() from public, anon, authenticated;

grant execute on function public.save_style_preset_revision(uuid, text, uuid, text, integer, jsonb, text, text) to service_role;
grant execute on function public.save_episode_style_override(uuid, uuid, jsonb) to service_role;
grant execute on function public.save_scene_style_override(uuid, uuid, jsonb) to service_role;

comment on table public.style_preset_revisions is
  'Owner-readable, immutable style preset revisions with allowlisted style configs.';
comment on function public.save_style_preset_revision(uuid, text, uuid, text, integer, jsonb, text, text) is
  'Server-only style revision append with optimistic concurrency and owner-scoped series/season.';
