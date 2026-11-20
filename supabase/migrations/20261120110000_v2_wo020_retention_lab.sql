-- V2 WO-020: private retention lab. Owners register manually published posts,
-- creative variants and aggregate analytics snapshots; nothing is fetched from
-- social platforms and no viewer-level data is stored.

alter table public.hook_variants
  add constraint hook_variants_owner_id_id_key unique (owner_id, id);

create table public.published_posts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  episode_id uuid not null,
  platform text not null check (platform in ('tiktok', 'reels', 'youtube_shorts', 'other')),
  url text not null check (char_length(url) between 8 and 500 and url ~ '^https?://'),
  published_at timestamptz not null,
  label text not null default '' check (char_length(label) <= 120),
  notes text not null default '' check (char_length(notes) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, episode_id, platform, url),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict
);

create table public.published_post_versions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  post_id uuid not null,
  revision_number integer not null check (revision_number between 1 and 100000),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  change_note text not null default '' check (char_length(change_note) <= 300),
  created_at timestamptz not null default now(),
  unique (owner_id, post_id, revision_number),
  unique (owner_id, id),
  foreign key (owner_id, post_id) references public.published_posts (owner_id, id) on delete restrict
);

create table public.creative_variants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  post_id uuid not null,
  kind text not null check (kind in ('HOOK', 'COVER', 'CTA', 'BASELINE')),
  label text not null check (char_length(btrim(label)) between 1 and 80),
  hook_variant_id uuid,
  cover_revision_id uuid,
  end_card_id uuid,
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, post_id, kind, label),
  foreign key (owner_id, post_id) references public.published_posts (owner_id, id) on delete restrict,
  foreign key (owner_id, hook_variant_id) references public.hook_variants (owner_id, id) on delete restrict,
  foreign key (owner_id, cover_revision_id) references public.cover_revisions (owner_id, id) on delete restrict,
  foreign key (owner_id, end_card_id) references public.choice_end_cards (owner_id, id) on delete restrict
);

create table public.retention_imports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  filename text not null check (char_length(filename) between 1 and 120),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  row_count integer not null check (row_count between 0 and 5000),
  imported_count integer not null check (imported_count between 0 and 5000),
  skipped_count integer not null check (skipped_count between 0 and 5000),
  error_count integer not null check (error_count between 0 and 5000),
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, sha256)
);

create table public.analytics_snapshots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  post_id uuid not null,
  revision_number integer not null check (revision_number between 1 and 100000),
  supersedes_snapshot_id uuid,
  import_id uuid,
  captured_at timestamptz not null,
  period_start timestamptz not null,
  period_end timestamptz not null,
  source text not null check (source in ('MANUAL', 'CSV')),
  note text not null default '' check (char_length(note) <= 1000),
  views bigint check (views >= 0),
  likes bigint check (likes >= 0),
  comments bigint check (comments >= 0),
  shares bigint check (shares >= 0),
  saves bigint check (saves >= 0),
  followers_gained integer check (followers_gained >= 0),
  avg_watch_ms integer check (avg_watch_ms between 0 and 600000),
  completion_pct numeric(5, 2) check (completion_pct between 0 and 100),
  metric_version integer not null default 1 check (metric_version = 1),
  snapshot_hash text not null check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  check (period_start < period_end),
  check (captured_at >= period_end),
  unique (owner_id, post_id, revision_number),
  unique (owner_id, post_id, snapshot_hash),
  unique (owner_id, id),
  foreign key (owner_id, post_id) references public.published_posts (owner_id, id) on delete restrict,
  foreign key (owner_id, supersedes_snapshot_id) references public.analytics_snapshots (owner_id, id)
    on delete restrict deferrable initially deferred,
  foreign key (owner_id, import_id) references public.retention_imports (owner_id, id) on delete restrict
);

