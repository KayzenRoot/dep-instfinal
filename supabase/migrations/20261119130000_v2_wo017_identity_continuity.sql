-- V2 WO-017: versioned character identity profiles and immutable visual continuity reports.
-- Profiles extend existing characters; they never replace or mutate the canonical character row.
-- Reports capture post-Flow observations and owner decisions without editing scenes or canon.

alter table public.characters
  add constraint characters_owner_series_id_key unique (owner_id, series_id, id);

create table public.character_identity_profiles (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  series_id uuid not null,
  character_id uuid not null,
  current_version integer not null default 1 check (current_version between 1 and 10000),
  profile jsonb not null check (jsonb_typeof(profile) = 'object'),
  profile_hash text not null check (profile_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, character_id),
  unique (owner_id, id),
  foreign key (owner_id, series_id) references public.series (owner_id, id) on delete restrict,
  foreign key (owner_id, series_id, character_id)
    references public.characters (owner_id, series_id, id) on delete restrict
);

create table public.character_identity_profile_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  profile_id uuid not null,
  version integer not null check (version between 1 and 10000),
  profile jsonb not null check (jsonb_typeof(profile) = 'object'),
  profile_hash text not null check (profile_hash ~ '^[0-9a-f]{64}$'),
  change_note text not null default '' check (char_length(change_note) <= 500),
  created_at timestamptz not null default now(),
  unique (profile_id, version),
  unique (owner_id, id),
  foreign key (owner_id, profile_id)
    references public.character_identity_profiles (owner_id, id) on delete restrict
);

create index character_identity_profile_versions_by_profile
  on public.character_identity_profile_versions (owner_id, profile_id, version desc);

create table public.visual_continuity_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  episode_id uuid not null,
  revision_number integer not null check (revision_number between 1 and 10000),
  status text not null check (status in ('NEEDS_REVIEW', 'ACCEPTED', 'BLOCKING')),
  blocking_count integer not null default 0 check (blocking_count >= 0),
  observation_count integer not null default 0 check (observation_count >= 0),
  report jsonb not null check (jsonb_typeof(report) = 'object'),
  report_hash text not null check (report_hash ~ '^[0-9a-f]{64}$'),
  supersedes_report_id uuid,
  created_at timestamptz not null default now(),
  unique (owner_id, episode_id, revision_number),
  unique (owner_id, id),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict,
  foreign key (owner_id, supersedes_report_id)
    references public.visual_continuity_reports (owner_id, id) on delete restrict,
  check (supersedes_report_id is null or supersedes_report_id <> id)
);

create index visual_continuity_reports_by_episode
  on public.visual_continuity_reports (owner_id, episode_id, revision_number desc);

alter table public.character_identity_profiles enable row level security;
alter table public.character_identity_profiles force row level security;
alter table public.character_identity_profile_versions enable row level security;
alter table public.character_identity_profile_versions force row level security;
alter table public.visual_continuity_reports enable row level security;
alter table public.visual_continuity_reports force row level security;

revoke all on table public.character_identity_profiles from public, anon, authenticated;
revoke all on table public.character_identity_profile_versions from public, anon, authenticated;
revoke all on table public.visual_continuity_reports from public, anon, authenticated;
grant select on table public.character_identity_profiles to authenticated;
grant select on table public.character_identity_profile_versions to authenticated;
grant select on table public.visual_continuity_reports to authenticated;
grant select, insert, update, delete on table public.character_identity_profiles to service_role;
grant select, insert, update, delete on table public.character_identity_profile_versions to service_role;
grant select, insert, update, delete on table public.visual_continuity_reports to service_role;

create policy owner_select on public.character_identity_profiles
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );

create policy owner_select on public.character_identity_profile_versions
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );

create policy owner_select on public.visual_continuity_reports
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );

create or replace function public.reject_character_identity_history_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  raise exception 'character_identity_history_is_immutable' using errcode = '55000';
end;
$$;

create trigger character_identity_profile_versions_immutable
  before update or delete on public.character_identity_profile_versions
  for each row execute function public.reject_character_identity_history_mutation();

create trigger visual_continuity_reports_immutable
  before update or delete on public.visual_continuity_reports
  for each row execute function public.reject_character_identity_history_mutation();

