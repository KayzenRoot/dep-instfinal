-- DIF-004 initial schema. Apply only to a new/dedicated Supabase project.
-- No Storage bucket, service-role policy, public delivery, or destructive DDL is added.

create table public.series (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  premise text not null default '',
  subgenre text not null default '',
  tone text not null default '',
  audience text not null default '',
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id)
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  series_id uuid not null,
  season_number smallint not null check (season_number between 1 and 99),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  planned_episode_count smallint not null default 12 check (planned_episode_count between 10 and 15),
  summary text not null default '',
  bible jsonb not null default '{}'::jsonb check (jsonb_typeof(bible) = 'object'),
  chronology jsonb not null default '[]'::jsonb check (jsonb_typeof(chronology) = 'array'),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'ACTIVE', 'COMPLETE', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, series_id, id),
  unique (owner_id, series_id, season_number),
  foreign key (owner_id, series_id) references public.series (owner_id, id) on delete restrict
);

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  series_id uuid not null,
  season_id uuid,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  role text not null default '',
  description text not null default '',
  visual_description text not null default '',
  voice_notes text not null default '',
  arc_notes text not null default '',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'MISSING', 'DECEASED', 'UNKNOWN', 'ARCHIVED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, series_id) references public.series (owner_id, id) on delete restrict,
  foreign key (owner_id, series_id, season_id) references public.seasons (owner_id, series_id, id) on delete restrict
);

create table public.lore_facts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  series_id uuid not null,
  season_id uuid,
  category text not null check (category in ('RULE', 'CLUE', 'TIMELINE', 'OBJECT', 'PLACE', 'RELATIONSHIP', 'OTHER')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  fact text not null check (char_length(btrim(fact)) > 0),
  importance smallint not null default 3 check (importance between 1 and 5),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'SUPERSEDED', 'ARCHIVED')),
  applies_from_episode smallint check (applies_from_episode between 1 and 99),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, series_id) references public.series (owner_id, id) on delete restrict,
  foreign key (owner_id, series_id, season_id) references public.seasons (owner_id, series_id, id) on delete restrict
);

create table public.episodes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  season_id uuid not null,
  episode_number smallint not null check (episode_number between 1 and 99),
  title text not null check (char_length(btrim(title)) between 1 and 180),
  logline text not null default '',
  hook text not null default '',
  narrative text not null default '',
  reveal text not null default '',
  cliffhanger text not null default '',
  narration_pt_br text not null default '',
  duration_ms integer not null default 120000 check (duration_ms between 90000 and 150000),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'READY', 'PUBLISHED')),
  is_season_finale boolean not null default false,
  published_at timestamptz,
  platform_metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(platform_metadata) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, season_id, id),
  unique (owner_id, season_id, episode_number),
  check ((status = 'PUBLISHED') = (published_at is not null)),
  foreign key (owner_id, season_id) references public.seasons (owner_id, id) on delete restrict
);

create table public.episode_revisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  episode_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  change_note text not null default '',
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, episode_id, revision_number),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict
);

create table public.media_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  cloudinary_asset_id text,
  public_id text not null check (
    char_length(btrim(public_id)) between 1 and 255
    and public_id !~ '^/'
    and public_id !~ '(^|/)\.\.(/|$)'
  ),
  resource_type text not null default 'image' check (resource_type = 'image'),
  delivery_type text not null check (delivery_type in ('authenticated', 'private')),
  asset_kind text not null check (asset_kind in ('FRAME', 'COVER', 'REFERENCE')),
  format text check (format in ('png', 'jpg', 'jpeg', 'webp')),
  byte_size integer check (byte_size between 1 and 10485760),
  width integer check (width between 1 and 4096),
  height integer check (height between 1 and 4096),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  asset_version bigint check (asset_version > 0),
  upload_status text not null default 'UPLOADING' check (upload_status in ('UPLOADING', 'READY', 'FAILED', 'ORPHANED', 'DELETED')),
  safe_error_code text,
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, public_id),
  unique (owner_id, cloudinary_asset_id),
  check (
    upload_status <> 'READY'
    or (
      cloudinary_asset_id is not null and format is not null and byte_size is not null
      and width is not null and height is not null and sha256 is not null
      and asset_version is not null and uploaded_at is not null
    )
  )
);

create table public.scenes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  episode_id uuid not null,
  scene_index smallint not null check (scene_index between 1 and 60),
  start_ms integer not null check (start_ms between 0 and 150000),
  end_ms integer not null check (end_ms between 1 and 150000 and end_ms > start_ms),
  narration_pt_br text not null default '',
  visual_description text not null default '',
  camera_notes text not null default '',
  lighting_notes text not null default '',
  start_frame_prompt_en text not null default '',
  end_frame_prompt_en text not null default '',
  motion_prompt_en text not null default '',
  audio_notes text not null default '',
  start_frame_asset_id uuid,
  end_frame_asset_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, episode_id, id),
  unique (owner_id, episode_id, scene_index),
  check (start_frame_asset_id is null or end_frame_asset_id is null or start_frame_asset_id <> end_frame_asset_id),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict,
  foreign key (owner_id, start_frame_asset_id) references public.media_assets (owner_id, id) on delete restrict,
  foreign key (owner_id, end_frame_asset_id) references public.media_assets (owner_id, id) on delete restrict
);

