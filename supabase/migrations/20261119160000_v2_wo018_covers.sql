-- V2 WO-018: versioned cover configurations. Covers are re-rendered on demand
-- from private owner frames; no generated image bytes or permanent URLs are stored.

create table public.cover_revisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  episode_id uuid not null,
  revision_number integer not null check (revision_number between 1 and 10000),
  template_id text not null check (template_id in ('noir', 'vhs_polaroid', 'archive', 'cctv')),
  template_version integer not null default 1 check (template_version = 1),
  format text not null check (format in ('9:16', '3:4', '4:5')),
  frame_asset_id uuid,
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  config_hash text not null check (config_hash ~ '^[0-9a-f]{64}$'),
  hash_version integer not null default 1 check (hash_version = 1),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED')),
  created_at timestamptz not null default now(),
  unique (owner_id, episode_id, revision_number),
  unique (owner_id, id),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict,
  foreign key (owner_id, frame_asset_id) references public.media_assets (owner_id, id) on delete restrict
);

create index cover_revisions_by_episode
  on public.cover_revisions (owner_id, episode_id, revision_number desc);

alter table public.cover_revisions enable row level security;
alter table public.cover_revisions force row level security;

revoke all on table public.cover_revisions from public, anon, authenticated;
grant select on table public.cover_revisions to authenticated;
grant select, insert, update, delete on table public.cover_revisions to service_role;

create policy owner_select on public.cover_revisions
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );

create or replace function public.reject_cover_revision_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if current_setting('dif.cover_prune', true) = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'cover_revision_is_immutable' using errcode = '55000';
end;
$$;

create trigger cover_revision_immutable
  before update or delete on public.cover_revisions
  for each row execute function public.reject_cover_revision_mutation();

create or replace function public.enforce_cover_revision_quota()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if (select count(*) from public.cover_revisions
      where owner_id = new.owner_id and episode_id = new.episode_id) >= 500 then
    raise exception 'cover_revision_quota' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger cover_revision_quota
  before insert on public.cover_revisions
  for each row execute function public.enforce_cover_revision_quota();

create or replace function public.save_cover_revision(
  p_owner_id uuid,
  p_episode_id uuid,
  p_expected_revision integer,
  p_config jsonb,
  p_config_hash text,
  p_status text default 'DRAFT'
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_episode public.episodes;
  v_latest integer;
  v_revision integer;
  v_frame_asset_id uuid;
begin
  if p_owner_id is null or p_episode_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'cover_expected_revision_invalid' using errcode = '23514';
  end if;
  if p_config_hash is null or p_config_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'cover_config_hash_invalid' using errcode = '23514';
  end if;
  if p_status not in ('DRAFT', 'APPROVED') then
    raise exception 'cover_status_invalid' using errcode = '23514';
  end if;
  if jsonb_typeof(p_config) is distinct from 'object'
    or p_config ->> 'schemaVersion' is distinct from '1'
    or p_config ->> 'templateVersion' is distinct from '1'
    or p_config ->> 'templateId' not in ('noir', 'vhs_polaroid', 'archive', 'cctv')
    or p_config ->> 'format' not in ('9:16', '3:4', '4:5')
    or char_length(btrim(coalesce(p_config ->> 'title', ''))) not between 1 and 120 then
    raise exception 'cover_config_invalid' using errcode = '23514';
  end if;

  select e.* into v_episode from public.episodes e
  where e.owner_id = p_owner_id and e.id = p_episode_id
  for update;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;

  v_frame_asset_id := nullif(p_config ->> 'frameAssetId', '')::uuid;
  if v_frame_asset_id is not null and not exists (
    select 1 from public.media_assets m
    where m.owner_id = p_owner_id and m.id = v_frame_asset_id
      and m.upload_status = 'READY' and m.resource_type = 'image'
  ) then
    raise exception 'cover_frame_asset_invalid' using errcode = '23514';
  end if;

  select coalesce(max(r.revision_number), 0) into v_latest
  from public.cover_revisions r
  where r.owner_id = p_owner_id and r.episode_id = p_episode_id;
  if v_latest <> p_expected_revision then
    raise exception 'cover_revision_conflict' using errcode = '40001';
  end if;
  v_revision := v_latest + 1;

  insert into public.cover_revisions (
    owner_id, episode_id, revision_number, template_id, template_version,
    format, frame_asset_id, config, config_hash, hash_version, status
  ) values (
    p_owner_id, p_episode_id, v_revision, p_config ->> 'templateId', 1,
    p_config ->> 'format', v_frame_asset_id, p_config, p_config_hash, 1, p_status
  );
  return v_revision;
end;
$$;

revoke all on function public.save_cover_revision(uuid, uuid, integer, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.save_cover_revision(uuid, uuid, integer, jsonb, text, text)
  to service_role;


create or replace function public.prune_cover_revisions(
  p_owner_id uuid,
  p_episode_id uuid,
  p_keep integer default 50
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  if p_owner_id is null or p_episode_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_keep is null or p_keep < 1 or p_keep > 500 then
    raise exception 'cover_retention_invalid' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.episodes e
    where e.owner_id = p_owner_id and e.id = p_episode_id
  ) then
    raise exception 'episode_not_found' using errcode = 'P0002';
  end if;
  perform set_config('dif.cover_prune', 'on', true);
  with ranked as (
    select r.id,
      row_number() over (order by r.revision_number desc) as position
    from public.cover_revisions r
    where r.owner_id = p_owner_id and r.episode_id = p_episode_id
  )
  delete from public.cover_revisions r
  using ranked d
  where r.id = d.id
    and r.status <> 'APPROVED'
    and d.position > p_keep;
  get diagnostics v_deleted = row_count;
  perform set_config('dif.cover_prune', 'off', true);
  return v_deleted;
end;
$$;

revoke all on function public.prune_cover_revisions(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.prune_cover_revisions(uuid, uuid, integer)
  to service_role;

comment on function public.prune_cover_revisions(uuid, uuid, integer) is
  'Service-only owner-scoped retention for cover history; keeps the newest revisions.';

revoke all on function public.reject_cover_revision_mutation() from public, anon, authenticated;
revoke all on function public.enforce_cover_revision_quota() from public, anon, authenticated;

comment on table public.cover_revisions is
  'Owner-readable, immutable cover configurations; covers are rendered on demand from private frames.';
comment on function public.save_cover_revision(uuid, uuid, integer, jsonb, text, text) is
  'Server-only append of a cover revision with optimistic concurrency and frame ownership checks.';
