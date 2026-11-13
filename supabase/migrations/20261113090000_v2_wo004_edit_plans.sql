-- V2 WO-004: versioned, deterministic video edit plans.
-- The plan is metadata only: clips reference READY video_assets, never bytes.
-- Owners read their plans; all writes go through owner-checked SECURITY DEFINER RPCs.

create table public.video_edit_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  episode_id uuid not null,
  current_version integer not null check (current_version between 1 and 10000),
  current_status text not null default 'DRAFT' check (current_status in ('DRAFT', 'APPROVED', 'RENDERED')),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  episode_revision_number integer check (episode_revision_number is null or episode_revision_number > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, episode_id),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict
);

create table public.video_edit_plan_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  plan_id uuid not null,
  episode_id uuid not null,
  version integer not null check (version between 1 and 10000),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  manifest_hash text not null check (manifest_hash ~ '^[0-9a-f]{64}$'),
  change_note text not null default '' check (char_length(change_note) <= 500),
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, plan_id, version),
  foreign key (owner_id, plan_id) references public.video_edit_plans (owner_id, id) on delete restrict,
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict
);

create index video_edit_plan_versions_by_plan
  on public.video_edit_plan_versions (owner_id, plan_id, version desc);

alter table public.video_edit_plans enable row level security;
alter table public.video_edit_plans force row level security;
alter table public.video_edit_plan_versions enable row level security;
alter table public.video_edit_plan_versions force row level security;

revoke all on table public.video_edit_plans from public, anon, authenticated;
revoke all on table public.video_edit_plan_versions from public, anon, authenticated;
grant select on table public.video_edit_plans to authenticated;
grant select on table public.video_edit_plan_versions to authenticated;

create policy owner_select on public.video_edit_plans
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );
create policy owner_select on public.video_edit_plan_versions
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );

create trigger set_video_edit_plans_updated_at
  before update on public.video_edit_plans
  for each row execute function public.set_updated_at();

create or replace function public.reject_video_edit_plan_version_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'video_edit_plan_versions_are_immutable' using errcode = '55000';
end;
$$;

create trigger reject_video_edit_plan_version_mutation
  before update or delete on public.video_edit_plan_versions
  for each row execute function public.reject_video_edit_plan_version_mutation();

