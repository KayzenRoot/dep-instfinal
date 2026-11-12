-- V2 WO-003: private video ingest metadata.
-- Binaries live in Cloudflare R2; PostgreSQL stores metadata, ownership and state only.
-- Additive migration: V1 tables and contracts are untouched.

create table public.video_upload_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  episode_id uuid not null,
  scene_id uuid not null,
  asset_id uuid not null default gen_random_uuid(),
  idempotency_key text not null check (
    char_length(btrim(idempotency_key)) between 8 and 128
    and idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  r2_upload_id text,
  quarantine_key text not null check (
    char_length(btrim(quarantine_key)) between 1 and 512
    and quarantine_key !~ '^/'
    and quarantine_key !~ '(^|/)\.\.(/|$)'
    and quarantine_key !~ '\\'
  ),
  part_size_bytes integer not null check (part_size_bytes between 5242880 and 67108864),
  total_bytes bigint not null check (total_bytes between 1 and 209715200),
  status text not null default 'CREATED' check (
    status in ('CREATED', 'UPLOADING', 'COMPLETED', 'ABORTED', 'EXPIRED')
  ),
  safe_error_code text,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, asset_id),
  unique (owner_id, idempotency_key),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict,
  foreign key (owner_id, episode_id, scene_id)
    references public.scenes (owner_id, episode_id, id) on delete restrict
);

create table public.video_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  episode_id uuid not null,
  scene_id uuid not null,
  asset_version integer not null default 1 check (asset_version between 1 and 100),
  storage_provider text not null default 'r2' check (storage_provider = 'r2'),
  bucket text not null check (char_length(btrim(bucket)) between 1 and 63),
  object_key text not null check (
    char_length(btrim(object_key)) between 1 and 512
    and object_key !~ '^/'
    and object_key !~ '(^|/)\.\.(/|$)'
    and object_key !~ '\\'
  ),
  poster_key text check (
    poster_key is null
    or (
      char_length(btrim(poster_key)) between 1 and 512
      and poster_key !~ '^/'
      and poster_key !~ '(^|/)\.\.(/|$)'
      and poster_key !~ '\\'
    )
  ),
  sha256 text check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint check (byte_size between 1 and 209715200),
  duration_ms integer check (duration_ms between 1000 and 15000),
  width integer check (width between 1 and 2160),
  height integer check (height between 1 and 3840),
  codec text check (codec is null or char_length(btrim(codec)) between 1 and 64),
  container text check (container is null or char_length(btrim(container)) between 1 and 32),
  status text not null default 'QUARANTINED' check (
    status in ('UPLOADING', 'QUARANTINED', 'VALIDATING', 'READY', 'REJECTED', 'DELETED')
  ),
  safe_error_code text,
  validated_at timestamptz,
  retention_until timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, episode_id, scene_id, asset_version),
  unique (bucket, object_key),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict,
  foreign key (owner_id, episode_id, scene_id)
    references public.scenes (owner_id, episode_id, id) on delete restrict,
  check (
    status <> 'READY'
    or (
      sha256 is not null and byte_size is not null and duration_ms is not null
      and width is not null and height is not null and codec is not null
      and container is not null and validated_at is not null
    )
  )
);

create index video_upload_sessions_by_owner_status
  on public.video_upload_sessions (owner_id, status, created_at desc);
create index video_upload_sessions_by_asset
  on public.video_upload_sessions (owner_id, asset_id);
create index video_assets_by_owner_status
  on public.video_assets (owner_id, status, created_at desc);
create index video_assets_by_episode_scene
  on public.video_assets (owner_id, episode_id, scene_id, asset_version desc);

alter table public.video_upload_sessions enable row level security;
alter table public.video_upload_sessions force row level security;
alter table public.video_assets enable row level security;
alter table public.video_assets force row level security;

revoke all on table public.video_upload_sessions from public, anon;
revoke all on table public.video_assets from public, anon;

create policy owner_select on public.video_upload_sessions
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );
create policy owner_insert on public.video_upload_sessions
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );
create policy owner_update on public.video_upload_sessions
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  )
  with check (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );
create policy owner_delete on public.video_upload_sessions
  for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );

create policy owner_select on public.video_assets
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );
create policy owner_insert on public.video_assets
  for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );
create policy owner_update on public.video_assets
  for update to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  )
  with check (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );
create policy owner_delete on public.video_assets
  for delete to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );

grant select, insert, update, delete on table public.video_upload_sessions to authenticated;
grant select, insert, update, delete on table public.video_assets to authenticated;

create trigger set_video_upload_sessions_updated_at
  before update on public.video_upload_sessions
  for each row execute function public.set_updated_at();
create trigger set_video_assets_updated_at
  before update on public.video_assets
  for each row execute function public.set_updated_at();

comment on table public.video_upload_sessions is
  'R2 multipart upload sessions. Keys are server-generated; no video bytes are stored in PostgreSQL.';
comment on table public.video_assets is
  'Private R2 video metadata only. Never store video bytes, signed URLs, R2 credentials or secrets.';
