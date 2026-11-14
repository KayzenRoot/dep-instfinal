-- V2 WO-009: owner-scoped licensed audio library (SFX, music, ambience).
-- Audio bytes stay private in R2; PostgreSQL stores licence and mix metadata only.

create table public.audio_assets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  kind text not null check (kind in ('AMBIENCE', 'MUSIC', 'SFX')),
  title text not null check (char_length(btrim(title)) between 1 and 120),
  author text not null check (char_length(btrim(author)) between 1 and 120),
  source text not null check (char_length(btrim(source)) between 1 and 200),
  license_name text not null check (char_length(btrim(license_name)) between 1 and 120),
  license_url text check (license_url is null or char_length(license_url) <= 500),
  attribution text not null check (char_length(btrim(attribution)) between 1 and 300),
  commercial_allowed boolean not null default false,
  social_allowed boolean not null default false,
  license_status text not null default 'UNKNOWN'
    check (license_status in ('VERIFIED', 'UNKNOWN', 'BLOCKED')),
  tags text[] not null default '{}'
    check (coalesce(array_length(tags, 1), 0) between 1 and 12),
  intensity smallint not null default 3 check (intensity between 1 and 5),
  bucket text not null check (char_length(btrim(bucket)) between 1 and 63),
  object_key text not null check (
    char_length(btrim(object_key)) between 1 and 512
    and object_key !~ '^/'
    and object_key !~ '(^|/)\.\.(/|$)'
    and object_key !~ '\\'
  ),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size between 1 and 26214400),
  duration_ms integer not null check (duration_ms between 100 and 600000),
  format text not null check (char_length(btrim(format)) between 1 and 32),
  sample_rate integer not null check (sample_rate between 8000 and 192000),
  channels smallint not null check (channels between 1 and 2),
  peak_db numeric(6, 2) check (peak_db between -120 and 0),
  true_peak_db numeric(6, 2) check (true_peak_db between -120 and 0),
  lufs numeric(6, 2) check (lufs between -120 and 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, sha256),
  unique (bucket, object_key),
  constraint audio_verified_license_requires_rights check (
    license_status <> 'VERIFIED'
    or (
      commercial_allowed
      and social_allowed
      and char_length(btrim(license_name)) > 0
      and char_length(btrim(attribution)) > 0
      and char_length(btrim(source)) > 0
    )
  )
);

create index audio_assets_by_owner_kind
  on public.audio_assets (owner_id, kind, created_at desc);
create index audio_assets_tags
  on public.audio_assets using gin (tags);

alter table public.audio_assets enable row level security;
alter table public.audio_assets force row level security;

revoke all on table public.audio_assets from public, anon, authenticated;
grant select on table public.audio_assets to authenticated;
grant select, insert, update, delete on table public.audio_assets to service_role;

create policy owner_select on public.audio_assets
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );

create trigger set_audio_assets_updated_at
  before update on public.audio_assets
  for each row execute function public.set_updated_at();

comment on table public.audio_assets is
  'Owner-readable, server-written private audio library with licence provenance.';