create table public.retention_experiments (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  episode_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  variant_a_id uuid not null,
  variant_b_id uuid not null,
  hypothesis text not null default '' check (char_length(hypothesis) <= 500),
  status text not null default 'ACTIVE' check (status in ('DRAFT', 'ACTIVE', 'CLOSED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (variant_a_id <> variant_b_id),
  unique (owner_id, id),
  unique (owner_id, episode_id, name),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict,
  foreign key (owner_id, variant_a_id) references public.creative_variants (owner_id, id) on delete restrict,
  foreign key (owner_id, variant_b_id) references public.creative_variants (owner_id, id) on delete restrict
);

create index published_posts_by_episode on public.published_posts (owner_id, episode_id, published_at desc);
create index analytics_snapshots_by_post on public.analytics_snapshots (owner_id, post_id, period_end desc);

alter table public.published_posts enable row level security;
alter table public.published_posts force row level security;
alter table public.published_post_versions enable row level security;
alter table public.published_post_versions force row level security;
alter table public.creative_variants enable row level security;
alter table public.creative_variants force row level security;
alter table public.retention_imports enable row level security;
alter table public.retention_imports force row level security;
alter table public.analytics_snapshots enable row level security;
alter table public.analytics_snapshots force row level security;
alter table public.retention_experiments enable row level security;
alter table public.retention_experiments force row level security;

revoke all on table public.published_posts from public, anon, authenticated;
revoke all on table public.published_post_versions from public, anon, authenticated;
revoke all on table public.creative_variants from public, anon, authenticated;
revoke all on table public.retention_imports from public, anon, authenticated;
revoke all on table public.analytics_snapshots from public, anon, authenticated;
revoke all on table public.retention_experiments from public, anon, authenticated;

grant select on table public.published_posts to authenticated;
grant select on table public.published_post_versions to authenticated;
grant select on table public.creative_variants to authenticated;
grant select on table public.retention_imports to authenticated;
grant select on table public.analytics_snapshots to authenticated;
grant select on table public.retention_experiments to authenticated;
grant select, insert, update, delete on table public.published_posts to service_role;
grant select, insert, update, delete on table public.published_post_versions to service_role;
grant select, insert, update, delete on table public.creative_variants to service_role;
grant select, insert, update, delete on table public.retention_imports to service_role;
grant select, insert, update, delete on table public.analytics_snapshots to service_role;
grant select, insert, update, delete on table public.retention_experiments to service_role;

create policy owner_select on public.published_posts for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true');
create policy owner_select on public.published_post_versions for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true');
create policy owner_select on public.creative_variants for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true');
create policy owner_select on public.retention_imports for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true');
create policy owner_select on public.analytics_snapshots for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true');
create policy owner_select on public.retention_experiments for select to authenticated
  using (owner_id = (select auth.uid()) and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true');

create or replace function public.reject_retention_history_mutation()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
begin
  if current_setting('dif.retention_delete', true) = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'retention_history_is_immutable' using errcode = '55000';
end;
$$;

create trigger published_post_versions_immutable
  before update or delete on public.published_post_versions
  for each row execute function public.reject_retention_history_mutation();
create trigger retention_imports_immutable
  before update or delete on public.retention_imports
  for each row execute function public.reject_retention_history_mutation();
create trigger analytics_snapshots_immutable
  before update or delete on public.analytics_snapshots
  for each row execute function public.reject_retention_history_mutation();

create or replace function public.save_published_post(
  p_owner_id uuid,
  p_post_id uuid,
  p_episode_id uuid,
  p_platform text,
  p_url text,
  p_published_at timestamptz,
  p_label text,
  p_notes text,
  p_change_note text default ''
)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_post public.published_posts;
  v_revision integer;
begin
  if p_owner_id is null or p_episode_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_platform not in ('tiktok', 'reels', 'youtube_shorts', 'other')
    or p_url !~ '^https?://' or char_length(p_url) > 500
    or char_length(coalesce(p_label, '')) > 120
    or char_length(coalesce(p_notes, '')) > 1000 then
    raise exception 'retention_post_invalid' using errcode = '23514';
  end if;
  if not exists (select 1 from public.episodes e where e.owner_id = p_owner_id and e.id = p_episode_id) then
    raise exception 'episode_not_found' using errcode = 'P0002';
  end if;
  if p_post_id is null then
    insert into public.published_posts (
      owner_id, episode_id, platform, url, published_at, label, notes
    ) values (
      p_owner_id, p_episode_id, p_platform, btrim(p_url), p_published_at,
      btrim(coalesce(p_label, '')), btrim(coalesce(p_notes, ''))
    )
    on conflict (owner_id, episode_id, platform, url) do update
      set published_at = excluded.published_at,
          label = excluded.label,
          notes = excluded.notes,
          updated_at = now()
    returning * into v_post;
  else
    update public.published_posts
      set platform = p_platform,
          url = btrim(p_url),
          published_at = p_published_at,
          label = btrim(coalesce(p_label, '')),
          notes = btrim(coalesce(p_notes, '')),
          updated_at = now()
      where owner_id = p_owner_id and id = p_post_id and episode_id = p_episode_id
      returning * into v_post;
    if not found then
      raise exception 'published_post_not_found' using errcode = 'P0002';
    end if;
  end if;
  select coalesce(max(v.revision_number), 0) + 1 into v_revision
  from public.published_post_versions v
  where v.owner_id = p_owner_id and v.post_id = v_post.id;
  insert into public.published_post_versions (
    owner_id, post_id, revision_number, snapshot, change_note
  ) values (
    p_owner_id, v_post.id, v_revision, jsonb_build_object('post', to_jsonb(v_post)),
    btrim(coalesce(p_change_note, ''))
  );
  return v_post.id;
end;
$$;

create or replace function public.save_creative_variant(
  p_owner_id uuid,
  p_post_id uuid,
  p_kind text,
  p_label text,
  p_hook_variant_id uuid default null,
  p_cover_revision_id uuid default null,
  p_end_card_id uuid default null
)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_post public.published_posts;
  v_variant_id uuid;
begin
  if p_owner_id is null or p_post_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_kind not in ('HOOK', 'COVER', 'CTA', 'BASELINE')
    or char_length(btrim(coalesce(p_label, ''))) not between 1 and 80 then
    raise exception 'retention_variant_invalid' using errcode = '23514';
  end if;
  select * into v_post from public.published_posts
  where owner_id = p_owner_id and id = p_post_id;
  if not found then
    raise exception 'published_post_not_found' using errcode = 'P0002';
  end if;
  if p_hook_variant_id is not null and not exists (
    select 1 from public.hook_variants h
    where h.owner_id = p_owner_id and h.id = p_hook_variant_id and h.episode_id = v_post.episode_id
  ) then
    raise exception 'retention_hook_variant_invalid' using errcode = '23514';
  end if;
  if p_cover_revision_id is not null and not exists (
    select 1 from public.cover_revisions c
    where c.owner_id = p_owner_id and c.id = p_cover_revision_id and c.episode_id = v_post.episode_id
  ) then
    raise exception 'retention_cover_invalid' using errcode = '23514';
  end if;
  if p_end_card_id is not null and not exists (
    select 1 from public.choice_end_cards c
    where c.owner_id = p_owner_id and c.id = p_end_card_id and c.episode_id = v_post.episode_id
  ) then
    raise exception 'retention_end_card_invalid' using errcode = '23514';
  end if;
  insert into public.creative_variants (
    owner_id, post_id, kind, label, hook_variant_id, cover_revision_id, end_card_id
  ) values (
    p_owner_id, p_post_id, p_kind, btrim(p_label), p_hook_variant_id,
    p_cover_revision_id, p_end_card_id
  ) returning id into v_variant_id;
  return v_variant_id;
end;
$$;

create or replace function public.save_analytics_snapshot(
  p_owner_id uuid,
  p_post_id uuid,
  p_captured_at timestamptz,
  p_period_start timestamptz,
  p_period_end timestamptz,
  p_source text,
  p_note text,
  p_views bigint,
  p_likes bigint,
  p_comments bigint,
  p_shares bigint,
  p_saves bigint,
  p_followers_gained integer,
  p_avg_watch_ms integer,
  p_completion_pct numeric,
  p_snapshot_hash text,
  p_supersedes_snapshot_id uuid default null,
  p_import_id uuid default null
)
returns integer
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_revision integer;
  v_existing integer;
begin
  if p_owner_id is null or p_post_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_source not in ('MANUAL', 'CSV') or p_snapshot_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'retention_snapshot_invalid' using errcode = '23514';
  end if;
  if not (p_period_start < p_period_end) or p_captured_at < p_period_end then
    raise exception 'retention_period_invalid' using errcode = '23514';
  end if;
  if coalesce(p_views, 0) < 0 or coalesce(p_likes, 0) < 0 or coalesce(p_comments, 0) < 0
    or coalesce(p_shares, 0) < 0 or coalesce(p_saves, 0) < 0
    or coalesce(p_followers_gained, 0) < 0 or coalesce(p_avg_watch_ms, 0) < 0
    or coalesce(p_completion_pct, 0) < 0 or coalesce(p_completion_pct, 0) > 100
    or coalesce(p_avg_watch_ms, 0) > 600000 then
    raise exception 'retention_metric_invalid' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.published_posts p
    where p.owner_id = p_owner_id and p.id = p_post_id
  ) then
    raise exception 'published_post_not_found' using errcode = 'P0002';
  end if;
  if p_supersedes_snapshot_id is not null and not exists (
    select 1 from public.analytics_snapshots s
    where s.owner_id = p_owner_id and s.id = p_supersedes_snapshot_id and s.post_id = p_post_id
  ) then
    raise exception 'retention_supersedes_invalid' using errcode = '23514';
  end if;
  if p_import_id is not null and not exists (
    select 1 from public.retention_imports i where i.owner_id = p_owner_id and i.id = p_import_id
  ) then
    raise exception 'retention_import_invalid' using errcode = '23514';
  end if;
  select s.revision_number into v_existing
  from public.analytics_snapshots s
  where s.owner_id = p_owner_id and s.post_id = p_post_id and s.snapshot_hash = p_snapshot_hash;
  if found then
    return v_existing;
  end if;
  select coalesce(max(s.revision_number), 0) + 1 into v_revision
  from public.analytics_snapshots s
  where s.owner_id = p_owner_id and s.post_id = p_post_id;
  if v_revision > 5000 then
    raise exception 'retention_snapshot_quota' using errcode = '23514';
  end if;
  insert into public.analytics_snapshots (
    owner_id, post_id, revision_number, supersedes_snapshot_id, import_id,
    captured_at, period_start, period_end, source, note,
    views, likes, comments, shares, saves, followers_gained, avg_watch_ms,
    completion_pct, snapshot_hash
  ) values (
    p_owner_id, p_post_id, v_revision, p_supersedes_snapshot_id, p_import_id,
    p_captured_at, p_period_start, p_period_end, p_source, btrim(coalesce(p_note, '')),
    p_views, p_likes, p_comments, p_shares, p_saves, p_followers_gained, p_avg_watch_ms,
    p_completion_pct, p_snapshot_hash
  );
  return v_revision;
end;
$$;

create or replace function public.save_retention_import(
  p_owner_id uuid,
  p_filename text,
  p_sha256 text,
  p_row_count integer,
  p_imported_count integer,
  p_skipped_count integer,
  p_error_count integer
)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if p_owner_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(p_filename, ''))) not between 1 and 120
    or p_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'retention_import_invalid' using errcode = '23514';
  end if;
  insert into public.retention_imports (
    owner_id, filename, sha256, row_count, imported_count, skipped_count, error_count
  ) values (
    p_owner_id, btrim(p_filename), p_sha256, p_row_count, p_imported_count, p_skipped_count, p_error_count
  )
  on conflict (owner_id, sha256) do nothing
  returning id into v_id;
  if v_id is null then
    select i.id into v_id from public.retention_imports i
    where i.owner_id = p_owner_id and i.sha256 = p_sha256;
  end if;
  return v_id;
