-- V2 WO-013: operational quotas and queue health.
-- Daily limits are conservative and independent from the free-tier estimate:
-- 20 render jobs and 2 GiB of READY output per owner per UTC day.

create or replace function public.enqueue_render_job(
  p_owner_id uuid,
  p_episode_id uuid,
  p_idempotency_key text,
  p_priority smallint default 50,
  p_narration_take_id uuid default null,
  p_output_profile text default '1080p',
  p_quality text default 'standard'
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_plan public.video_edit_plans;
  v_take public.narration_takes;
  v_existing public.render_jobs;
  v_active integer;
  v_queue integer;
  v_job_id uuid;
  v_day_jobs integer;
  v_day_bytes bigint;
begin
  if p_owner_id is null or p_episode_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_idempotency_key is null or char_length(btrim(p_idempotency_key)) not between 8 and 128 then
    raise exception 'render_idempotency_invalid' using errcode = '23514';
  end if;
  if p_output_profile is null or p_output_profile not in ('1080p', '720p') then
    raise exception 'render_output_profile_invalid' using errcode = '23514';
  end if;
  if p_quality is null or p_quality not in ('standard', 'high') then
    raise exception 'render_quality_invalid' using errcode = '23514';
  end if;
  select r.* into v_existing from public.render_jobs r
  where r.owner_id = p_owner_id and r.idempotency_key = p_idempotency_key;
  if found then return v_existing.id; end if;

  select p.* into v_plan from public.video_edit_plans p
  where p.owner_id = p_owner_id and p.episode_id = p_episode_id
  for update;
  if not found then raise exception 'edit_plan_not_found' using errcode = 'P0002'; end if;
  if v_plan.episode_id <> p_episode_id then
    raise exception 'edit_plan_episode_mismatch' using errcode = '23514';
  end if;
  if v_plan.current_status <> 'APPROVED' then
    raise exception 'edit_plan_not_approved' using errcode = '23514';
  end if;

  if p_narration_take_id is not null then
    select t.* into v_take from public.narration_takes t
    where t.owner_id = p_owner_id and t.id = p_narration_take_id;
    if not found then
      raise exception 'narration_take_not_found' using errcode = '23503';
    end if;
    if v_take.episode_id <> p_episode_id then
      raise exception 'narration_take_episode_mismatch' using errcode = '23514';
    end if;
    if v_take.status <> 'READY' then
      raise exception 'narration_take_not_ready' using errcode = '23514';
    end if;
  end if;

  select count(*), coalesce(sum(
    case
      when jsonb_typeof(r.output_manifest -> 'byteSize') = 'number'
        then (r.output_manifest ->> 'byteSize')::bigint
      else 0
    end
  ), 0)
  into v_day_jobs, v_day_bytes
  from public.render_jobs r
  where r.owner_id = p_owner_id
    and r.created_at >= date_trunc('day', now())
    and r.status <> 'CANCELED';
  if v_day_jobs >= 20 then
    raise exception 'render_daily_job_quota' using errcode = '23514';
  end if;
  if v_day_bytes >= 2_147_483_648 then
    raise exception 'render_daily_bytes_quota' using errcode = '23514';
  end if;

  select count(*) into v_active from public.render_jobs r
  where r.owner_id = p_owner_id and r.episode_id = p_episode_id
    and r.status in ('QUEUED', 'CLAIMED', 'RUNNING');
  if v_active >= 3 then
    raise exception 'render_episode_queue_full' using errcode = '23514';
  end if;
  select count(*) into v_queue from public.render_jobs r
  where r.status in ('QUEUED', 'CLAIMED', 'RUNNING');
  if v_queue >= 100 then
    raise exception 'render_queue_full' using errcode = '23514';
  end if;

  insert into public.render_jobs (
    owner_id, episode_id, plan_id, plan_version, narration_take_id, idempotency_key,
    priority, output_profile, quality
  ) values (
    p_owner_id, p_episode_id, v_plan.id, v_plan.current_version,
    p_narration_take_id, p_idempotency_key, coalesce(p_priority, 50),
    p_output_profile, p_quality
  ) returning id into v_job_id;
  insert into public.render_job_events (owner_id, job_id, event_type, metadata)
  values (
    p_owner_id, v_job_id, 'ENQUEUED',
    jsonb_build_object(
      'planVersion', v_plan.current_version,
      'narrationTakeId', p_narration_take_id,
      'outputProfile', p_output_profile,
      'quality', p_quality
    )
  );
  return v_job_id;
end;
$$;

create or replace function public.render_queue_health()
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  select jsonb_build_object(
    'queued', count(*) filter (where r.status = 'QUEUED'),
    'claimed', count(*) filter (where r.status = 'CLAIMED'),
    'running', count(*) filter (where r.status = 'RUNNING'),
    'ready', count(*) filter (where r.status = 'READY'),
    'failed', count(*) filter (where r.status = 'FAILED'),
    'oldestQueuedSeconds', coalesce(
      max(extract(epoch from now() - r.created_at)) filter (where r.status = 'QUEUED'),
      0
    )::integer,
    'activeWorker', max(r.lease_owner) filter (where r.status in ('CLAIMED', 'RUNNING')),
    'lastHeartbeatAt', max(r.heartbeat_at)
  )
  into v_result
  from public.render_jobs r;
  return v_result;
end;
$$;

revoke all on function public.enqueue_render_job(uuid, uuid, text, smallint, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.render_queue_health()
  from public, anon, authenticated;
grant execute on function public.enqueue_render_job(uuid, uuid, text, smallint, uuid, text, text)
  to service_role;
grant execute on function public.render_queue_health() to service_role;

comment on function public.enqueue_render_job(uuid, uuid, text, smallint, uuid, text, text) is
  'Server-mediated enqueue with plan/narration checks, per-episode queue caps and daily owner quotas (20 jobs / 2 GiB).';
comment on function public.render_queue_health() is
  'Service-only sanitized queue snapshot for worker health and owner dashboards; no media or secrets.';

-- Operations (backup/health) use the service role. Reads are explicit so a
-- missing legacy grant cannot silently break metadata exports.
grant select on table
  public.series,
  public.seasons,
  public.episodes,
  public.scenes,
  public.choices,
  public.polls,
  public.poll_results,
  public.canonical_decisions,
  public.video_upload_sessions,
  public.video_assets,
  public.video_edit_plans,
  public.video_edit_plan_versions,
  public.render_jobs,
  public.render_job_events,
  public.voice_direction_plans,
  public.narration_takes,
  public.caption_tracks,
  public.audio_assets,
  public.render_quality_reports
to service_role;
