-- V2 WO-008: editable caption tracks bound to an immutable edit-plan version.
-- Cues and timings are metadata only; audio/video bytes remain in private R2.

create table public.caption_tracks (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid(),
  episode_id uuid not null,
  edit_plan_id uuid not null,
  plan_version integer not null check (plan_version between 1 and 10000),
  narration_take_id uuid,
  current_version integer not null check (current_version between 1 and 10000),
  current_status text not null default 'DRAFT' check (current_status in ('DRAFT', 'APPROVED')),
  track jsonb not null check (jsonb_typeof(track) = 'object'),
  versions jsonb not null default '[]'::jsonb check (jsonb_typeof(versions) = 'array'),
  script_sha256 text check (script_sha256 is null or script_sha256 ~ '^[0-9a-f]{64}$'),
  audio_sha256 text check (audio_sha256 is null or audio_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, id),
  unique (owner_id, edit_plan_id, plan_version),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict,
  foreign key (owner_id, edit_plan_id, plan_version)
    references public.video_edit_plan_versions (owner_id, plan_id, version) on delete restrict,
  foreign key (owner_id, narration_take_id)
    references public.narration_takes (owner_id, id) on delete restrict
);

create index caption_tracks_by_episode
  on public.caption_tracks (owner_id, episode_id, updated_at desc);

alter table public.narration_takes
  add constraint narration_takes_owner_episode_id_key unique (owner_id, episode_id, id);

alter table public.caption_tracks
  add constraint caption_tracks_take_episode_fkey
  foreign key (owner_id, episode_id, narration_take_id)
  references public.narration_takes (owner_id, episode_id, id) on delete restrict;

alter table public.caption_tracks enable row level security;
alter table public.caption_tracks force row level security;

revoke all on table public.caption_tracks from public, anon, authenticated;
grant select on table public.caption_tracks to authenticated;
grant select, insert, update, delete on table public.caption_tracks to service_role;

create policy owner_select on public.caption_tracks
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );

create trigger set_caption_tracks_updated_at
  before update on public.caption_tracks
  for each row execute function public.set_updated_at();

create or replace function public.validate_caption_track_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (new.track ->> 'narrationTakeId') is null then
    if new.narration_take_id is not null then
      raise exception 'caption_take_mismatch' using errcode = '23514';
    end if;
  elsif new.narration_take_id is null
    or (new.track ->> 'narrationTakeId') <> new.narration_take_id::text then
    raise exception 'caption_take_mismatch' using errcode = '23514';
  end if;
  if new.narration_take_id is not null and not exists (
    select 1
    from public.narration_takes t
    where t.owner_id = new.owner_id
      and t.id = new.narration_take_id
      and t.episode_id = new.episode_id
  ) then
    raise exception 'caption_take_mismatch' using errcode = '23514';
  end if;
  if new.current_status <> 'APPROVED' then return new; end if;
  if jsonb_typeof(new.track -> 'cues') is distinct from 'array'
    or jsonb_array_length(new.track -> 'cues') = 0 then
    raise exception 'caption_cues_required' using errcode = '23514';
  end if;
  if coalesce(new.track ->> 'planVersion', '') <> new.plan_version::text then
    raise exception 'caption_plan_version_mismatch' using errcode = '23514';
  end if;
  if new.narration_take_id is null then
    raise exception 'caption_narration_required' using errcode = '23514';
  end if;
  if not exists (
    select 1
    from public.narration_takes t
    join public.voice_direction_plans v
      on v.owner_id = t.owner_id and v.episode_id = t.episode_id
    where t.owner_id = new.owner_id
      and t.id = new.narration_take_id
      and t.episode_id = new.episode_id
      and t.status = 'READY'
      and v.current_status = 'APPROVED'
      and v.plan ->> 'takeId' = new.narration_take_id::text
  ) then
    raise exception 'caption_voice_not_approved' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_caption_track_approval
  before insert or update of current_status, track, plan_version, narration_take_id, owner_id, episode_id
  on public.caption_tracks
  for each row execute function public.validate_caption_track_approval();

revoke all on function public.validate_caption_track_approval()
  from public, anon, authenticated;

comment on table public.caption_tracks is
  'Owner-readable, server-written caption cues aligned to a plan version and narration take.';
comment on function public.validate_caption_track_approval() is
  'Captions are bound to the exact plan version and narration take; approval requires an approved READY voice.';