end;
$$;

create or replace function public.save_retention_experiment(
  p_owner_id uuid,
  p_episode_id uuid,
  p_name text,
  p_variant_a_id uuid,
  p_variant_b_id uuid,
  p_hypothesis text default ''
)
returns uuid
language plpgsql security definer set search_path = pg_catalog, public
as $$
declare
  v_id uuid;
begin
  if p_owner_id is null or p_episode_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_variant_a_id = p_variant_b_id
    or char_length(btrim(coalesce(p_name, ''))) not between 1 and 80 then
    raise exception 'retention_experiment_invalid' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.creative_variants va
    join public.published_posts pa on pa.owner_id = va.owner_id and pa.id = va.post_id
    where va.owner_id = p_owner_id and va.id = p_variant_a_id and pa.episode_id = p_episode_id
  ) or not exists (
    select 1 from public.creative_variants vb
    join public.published_posts pb on pb.owner_id = vb.owner_id and pb.id = vb.post_id
    where vb.owner_id = p_owner_id and vb.id = p_variant_b_id and pb.episode_id = p_episode_id
  ) then
    raise exception 'retention_experiment_variant_invalid' using errcode = '23514';
  end if;
  insert into public.retention_experiments (
    owner_id, episode_id, name, variant_a_id, variant_b_id, hypothesis
  ) values (
    p_owner_id, p_episode_id, btrim(p_name), p_variant_a_id, p_variant_b_id,
    btrim(coalesce(p_hypothesis, ''))
  )
  on conflict (owner_id, episode_id, name) do update
    set variant_a_id = excluded.variant_a_id,
        variant_b_id = excluded.variant_b_id,
        hypothesis = excluded.hypothesis,
        updated_at = now()
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.delete_published_post(
  p_owner_id uuid,
  p_post_id uuid
)
returns boolean
language plpgsql security definer set search_path = pg_catalog, public
as $$
begin
  if p_owner_id is null or p_post_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.published_posts p where p.owner_id = p_owner_id and p.id = p_post_id
  ) then
    raise exception 'published_post_not_found' using errcode = 'P0002';
  end if;
  perform set_config('dif.retention_delete', 'on', true);
  delete from public.retention_experiments e
  where e.owner_id = p_owner_id
    and (e.variant_a_id in (select id from public.creative_variants where owner_id = p_owner_id and post_id = p_post_id)
      or e.variant_b_id in (select id from public.creative_variants where owner_id = p_owner_id and post_id = p_post_id));
  delete from public.analytics_snapshots s where s.owner_id = p_owner_id and s.post_id = p_post_id;
  delete from public.creative_variants v where v.owner_id = p_owner_id and v.post_id = p_post_id;
  delete from public.published_post_versions v where v.owner_id = p_owner_id and v.post_id = p_post_id;
  delete from public.published_posts p where p.owner_id = p_owner_id and p.id = p_post_id;
  perform set_config('dif.retention_delete', 'off', true);
  return true;