create or replace function public.save_character_identity_profile(
  p_owner_id uuid,
  p_character_id uuid,
  p_expected_version integer,
  p_profile jsonb,
  p_profile_hash text,
  p_change_note text default ''
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_character public.characters;
  v_profile public.character_identity_profiles;
  v_version integer;
begin
  if p_owner_id is null or p_character_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'identity_expected_version_invalid' using errcode = '23514';
  end if;
  if p_profile_hash is null or p_profile_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'identity_profile_hash_invalid' using errcode = '23514';
  end if;
  if jsonb_typeof(p_profile) is distinct from 'object'
    or p_profile ->> 'schemaVersion' is distinct from '1'
    or p_profile ->> 'characterId' is distinct from p_character_id::text
    or p_profile ->> 'status' not in ('DRAFT', 'APPROVED')
    or jsonb_typeof(p_profile -> 'aliases') is distinct from 'array'
    or jsonb_typeof(p_profile -> 'visualTraits') is distinct from 'object'
    or jsonb_typeof(p_profile -> 'references') is distinct from 'array'
    or jsonb_typeof(p_profile -> 'looks') is distinct from 'array' then
    raise exception 'identity_profile_shape_invalid' using errcode = '23514';
  end if;

  select c.* into v_character from public.characters c
  where c.owner_id = p_owner_id and c.id = p_character_id
  for update;
  if not found then raise exception 'character_not_found' using errcode = 'P0002'; end if;
  if p_profile ->> 'seriesId' is distinct from v_character.series_id::text then
    raise exception 'identity_series_mismatch' using errcode = '23514';
  end if;

  select p.* into v_profile from public.character_identity_profiles p
  where p.owner_id = p_owner_id and p.character_id = p_character_id
  for update;
  if not found then
    if p_expected_version <> 0 then
      raise exception 'identity_version_conflict' using errcode = '40001';
    end if;
    insert into public.character_identity_profiles (
      owner_id, series_id, character_id, current_version, profile, profile_hash
    ) values (
      p_owner_id, v_character.series_id, p_character_id, 1, p_profile, p_profile_hash
    ) returning * into v_profile;
    v_version := 1;
  else
    if v_profile.current_version <> p_expected_version then
      raise exception 'identity_version_conflict' using errcode = '40001';
    end if;
    v_version := v_profile.current_version + 1;
    update public.character_identity_profiles p
    set current_version = v_version,
        profile = p_profile,
        profile_hash = p_profile_hash,
        updated_at = now()
    where p.owner_id = p_owner_id and p.id = v_profile.id
    returning * into v_profile;
  end if;

  insert into public.character_identity_profile_versions (
    owner_id, profile_id, version, profile, profile_hash, change_note
  ) values (
    p_owner_id, v_profile.id, v_version, p_profile, p_profile_hash,
    left(coalesce(p_change_note, ''), 500)
  );
  return v_version;
end;
$$;

create or replace function public.save_visual_continuity_report(
  p_owner_id uuid,
  p_episode_id uuid,
  p_expected_revision integer,
  p_report jsonb,
  p_report_hash text,
  p_supersedes_report_id uuid default null
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
  v_status text;
  v_blocking integer;
  v_total integer;
begin
  if p_owner_id is null or p_episode_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'continuity_expected_revision_invalid' using errcode = '23514';
  end if;
  if p_report_hash is null or p_report_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'continuity_report_hash_invalid' using errcode = '23514';
  end if;
  if jsonb_typeof(p_report) is distinct from 'object'
    or p_report ->> 'schemaVersion' is distinct from '1'
    or p_report ->> 'episodeId' is distinct from p_episode_id::text
    or p_report ->> 'status' not in ('NEEDS_REVIEW', 'ACCEPTED', 'BLOCKING')
    or jsonb_typeof(p_report -> 'observations') is distinct from 'array'
    or jsonb_typeof(p_report -> 'frames') is distinct from 'array'
    or jsonb_typeof(p_report -> 'summary') is distinct from 'object' then
    raise exception 'continuity_report_shape_invalid' using errcode = '23514';
  end if;

  select e.* into v_episode from public.episodes e
  where e.owner_id = p_owner_id and e.id = p_episode_id
  for update;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;

  if p_supersedes_report_id is not null and not exists (
    select 1 from public.visual_continuity_reports r
    where r.owner_id = p_owner_id and r.episode_id = p_episode_id
      and r.id = p_supersedes_report_id
  ) then
    raise exception 'continuity_supersedes_not_found' using errcode = 'P0002';
  end if;

  select coalesce(max(r.revision_number), 0) into v_latest
  from public.visual_continuity_reports r
  where r.owner_id = p_owner_id and r.episode_id = p_episode_id;
  if v_latest <> p_expected_revision then
    raise exception 'continuity_revision_conflict' using errcode = '40001';
  end if;
  v_revision := v_latest + 1;

  v_status := p_report ->> 'status';
  v_blocking := coalesce((p_report -> 'summary' ->> 'blocking')::integer, 0);
  v_total := coalesce(jsonb_array_length(p_report -> 'observations'), 0);
  if v_blocking < 0 or v_blocking > v_total then
    raise exception 'continuity_report_counts_invalid' using errcode = '23514';
  end if;
  if v_status = 'BLOCKING' and v_blocking = 0 then
    raise exception 'continuity_report_status_invalid' using errcode = '23514';
  end if;
  if v_status in ('NEEDS_REVIEW', 'ACCEPTED') and v_blocking > 0 then
    raise exception 'continuity_report_status_invalid' using errcode = '23514';
  end if;

  insert into public.visual_continuity_reports (
    owner_id, episode_id, revision_number, status, blocking_count,
    observation_count, report, report_hash, supersedes_report_id
  ) values (
    p_owner_id, p_episode_id, v_revision, v_status, v_blocking,
    v_total, p_report, p_report_hash, p_supersedes_report_id
  );
  return v_revision;
end;
$$;

revoke all on function public.save_character_identity_profile(uuid, uuid, integer, jsonb, text, text)
  from public, anon, authenticated;
revoke all on function public.save_visual_continuity_report(uuid, uuid, integer, jsonb, text, uuid)
  from public, anon, authenticated;
grant execute on function public.save_character_identity_profile(uuid, uuid, integer, jsonb, text, text)
  to service_role;
grant execute on function public.save_visual_continuity_report(uuid, uuid, integer, jsonb, text, uuid)
  to service_role;

revoke all on function public.reject_character_identity_history_mutation()
  from public, anon, authenticated;

comment on table public.character_identity_profiles is
  'Owner-readable current Character Identity Kit profile; writes are service-only and versioned.';
comment on table public.character_identity_profile_versions is
  'Immutable identity profile history; restoring creates a new version instead of rewriting.';
comment on table public.visual_continuity_reports is
  'Immutable post-Flow continuity observations and owner decisions; never edits scenes or canon.';
comment on function public.save_character_identity_profile(uuid, uuid, integer, jsonb, text, text) is
  'Server-only profile write with optimistic concurrency; the server validates Zod and the hash.';
comment on function public.save_visual_continuity_report(uuid, uuid, integer, jsonb, text, uuid) is
  'Server-only append of a continuity report revision; decisions are embedded in the report.';
