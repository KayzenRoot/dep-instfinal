-- V2 WO-015: Hook Lab variants are immutable draft patches over a plan version.
-- Applying a variant creates a new plan version; the source version is never edited.

create table public.hook_variants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  episode_id uuid not null,
  plan_id uuid not null,
  plan_version integer not null check (plan_version between 1 and 10000),
  variant_key text not null check (variant_key in ('cold_open', 'intriguing_line', 'sound_entry')),
  label text not null check (char_length(btrim(label)) between 3 and 80),
  objective text not null check (objective in ('MYSTERY', 'REVEAL', 'SOUND')),
  source_plan_hash text not null check (source_plan_hash ~ '^[0-9a-f]{64}$'),
  opening_clip_id uuid not null,
  opening_asset_id uuid not null,
  opening_scene_index integer not null check (opening_scene_index >= 0),
  opening_start_ms integer not null check (opening_start_ms >= 0),
  opening_end_ms integer not null check (opening_end_ms > opening_start_ms),
  premise text not null check (char_length(btrim(premise)) between 8 and 300),
  score integer not null check (score between 0 and 100),
  reasons jsonb not null check (jsonb_typeof(reasons) = 'array'),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPLIED')),
  applied_version integer check (applied_version is null or applied_version between 1 and 10000),
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (owner_id, episode_id, plan_id, plan_version, variant_key),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict,
  foreign key (owner_id, plan_id, plan_version)
    references public.video_edit_plan_versions (owner_id, plan_id, version) on delete restrict,
  check (
    (status = 'DRAFT' and applied_version is null and applied_at is null)
    or (status = 'APPLIED' and applied_version is not null and applied_at is not null)
  )
);

create index hook_variants_by_episode
  on public.hook_variants (owner_id, episode_id, created_at desc);

alter table public.hook_variants enable row level security;
alter table public.hook_variants force row level security;

revoke all on table public.hook_variants from public, anon, authenticated;
grant select on table public.hook_variants to authenticated;
grant select, insert, update, delete on table public.hook_variants to service_role;

create policy owner_select on public.hook_variants
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );

comment on table public.hook_variants is
  'Owner-readable Hook Lab variants; immutable patch metadata over a versioned edit plan. Applying creates a new plan version.';
comment on column public.hook_variants.reasons is
  'Transparent heuristic reasons; never a promise of virality or measured performance.';