create table public.choices (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  episode_id uuid not null,
  option_key char(1) not null check (option_key in ('1', '2')),
  label text not null check (char_length(btrim(label)) between 1 and 180),
  consequence text not null check (char_length(btrim(consequence)) between 1 and 4000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, episode_id, option_key),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict
);

create table public.polls (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  episode_id uuid not null,
  external_post_id text,
  status text not null default 'OPEN' check (status in ('OPEN', 'CLOSED', 'VERIFIED', 'CANCELLED')),
  opened_at timestamptz not null,
  closes_at timestamptz not null,
  closed_at timestamptz,
  tie_break_rule text not null check (char_length(btrim(tie_break_rule)) between 1 and 500),
  tie_break_option char(1) not null check (tie_break_option in ('1', '2')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, episode_id),
  check (closes_at > opened_at),
  check (
    (status = 'OPEN' and closed_at is null)
    or (status in ('CLOSED', 'VERIFIED') and closed_at is not null)
    or status = 'CANCELLED'
  ),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict
);

create table public.poll_results (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  poll_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  option_1_count bigint not null check (option_1_count >= 0),
  option_2_count bigint not null check (option_2_count >= 0),
  winner_option char(1) check (winner_option in ('1', '2')),
  verification_status text not null default 'PENDING' check (verification_status in ('PENDING', 'VERIFIED')),
  evidence_source text not null default '',
  captured_at timestamptz not null,
  verified_at timestamptz,
  verification_note text not null default '',
  supersedes_result_id uuid,
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, poll_id, id),
  unique (owner_id, poll_id, revision_number),
  check (
    (verification_status = 'PENDING' and verified_at is null and winner_option is null)
    or (verification_status = 'VERIFIED' and verified_at is not null and char_length(btrim(evidence_source)) > 0)
  ),
  check (
    verification_status <> 'VERIFIED'
    or (option_1_count = 0 and option_2_count = 0 and winner_option is null)
    or (option_1_count > option_2_count and winner_option = '1')
    or (option_2_count > option_1_count and winner_option = '2')
    or (option_1_count = option_2_count and option_1_count > 0 and winner_option in ('1', '2'))
  ),
  foreign key (owner_id, poll_id) references public.polls (owner_id, id) on delete restrict,
  foreign key (owner_id, poll_id, supersedes_result_id) references public.poll_results (owner_id, poll_id, id) on delete restrict
);

create table public.canonical_decisions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  poll_id uuid not null,
  episode_id uuid not null,
  poll_result_id uuid not null,
  next_episode_id uuid,
  revision_number integer not null check (revision_number > 0),
  supersedes_decision_id uuid,
  canon_snapshot jsonb not null check (jsonb_typeof(canon_snapshot) = 'object' and canon_snapshot <> '{}'::jsonb),
  rationale text not null default '',
  accepted_at timestamptz not null default now(),
  accepted_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, poll_id, id),
  unique (owner_id, poll_id, revision_number),
  unique (owner_id, poll_result_id),
  check (accepted_by = owner_id),
  foreign key (owner_id, poll_id) references public.polls (owner_id, id) on delete restrict,
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict,
  foreign key (owner_id, next_episode_id) references public.episodes (owner_id, id) on delete restrict,
  foreign key (owner_id, poll_id, poll_result_id) references public.poll_results (owner_id, poll_id, id) on delete restrict,
  foreign key (owner_id, poll_id, supersedes_decision_id) references public.canonical_decisions (owner_id, poll_id, id) on delete restrict
);

