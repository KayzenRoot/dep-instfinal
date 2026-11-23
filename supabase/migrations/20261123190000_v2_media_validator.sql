-- Async media validation: workers claim quarantined video assets and pending
-- narration takes, probe them with ffprobe/ffmpeg outside the Vercel runtime and
-- publish READY/REJECTED transitions with a bounded retry count.
alter table public.narration_takes
  drop constraint if exists narration_takes_status_check;
alter table public.narration_takes
  add constraint narration_takes_status_check
  check (status in ('PENDING', 'VALIDATING', 'READY', 'REJECTED'));

alter table public.narration_takes
  add column if not exists safe_error_code text,
  add column if not exists validated_at timestamptz,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists validation_attempts integer not null default 0
    check (validation_attempts between 0 and 10);

alter table public.video_assets
  add column if not exists validation_attempts integer not null default 0
    check (validation_attempts between 0 and 10);

create index if not exists video_assets_validation_queue
  on public.video_assets (status, created_at)
  where status in ('QUARANTINED', 'VALIDATING');
create index if not exists narration_takes_validation_queue
  on public.narration_takes (status, created_at)
  where status in ('PENDING', 'VALIDATING');

create or replace function public.claim_video_asset_for_validation(
  p_stale_seconds integer default 600
)
returns setof public.video_assets
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidate as (
    select id
    from public.video_assets
    where validation_attempts < 10
      and (
        status = 'QUARANTINED'
        or (
          status = 'VALIDATING'
          and updated_at < now() - make_interval(secs => greatest(60, least(p_stale_seconds, 3600)))
        )
      )
    order by created_at
    for update skip locked
    limit 1
  )
  update public.video_assets v
  set status = 'VALIDATING',
      updated_at = now(),
      safe_error_code = null,
      validation_attempts = v.validation_attempts + 1
  from candidate c
  where v.id = c.id
  returning v.*;
end;
$$;

create or replace function public.claim_narration_take_for_validation(
  p_stale_seconds integer default 600
)
returns setof public.narration_takes
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with candidate as (
    select id
    from public.narration_takes
    where validation_attempts < 10
      and (
        status = 'PENDING'
        or (
          status = 'VALIDATING'
          and updated_at < now() - make_interval(secs => greatest(60, least(p_stale_seconds, 3600)))
        )
      )
    order by created_at
    for update skip locked
    limit 1
  )
  update public.narration_takes n
  set status = 'VALIDATING',
      updated_at = now(),
      safe_error_code = null,
      validation_attempts = n.validation_attempts + 1
  from candidate c
  where n.id = c.id
  returning n.*;
end;
$$;

revoke all on function public.claim_video_asset_for_validation(integer)
  from public, anon, authenticated;
revoke all on function public.claim_narration_take_for_validation(integer)
  from public, anon, authenticated;
grant execute on function public.claim_video_asset_for_validation(integer) to service_role;
grant execute on function public.claim_narration_take_for_validation(integer) to service_role;

comment on function public.claim_video_asset_for_validation(integer) is
  'Worker-only claim of one quarantined or stale video asset; increments validation_attempts.';
comment on function public.claim_narration_take_for_validation(integer) is
  'Worker-only claim of one pending or stale narration take; increments validation_attempts.';