create or replace function public.save_video_edit_plan(
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
  v_owner_id uuid := auth.uid();
  v_episode public.episodes;
  v_plan public.video_edit_plans;
  v_version integer;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
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
  where e.owner_id = v_owner_id and e.id = p_episode_id
  for update;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;
  if v_episode.status = 'PUBLISHED' then
    raise exception 'published_episode_is_immutable' using errcode = '55000';
  end if;

  select p.* into v_plan from public.video_edit_plans p
  where p.owner_id = v_owner_id and p.episode_id = p_episode_id
  for update;
  if not found then
    if p_expected_version <> 0 then
      raise exception 'edit_plan_version_conflict' using errcode = '40001';
    end if;
    insert into public.video_edit_plans (
      owner_id, episode_id, current_version, current_status, plan, manifest_hash
    ) values (
      v_owner_id, p_episode_id, 1, 'DRAFT', p_plan, p_manifest_hash
    ) returning * into v_plan;
    v_version := 1;
  else
    if v_plan.current_version <> p_expected_version then
      raise exception 'edit_plan_version_conflict' using errcode = '40001';
    end if;
    v_version := v_plan.current_version + 1;
    update public.video_edit_plans p
    set current_version = v_version,
        current_status = 'DRAFT',
        plan = p_plan,
        manifest_hash = p_manifest_hash
    where p.owner_id = v_owner_id and p.id = v_plan.id
    returning * into v_plan;
  end if;

  insert into public.video_edit_plan_versions (
    owner_id, plan_id, episode_id, version, plan, manifest_hash, change_note
  ) values (
    v_owner_id, v_plan.id, p_episode_id, v_version, p_plan, p_manifest_hash,
    left(coalesce(p_change_note, ''), 500)
  );
  return v_version;
end;
$$;

create or replace function public.restore_video_edit_plan(
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
  v_owner_id uuid := auth.uid();
  v_episode public.episodes;
  v_plan public.video_edit_plans;
  v_source public.video_edit_plan_versions;
  v_next integer;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  select e.* into v_episode from public.episodes e
  where e.owner_id = v_owner_id and e.id = p_episode_id
  for update;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;
  if v_episode.status = 'PUBLISHED' then
    raise exception 'published_episode_is_immutable' using errcode = '55000';
  end if;
  select p.* into v_plan from public.video_edit_plans p
  where p.owner_id = v_owner_id and p.episode_id = p_episode_id
  for update;
  if not found then raise exception 'edit_plan_not_found' using errcode = 'P0002'; end if;
  if v_plan.current_version <> p_expected_version then
    raise exception 'edit_plan_version_conflict' using errcode = '40001';
  end if;
  select v.* into v_source from public.video_edit_plan_versions v
  where v.owner_id = v_owner_id and v.plan_id = v_plan.id and v.version = p_version;
  if not found then raise exception 'edit_plan_version_not_found' using errcode = 'P0002'; end if;

  v_next := v_plan.current_version + 1;
  update public.video_edit_plans p
  set current_version = v_next,
      current_status = 'DRAFT',
      plan = v_source.plan,
      manifest_hash = v_source.manifest_hash
  where p.owner_id = v_owner_id and p.id = v_plan.id;
  insert into public.video_edit_plan_versions (
    owner_id, plan_id, episode_id, version, plan, manifest_hash, change_note
  ) values (
    v_owner_id, v_plan.id, p_episode_id, v_next, v_source.plan, v_source.manifest_hash,
    left(coalesce(nullif(p_change_note, ''), 'Restauração da versão ' || p_version::text), 500)
  );
  return v_next;
end;
$$;

create or replace function public.set_video_edit_plan_status(
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
  v_owner_id uuid := auth.uid();
  v_episode public.episodes;
  v_plan public.video_edit_plans;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_status not in ('DRAFT', 'APPROVED') then
    raise exception 'edit_plan_status_invalid' using errcode = '23514';
  end if;
  select e.* into v_episode from public.episodes e
  where e.owner_id = v_owner_id and e.id = p_episode_id
  for update;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;
  if v_episode.status = 'PUBLISHED' then
    raise exception 'published_episode_is_immutable' using errcode = '55000';
  end if;
  select p.* into v_plan from public.video_edit_plans p
  where p.owner_id = v_owner_id and p.episode_id = p_episode_id
  for update;
  if not found then raise exception 'edit_plan_not_found' using errcode = 'P0002'; end if;
  if v_plan.current_version <> p_expected_version then
    raise exception 'edit_plan_version_conflict' using errcode = '40001';
  end if;
  update public.video_edit_plans p
  set current_status = p_status
  where p.owner_id = v_owner_id and p.id = v_plan.id;
end;
$$;

revoke all on function public.save_video_edit_plan(uuid, integer, jsonb, text, text) from public, anon;
revoke all on function public.restore_video_edit_plan(uuid, integer, integer, text) from public, anon;
revoke all on function public.set_video_edit_plan_status(uuid, integer, text) from public, anon;
grant execute on function public.save_video_edit_plan(uuid, integer, jsonb, text, text) to authenticated;
grant execute on function public.restore_video_edit_plan(uuid, integer, integer, text) to authenticated;
grant execute on function public.set_video_edit_plan_status(uuid, integer, text) to authenticated;

comment on table public.video_edit_plans is
  'Current owner-scoped deterministic edit plan; metadata only, never video bytes or signed URLs.';
comment on table public.video_edit_plan_versions is
  'Immutable edit-plan snapshots. Restoring a version appends a new snapshot instead of rewriting history.';
comment on function public.save_video_edit_plan(uuid, integer, jsonb, text, text) is
  'Creates or saves an edit plan with optimistic concurrency; owner and episode publication are checked.';