end;
$$;

revoke all on function public.save_published_post(uuid, uuid, uuid, text, text, timestamptz, text, text, text) from public, anon, authenticated;
revoke all on function public.save_creative_variant(uuid, uuid, text, text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_analytics_snapshot(uuid, uuid, timestamptz, timestamptz, timestamptz, text, text, bigint, bigint, bigint, bigint, bigint, integer, integer, numeric, text, uuid, uuid) from public, anon, authenticated;
revoke all on function public.save_retention_import(uuid, text, text, integer, integer, integer, integer) from public, anon, authenticated;
revoke all on function public.save_retention_experiment(uuid, uuid, text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.delete_published_post(uuid, uuid) from public, anon, authenticated;
revoke all on function public.reject_retention_history_mutation() from public, anon, authenticated;

grant execute on function public.save_published_post(uuid, uuid, uuid, text, text, timestamptz, text, text, text) to service_role;
grant execute on function public.save_creative_variant(uuid, uuid, text, text, uuid, uuid, uuid) to service_role;
grant execute on function public.save_analytics_snapshot(uuid, uuid, timestamptz, timestamptz, timestamptz, text, text, bigint, bigint, bigint, bigint, bigint, integer, integer, numeric, text, uuid, uuid) to service_role;
grant execute on function public.save_retention_import(uuid, text, text, integer, integer, integer, integer) to service_role;
grant execute on function public.save_retention_experiment(uuid, uuid, text, uuid, uuid, text) to service_role;
grant execute on function public.delete_published_post(uuid, uuid) to service_role;

comment on table public.analytics_snapshots is
  'Owner-only aggregate snapshots supplied manually or by CSV; never fetched from platforms.';
comment on function public.save_analytics_snapshot(uuid, uuid, timestamptz, timestamptz, timestamptz, text, text, bigint, bigint, bigint, bigint, bigint, integer, integer, numeric, text, uuid, uuid) is
  'Server-only idempotent snapshot append with explicit NULL metrics and a supersedes chain.';
