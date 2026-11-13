-- V2 WO-007: private narration direction plans and voice takes.
-- Audio bytes live in R2; PostgreSQL stores metadata, direction and versions only.

create table public.voice_direction_plans (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  episode_id uuid not null,
  current_version integer not null check (current_version between 1 and 10000),
  current_status text not null default 'DRAFT' check (current_status in ('DRAFT', 'APPROVED')),
  plan jsonb not null check (jsonb_typeof(plan) = 'object'),
  versions jsonb not null default '[]'::jsonb check (jsonb_typeof(versions) = 'array'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, episode_id),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict
);

create table public.narration_takes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  episode_id uuid not null,
  plan_version integer not null check (plan_version between 1 and 10000),
  source text not null check (source in ('UPLOAD', 'TTS')),
  status text not null default 'READY' check (status in ('READY', 'REJECTED')),
  bucket text not null check (char_length(btrim(bucket)) between 1 and 63),
  object_key text not null check (
    char_length(btrim(object_key)) between 1 and 512
    and object_key !~ '^/'
    and object_key !~ '(^|/)\.\.(/|$)'
    and object_key !~ '\\'
  ),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  byte_size bigint not null check (byte_size between 1 and 52428800),
  duration_ms integer not null check (duration_ms between 1000 and 600000),
  format text not null check (char_length(btrim(format)) between 1 and 32),
  sample_rate integer not null check (sample_rate between 8000 and 192000),
  channels smallint not null check (channels between 1 and 2),
  peak_db numeric(6,2) check (peak_db between -120 and 0),
  rms_db numeric(6,2) check (rms_db between -120 and 0),
  model_id text,
  model_license text,
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (bucket, object_key),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict
);

create index narration_takes_by_episode
  on public.narration_takes (owner_id, episode_id, created_at desc);

alter table public.voice_direction_plans enable row level security;
alter table public.voice_direction_plans force row level security;
alter table public.narration_takes enable row level security;
alter table public.narration_takes force row level security;

revoke all on table public.voice_direction_plans from public, anon, authenticated;
revoke all on table public.narration_takes from public, anon, authenticated;
grant select on table public.voice_direction_plans to authenticated;
grant select on table public.narration_takes to authenticated;
grant select, insert, update, delete on table public.voice_direction_plans to service_role;
grant select, insert, update, delete on table public.narration_takes to service_role;

create policy owner_select on public.voice_direction_plans
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );
create policy owner_select on public.narration_takes
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );

create trigger set_voice_direction_plans_updated_at
  before update on public.voice_direction_plans
  for each row execute function public.set_updated_at();

comment on table public.voice_direction_plans is
  'Versioned narration direction metadata. Audio bytes live in private R2, never PostgreSQL.';
comment on table public.narration_takes is
  'Owner-readable narration takes with provenance, hash, duration and loudness metadata.';