create table public.image_references (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  asset_id uuid not null,
  reference_kind text not null check (reference_kind in ('CHARACTER', 'LORE_FACT', 'SCENE', 'EPISODE')),
  character_id uuid,
  lore_fact_id uuid,
  scene_id uuid,
  episode_id uuid,
  label text not null default '',
  crop jsonb not null default '{}'::jsonb check (jsonb_typeof(crop) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  check (
    (reference_kind = 'CHARACTER' and character_id is not null and lore_fact_id is null and scene_id is null and episode_id is null)
    or (reference_kind = 'LORE_FACT' and character_id is null and lore_fact_id is not null and scene_id is null and episode_id is null)
    or (reference_kind = 'SCENE' and character_id is null and lore_fact_id is null and scene_id is not null and episode_id is null)
    or (reference_kind = 'EPISODE' and character_id is null and lore_fact_id is null and scene_id is null and episode_id is not null)
  ),
  foreign key (owner_id, asset_id) references public.media_assets (owner_id, id) on delete restrict,
  foreign key (owner_id, character_id) references public.characters (owner_id, id) on delete restrict,
  foreign key (owner_id, lore_fact_id) references public.lore_facts (owner_id, id) on delete restrict,
  foreign key (owner_id, scene_id) references public.scenes (owner_id, id) on delete restrict,
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  series_id uuid,
  season_id uuid,
  episode_id uuid,
  provider text not null default 'MANUAL' check (provider in ('MANUAL', 'OPENAI', 'BYOK')),
  model text,
  status text not null default 'PENDING' check (status in ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED')),
  prompt_version text not null default '1',
  input_snapshot jsonb not null default '{}'::jsonb check (jsonb_typeof(input_snapshot) = 'object'),
  output_snapshot jsonb check (output_snapshot is null or jsonb_typeof(output_snapshot) = 'object'),
  request_hash text check (request_hash is null or request_hash ~ '^[0-9a-f]{64}$'),
  safe_error_code text,
  attempt_count smallint not null default 0 check (attempt_count between 0 and 10),
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  check ((season_id is null or series_id is not null) and (episode_id is null or season_id is not null)),
  foreign key (owner_id, series_id) references public.series (owner_id, id) on delete restrict,
  foreign key (owner_id, series_id, season_id) references public.seasons (owner_id, series_id, id) on delete restrict,
  foreign key (owner_id, season_id, episode_id) references public.episodes (owner_id, season_id, id) on delete restrict,
  check ((status in ('SUCCEEDED', 'FAILED', 'CANCELLED')) = (completed_at is not null))
);

create index seasons_by_series on public.seasons (owner_id, series_id, season_number);
create index characters_by_series on public.characters (owner_id, series_id, season_id, name);
create index lore_facts_by_series on public.lore_facts (owner_id, series_id, season_id, category, status);
create index episodes_by_season on public.episodes (owner_id, season_id, episode_number);
create index revisions_by_episode on public.episode_revisions (owner_id, episode_id, revision_number desc);
create index scenes_by_episode on public.scenes (owner_id, episode_id, scene_index);
create index scenes_by_start_asset on public.scenes (owner_id, start_frame_asset_id);
create index scenes_by_end_asset on public.scenes (owner_id, end_frame_asset_id);
create index choices_by_episode on public.choices (owner_id, episode_id, option_key);
create index polls_by_status on public.polls (owner_id, status, closes_at);
create index poll_results_by_poll on public.poll_results (owner_id, poll_id, revision_number desc);
create index decisions_by_poll on public.canonical_decisions (owner_id, poll_id, revision_number desc);
create index media_assets_by_status on public.media_assets (owner_id, upload_status, created_at desc);
create index image_references_by_asset on public.image_references (owner_id, asset_id);
create index image_references_by_character on public.image_references (owner_id, character_id);
create index image_references_by_lore on public.image_references (owner_id, lore_fact_id);
create index image_references_by_scene on public.image_references (owner_id, scene_id);
create index image_references_by_episode on public.image_references (owner_id, episode_id);
create index generation_jobs_by_episode on public.generation_jobs (owner_id, episode_id, created_at desc);

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = pg_catalog
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.reject_append_only_change()
returns trigger language plpgsql set search_path = pg_catalog
as $$
begin
  raise exception 'append_only_record' using errcode = '55000';
end;
$$;

create or replace function public.protect_published_episode()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid;
  v_episode_id uuid;
begin
  if tg_table_name in ('scenes', 'choices') then
    if tg_op = 'UPDATE' and new.episode_id is distinct from old.episode_id then
      raise exception 'episode_children_cannot_be_reassigned' using errcode = '55000';
    end if;
  end if;

  if tg_table_name = 'episodes' then
    if tg_op = 'DELETE' then v_owner_id := old.owner_id; v_episode_id := old.id;
    else v_owner_id := new.owner_id; v_episode_id := new.id; end if;
  elsif tg_table_name = 'image_references' then
    if tg_op = 'DELETE' then
      v_owner_id := old.owner_id; v_episode_id := old.episode_id;
      if v_episode_id is null and old.scene_id is not null then
        select s.episode_id into v_episode_id from public.scenes s where s.owner_id = old.owner_id and s.id = old.scene_id;
      end if;
    else
      v_owner_id := new.owner_id; v_episode_id := new.episode_id;
      if v_episode_id is null and new.scene_id is not null then
        select s.episode_id into v_episode_id from public.scenes s where s.owner_id = new.owner_id and s.id = new.scene_id;
      end if;
    end if;
  else
    if tg_op = 'DELETE' then v_owner_id := old.owner_id; v_episode_id := old.episode_id;
    else v_owner_id := new.owner_id; v_episode_id := new.episode_id; end if;
  end if;

  if v_episode_id is not null and exists (
    select 1 from public.episodes e
    where e.owner_id = v_owner_id and e.id = v_episode_id and e.status = 'PUBLISHED'
  ) then
    if tg_op = 'DELETE' then
      raise exception 'published_episode_is_immutable' using errcode = '55000';
    elsif tg_table_name = 'episodes'
      and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
      raise exception 'published_episode_is_immutable' using errcode = '55000';
    elsif tg_table_name <> 'episodes' then
      raise exception 'published_episode_is_immutable' using errcode = '55000';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.assert_episode_ready()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid;
  v_episode_id uuid;
  v_status text;
  v_is_finale boolean;
  v_duration_ms integer;
  v_choice_count integer;
  v_scene record;
  v_scene_count integer := 0;
  v_expected_index integer := 1;
  v_cursor_ms integer := 0;
begin
  if tg_table_name = 'episodes' then
    if tg_op = 'DELETE' then v_owner_id := old.owner_id; v_episode_id := old.id;
    else v_owner_id := new.owner_id; v_episode_id := new.id; end if;
  else
    if tg_op = 'DELETE' then v_owner_id := old.owner_id; v_episode_id := old.episode_id;
    else v_owner_id := new.owner_id; v_episode_id := new.episode_id; end if;
  end if;

  select e.status, e.is_season_finale, e.duration_ms
    into v_status, v_is_finale, v_duration_ms
  from public.episodes e where e.owner_id = v_owner_id and e.id = v_episode_id;
  if not found or v_status not in ('READY', 'PUBLISHED') then return null; end if;

  select count(*) into v_choice_count from public.choices c
  where c.owner_id = v_owner_id and c.episode_id = v_episode_id;
  if (not v_is_finale and v_choice_count <> 2) or (v_is_finale and v_choice_count not in (0, 2)) then
    raise exception 'episode_requires_two_distinct_choices_unless_finale' using errcode = '23514';
  end if;
  if v_choice_count = 2 and exists (
    select 1 from public.choices c1
    join public.choices c2 on c2.owner_id = c1.owner_id and c2.episode_id = c1.episode_id
      and c1.option_key = '1' and c2.option_key = '2'
    where c1.owner_id = v_owner_id and c1.episode_id = v_episode_id
      and (lower(btrim(c1.label)) = lower(btrim(c2.label))
        or lower(btrim(c1.consequence)) = lower(btrim(c2.consequence)))
  ) then
    raise exception 'episode_choices_must_differ' using errcode = '23514';
  end if;

  for v_scene in
    select s.scene_index, s.start_ms, s.end_ms from public.scenes s
    where s.owner_id = v_owner_id and s.episode_id = v_episode_id order by s.scene_index
  loop
    v_scene_count := v_scene_count + 1;
    if v_scene.scene_index <> v_expected_index or v_scene.start_ms <> v_cursor_ms then
      raise exception 'episode_scene_timeline_has_gap_overlap_or_order_error' using errcode = '23514';
    end if;
    v_expected_index := v_expected_index + 1;
    v_cursor_ms := v_scene.end_ms;
  end loop;
  if v_scene_count = 0 or v_cursor_ms <> v_duration_ms then
    raise exception 'episode_scene_timeline_must_cover_duration' using errcode = '23514';
  end if;
  return null;
end;
$$;

create or replace function public.validate_frame_assets()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  if new.start_frame_asset_id is not null and not exists (
    select 1 from public.media_assets a where a.owner_id = new.owner_id
      and a.id = new.start_frame_asset_id and a.upload_status = 'READY'
  ) then raise exception 'start_frame_asset_not_ready' using errcode = '23514'; end if;
  if new.end_frame_asset_id is not null and not exists (
    select 1 from public.media_assets a where a.owner_id = new.owner_id
      and a.id = new.end_frame_asset_id and a.upload_status = 'READY'
  ) then raise exception 'end_frame_asset_not_ready' using errcode = '23514'; end if;
  return new;
end;
$$;

create or replace function public.validate_image_reference()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  if not exists (
    select 1 from public.media_assets a where a.owner_id = new.owner_id
      and a.id = new.asset_id and a.upload_status = 'READY'
  ) then raise exception 'referenced_asset_not_ready' using errcode = '23514'; end if;
  return new;
end;
$$;

create or replace function public.protect_referenced_asset()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  if old.upload_status = 'READY' and new.upload_status <> 'READY' and (
    exists (select 1 from public.scenes s where s.owner_id = old.owner_id and (s.start_frame_asset_id = old.id or s.end_frame_asset_id = old.id))
    or exists (select 1 from public.image_references r where r.owner_id = old.owner_id and r.asset_id = old.id)
  ) then raise exception 'asset_is_referenced' using errcode = '55000'; end if;
  return new;
end;
$$;

create or replace function public.validate_poll()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
declare
  v_episode_status text;
  v_is_finale boolean;
  v_choice_count integer;
begin
  if tg_op = 'UPDATE' and (
    new.tie_break_rule is distinct from old.tie_break_rule
    or new.tie_break_option is distinct from old.tie_break_option
    or new.opened_at is distinct from old.opened_at
    or new.closes_at is distinct from old.closes_at
  ) then raise exception 'poll_rules_are_immutable_after_creation' using errcode = '55000'; end if;

  select e.status, e.is_season_finale into v_episode_status, v_is_finale
  from public.episodes e where e.owner_id = new.owner_id and e.id = new.episode_id;
  if v_is_finale then raise exception 'season_finale_does_not_require_a_poll' using errcode = '23514'; end if;
  if new.status = 'OPEN' and v_episode_status <> 'PUBLISHED' then
    raise exception 'poll_requires_published_episode' using errcode = '23514';
  end if;
  select count(*) into v_choice_count from public.choices c
  where c.owner_id = new.owner_id and c.episode_id = new.episode_id;
  if v_choice_count <> 2 then raise exception 'poll_requires_two_choices' using errcode = '23514'; end if;
  if new.status in ('CLOSED', 'VERIFIED') and new.closed_at is null then
    raise exception 'closed_poll_requires_closed_at' using errcode = '23514';
  end if;
  if new.status = 'OPEN' and new.closed_at is not null then
    raise exception 'open_poll_cannot_have_closed_at' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.validate_poll_result()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
declare
  v_poll_status text;
  v_tie_break_option char(1);
  v_latest_revision integer;
  v_latest_id uuid;
begin
  select p.status, p.tie_break_option into v_poll_status, v_tie_break_option
  from public.polls p where p.owner_id = new.owner_id and p.id = new.poll_id for update;
  if not found or v_poll_status not in ('CLOSED', 'VERIFIED') then
    raise exception 'poll_result_requires_closed_poll' using errcode = '23514';
  end if;

  select r.revision_number, r.id into v_latest_revision, v_latest_id
  from public.poll_results r where r.owner_id = new.owner_id and r.poll_id = new.poll_id
  order by r.revision_number desc limit 1;
  if v_latest_revision is null then
    if new.revision_number <> 1 or new.supersedes_result_id is not null then
      raise exception 'first_poll_result_revision_must_be_one' using errcode = '23514';
    end if;
  elsif new.revision_number <> v_latest_revision + 1 or new.supersedes_result_id is distinct from v_latest_id then
    raise exception 'poll_result_revision_must_supersede_latest' using errcode = '23514';
  end if;

  if new.verification_status = 'VERIFIED' then
    if new.option_1_count = 0 and new.option_2_count = 0 then
      if new.winner_option is not null then raise exception 'no_votes_cannot_have_winner' using errcode = '23514'; end if;
    elsif new.option_1_count > new.option_2_count and new.winner_option <> '1' then
      raise exception 'poll_winner_does_not_match_tally' using errcode = '23514';
    elsif new.option_2_count > new.option_1_count and new.winner_option <> '2' then
      raise exception 'poll_winner_does_not_match_tally' using errcode = '23514';
    elsif new.option_1_count = new.option_2_count and new.winner_option <> v_tie_break_option then
      raise exception 'poll_tie_must_follow_published_rule' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.sync_poll_result_status()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  update public.polls p
  set status = case when new.verification_status = 'VERIFIED' then 'VERIFIED' else 'CLOSED' end
  where p.owner_id = new.owner_id and p.id = new.poll_id;
  return new;
end;
$$;

create or replace function public.validate_canonical_decision()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
declare
  v_episode_id uuid;
  v_poll_status text;
  v_result_status text;
  v_winner char(1);
  v_latest_result_id uuid;
  v_latest_decision_id uuid;
  v_latest_revision integer;
begin
  select p.episode_id, p.status into v_episode_id, v_poll_status
  from public.polls p where p.owner_id = new.owner_id and p.id = new.poll_id;
  if not found or new.episode_id <> v_episode_id or v_poll_status <> 'VERIFIED' then
    raise exception 'canonical_decision_requires_verified_poll_for_same_episode' using errcode = '23514';
  end if;

  select r.verification_status, r.winner_option into v_result_status, v_winner
  from public.poll_results r where r.owner_id = new.owner_id and r.poll_id = new.poll_id and r.id = new.poll_result_id;
  if not found or v_result_status <> 'VERIFIED' or v_winner is null then
    raise exception 'canonical_decision_requires_verified_winner' using errcode = '23514';
  end if;
  select r.id into v_latest_result_id from public.poll_results r
  where r.owner_id = new.owner_id and r.poll_id = new.poll_id order by r.revision_number desc limit 1;
  if new.poll_result_id <> v_latest_result_id then
    raise exception 'canonical_decision_must_use_latest_result' using errcode = '23514';
  end if;

  select d.id, d.revision_number into v_latest_decision_id, v_latest_revision
  from public.canonical_decisions d where d.owner_id = new.owner_id and d.poll_id = new.poll_id
  order by d.revision_number desc limit 1;
  if v_latest_revision is null then
    if new.revision_number <> 1 or new.supersedes_decision_id is not null then
      raise exception 'first_canonical_decision_revision_must_be_one' using errcode = '23514';
    end if;
  elsif new.revision_number <> v_latest_revision + 1 or new.supersedes_decision_id is distinct from v_latest_decision_id then
    raise exception 'canonical_decision_revision_must_supersede_latest' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.append_episode_revision(p_episode_id uuid, p_change_note text)
returns integer language plpgsql set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_episode public.episodes;
  v_revision_number integer;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  select e.* into v_episode from public.episodes e
  where e.owner_id = v_owner_id and e.id = p_episode_id for update;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;
  if v_episode.status = 'PUBLISHED' then raise exception 'published_episode_is_immutable' using errcode = '55000'; end if;

  select coalesce(max(r.revision_number), 0) + 1 into v_revision_number
  from public.episode_revisions r where r.owner_id = v_owner_id and r.episode_id = p_episode_id;
  insert into public.episode_revisions (owner_id, episode_id, revision_number, snapshot, change_note)
  values (
    v_owner_id,
    p_episode_id,
    v_revision_number,
    jsonb_build_object(
      'episode', to_jsonb(v_episode),
      'scenes', coalesce((select jsonb_agg(to_jsonb(s) order by s.scene_index) from public.scenes s where s.owner_id = v_owner_id and s.episode_id = p_episode_id), '[]'::jsonb),
      'choices', coalesce((select jsonb_agg(to_jsonb(c) order by c.option_key) from public.choices c where c.owner_id = v_owner_id and c.episode_id = p_episode_id), '[]'::jsonb)
    ),
    left(coalesce(p_change_note, ''), 500)
  );
  return v_revision_number;
end;
$$;

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

  v_scene_count := ceil(p_duration_ms::numeric / 8000)::integer;
  delete from public.scenes s where s.owner_id = v_owner_id and s.episode_id = p_episode_id and s.scene_index > v_scene_count;
  for v_scene in 1..v_scene_count loop
    update public.scenes set start_ms = (v_scene - 1) * 8000, end_ms = least(v_scene * 8000, p_duration_ms)
    where owner_id = v_owner_id and episode_id = p_episode_id and scene_index = v_scene;
    if not found then
      insert into public.scenes (owner_id, episode_id, scene_index, start_ms, end_ms)
      values (v_owner_id, p_episode_id, v_scene, (v_scene - 1) * 8000, least(v_scene * 8000, p_duration_ms));
    end if;
  end loop;
  return public.append_episode_revision(p_episode_id, 'Edição do roteiro e da duração');
end;
$$;

create or replace function public.attach_scene_frames(p_scene_id uuid, p_start_asset_id uuid, p_end_asset_id uuid)
returns integer language plpgsql set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_episode_id uuid;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_start_asset_id is not null and p_start_asset_id = p_end_asset_id then
    raise exception 'frame_assets_must_be_distinct' using errcode = '23514';
  end if;
  select s.episode_id into v_episode_id from public.scenes s
  join public.episodes e on e.owner_id = s.owner_id and e.id = s.episode_id
  where s.owner_id = v_owner_id and s.id = p_scene_id and e.status <> 'PUBLISHED' for update of e;
  if not found then raise exception 'scene_not_found_or_published' using errcode = 'P0002'; end if;
  update public.scenes set start_frame_asset_id = p_start_asset_id, end_frame_asset_id = p_end_asset_id
  where owner_id = v_owner_id and id = p_scene_id;
  return public.append_episode_revision(v_episode_id, 'Vínculos privados de imagem revisados');
end;
$$;

create or replace function public.save_episode_scene(
  p_scene_id uuid,
  p_narration_pt_br text,
  p_visual_description text,
  p_camera_notes text,
  p_lighting_notes text,
  p_start_frame_prompt_en text,
  p_end_frame_prompt_en text,
  p_motion_prompt_en text,
  p_audio_notes text
)
returns integer language plpgsql set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_episode_id uuid;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  select s.episode_id into v_episode_id from public.scenes s
  join public.episodes e on e.owner_id = s.owner_id and e.id = s.episode_id
  where s.owner_id = v_owner_id and s.id = p_scene_id and e.status <> 'PUBLISHED' for update of e;
  if not found then raise exception 'scene_not_found_or_published' using errcode = 'P0002'; end if;
  update public.scenes set
    narration_pt_br = p_narration_pt_br,
    visual_description = p_visual_description,
    camera_notes = p_camera_notes,
    lighting_notes = p_lighting_notes,
    start_frame_prompt_en = p_start_frame_prompt_en,
    end_frame_prompt_en = p_end_frame_prompt_en,
    motion_prompt_en = p_motion_prompt_en,
    audio_notes = p_audio_notes
  where owner_id = v_owner_id and id = p_scene_id;
  return public.append_episode_revision(v_episode_id, 'Edição manual do storyboard');
end;
$$;

create or replace function public.save_episode_choices(
  p_episode_id uuid,
  p_option_1_label text,
  p_option_1_consequence text,
  p_option_2_label text,
  p_option_2_consequence text
)
returns integer language plpgsql set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if lower(btrim(p_option_1_label)) = lower(btrim(p_option_2_label))
    or lower(btrim(p_option_1_consequence)) = lower(btrim(p_option_2_consequence)) then
    raise exception 'episode_choices_must_differ' using errcode = '23514';
  end if;
  perform 1 from public.episodes e where e.owner_id = v_owner_id and e.id = p_episode_id and e.status <> 'PUBLISHED' for update;
  if not found then raise exception 'episode_not_found_or_published' using errcode = 'P0002'; end if;
  insert into public.choices (owner_id, episode_id, option_key, label, consequence)
  values
    (v_owner_id, p_episode_id, '1', p_option_1_label, p_option_1_consequence),
    (v_owner_id, p_episode_id, '2', p_option_2_label, p_option_2_consequence)
  on conflict (owner_id, episode_id, option_key) do update
  set label = excluded.label, consequence = excluded.consequence;
  return public.append_episode_revision(p_episode_id, 'Edição das opções interativas');
end;
$$;

create or replace function public.set_episode_status(p_episode_id uuid, p_status text)
returns integer language plpgsql set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_old_status text;
  v_revision_number integer;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_status not in ('READY', 'PUBLISHED') then raise exception 'invalid_episode_status_transition' using errcode = '23514'; end if;
  select e.status into v_old_status from public.episodes e
  where e.owner_id = v_owner_id and e.id = p_episode_id for update;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;
  if (p_status = 'READY' and v_old_status <> 'DRAFT') or (p_status = 'PUBLISHED' and v_old_status <> 'READY') then
    raise exception 'invalid_episode_status_transition' using errcode = '23514';
  end if;
  v_revision_number := public.append_episode_revision(p_episode_id, case when p_status = 'READY' then 'Revisão marcada como pronta' else 'Publicação manual autorizada pela autora' end);
  update public.episodes set status = p_status, published_at = case when p_status = 'PUBLISHED' then now() else null end
  where owner_id = v_owner_id and id = p_episode_id;
  return v_revision_number;
end;
$$;

create trigger protect_published_episode before update or delete on public.episodes for each row execute function public.protect_published_episode();
create trigger protect_published_scenes before insert or update or delete on public.scenes for each row execute function public.protect_published_episode();
create trigger protect_published_choices before insert or update or delete on public.choices for each row execute function public.protect_published_episode();
create trigger protect_published_revisions before insert or update or delete on public.episode_revisions for each row execute function public.protect_published_episode();
create trigger protect_published_image_references before insert or update or delete on public.image_references for each row execute function public.protect_published_episode();
create trigger validate_scene_frames before insert or update on public.scenes for each row execute function public.validate_frame_assets();
create trigger validate_reference_asset before insert or update on public.image_references for each row execute function public.validate_image_reference();
create trigger protect_used_asset before update on public.media_assets for each row execute function public.protect_referenced_asset();
create trigger validate_poll_before_write before insert or update on public.polls for each row execute function public.validate_poll();
create trigger validate_poll_result_before_insert before insert on public.poll_results for each row execute function public.validate_poll_result();
create trigger sync_poll_result_after_insert after insert on public.poll_results for each row execute function public.sync_poll_result_status();
create trigger validate_canonical_decision_before_insert before insert on public.canonical_decisions for each row execute function public.validate_canonical_decision();
create trigger reject_revision_mutation before update or delete on public.episode_revisions for each row execute function public.reject_append_only_change();
create trigger reject_poll_result_mutation before update or delete on public.poll_results for each row execute function public.reject_append_only_change();
create trigger reject_decision_mutation before update or delete on public.canonical_decisions for each row execute function public.reject_append_only_change();

create constraint trigger validate_episode_after_episode_write
after insert or update on public.episodes deferrable initially deferred
for each row execute function public.assert_episode_ready();
create constraint trigger validate_episode_after_scene_write
after insert or update or delete on public.scenes deferrable initially deferred
for each row execute function public.assert_episode_ready();
create constraint trigger validate_episode_after_choice_write
after insert or update or delete on public.choices deferrable initially deferred
for each row execute function public.assert_episode_ready();

do $$
declare
  v_table text;
  v_append_only text[] := array['episode_revisions', 'poll_results', 'canonical_decisions'];
  v_tables text[] := array[
    'series', 'seasons', 'characters', 'lore_facts', 'episodes', 'episode_revisions',
    'media_assets', 'scenes', 'choices', 'polls', 'poll_results', 'canonical_decisions',
    'image_references', 'generation_jobs'
  ];
begin
  foreach v_table in array v_tables loop
    execute format('alter table public.%I enable row level security', v_table);
    execute format('alter table public.%I force row level security', v_table);
    execute format('revoke all on table public.%I from public, anon', v_table);
    execute format('create policy owner_select on public.%I for select to authenticated using (owner_id = (select auth.uid()) and (select auth.jwt() -> ''app_metadata'' ->> ''dif_studio_owner'') = ''true'')', v_table);
    execute format('create policy owner_insert on public.%I for insert to authenticated with check (owner_id = (select auth.uid()) and (select auth.jwt() -> ''app_metadata'' ->> ''dif_studio_owner'') = ''true'')', v_table);
    if v_table = any(v_append_only) then
      execute format('grant select, insert on table public.%I to authenticated', v_table);
    else
      execute format('create policy owner_update on public.%I for update to authenticated using (owner_id = (select auth.uid()) and (select auth.jwt() -> ''app_metadata'' ->> ''dif_studio_owner'') = ''true'') with check (owner_id = (select auth.uid()) and (select auth.jwt() -> ''app_metadata'' ->> ''dif_studio_owner'') = ''true'')', v_table);
      execute format('create policy owner_delete on public.%I for delete to authenticated using (owner_id = (select auth.uid()) and (select auth.jwt() -> ''app_metadata'' ->> ''dif_studio_owner'') = ''true'')', v_table);
      execute format('grant select, insert, update, delete on table public.%I to authenticated', v_table);
    end if;
  end loop;
end;
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.reject_append_only_change() from public, anon, authenticated;
revoke all on function public.protect_published_episode() from public, anon, authenticated;
revoke all on function public.assert_episode_ready() from public, anon, authenticated;
revoke all on function public.validate_frame_assets() from public, anon, authenticated;
revoke all on function public.validate_image_reference() from public, anon, authenticated;
revoke all on function public.protect_referenced_asset() from public, anon, authenticated;
revoke all on function public.validate_poll() from public, anon, authenticated;
revoke all on function public.validate_poll_result() from public, anon, authenticated;
revoke all on function public.sync_poll_result_status() from public, anon, authenticated;
revoke all on function public.validate_canonical_decision() from public, anon, authenticated;
revoke all on function public.append_episode_revision(uuid, text) from public, anon;
revoke all on function public.save_episode_content(uuid, text, text, text, text, text, text, text, integer, boolean, jsonb) from public, anon;
revoke all on function public.save_episode_scene(uuid, text, text, text, text, text, text, text, text) from public, anon;
revoke all on function public.attach_scene_frames(uuid, uuid, uuid) from public, anon;
revoke all on function public.save_episode_choices(uuid, text, text, text, text) from public, anon;
revoke all on function public.set_episode_status(uuid, text) from public, anon;
grant execute on function public.append_episode_revision(uuid, text) to authenticated;
grant execute on function public.save_episode_content(uuid, text, text, text, text, text, text, text, integer, boolean, jsonb) to authenticated;
grant execute on function public.save_episode_scene(uuid, text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.attach_scene_frames(uuid, uuid, uuid) to authenticated;
grant execute on function public.save_episode_choices(uuid, text, text, text, text) to authenticated;
grant execute on function public.set_episode_status(uuid, text) to authenticated;

create trigger set_series_updated_at before update on public.series for each row execute function public.set_updated_at();
create trigger set_seasons_updated_at before update on public.seasons for each row execute function public.set_updated_at();
create trigger set_characters_updated_at before update on public.characters for each row execute function public.set_updated_at();
create trigger set_lore_facts_updated_at before update on public.lore_facts for each row execute function public.set_updated_at();
create trigger set_episodes_updated_at before update on public.episodes for each row execute function public.set_updated_at();
create trigger set_scenes_updated_at before update on public.scenes for each row execute function public.set_updated_at();
create trigger set_choices_updated_at before update on public.choices for each row execute function public.set_updated_at();
create trigger set_polls_updated_at before update on public.polls for each row execute function public.set_updated_at();
create trigger set_assets_updated_at before update on public.media_assets for each row execute function public.set_updated_at();
create trigger set_references_updated_at before update on public.image_references for each row execute function public.set_updated_at();
create trigger set_jobs_updated_at before update on public.generation_jobs for each row execute function public.set_updated_at();

comment on table public.episode_revisions is 'Append-only episode snapshots; published episode content is immutable.';
comment on table public.poll_results is 'Append-only verified vote-result revisions; corrections supersede prior rows.';
comment on table public.canonical_decisions is 'Append-only author-approved canon snapshots tied to the latest verified poll result.';
comment on table public.media_assets is 'Cloudinary metadata only. Never store image bytes, signed URLs, or API secrets.';
comment on table public.generation_jobs is 'Provider job metadata only; never store provider tokens or credentials.';
