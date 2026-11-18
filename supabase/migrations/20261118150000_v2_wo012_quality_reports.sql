-- V2 WO-012: export options and quality inspection reports.
-- Reports are owner-readable only. Writes come from the isolated worker or the
-- server-side acknowledgement RPC; owners cannot edit findings.

alter table public.render_jobs
  add column output_profile text not null default '1080p'
    check (output_profile in ('1080p', '720p')),
  add column quality text not null default 'standard'
    check (quality in ('standard', 'high'));

drop function if exists public.enqueue_render_job(uuid, uuid, text, smallint, uuid);

create function public.enqueue_render_job(
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

create table public.render_quality_reports (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  job_id uuid not null,
  episode_id uuid not null,
  plan_id uuid not null,
  plan_version integer not null check (plan_version between 1 and 10000),
  artifact_sha256 text not null check (artifact_sha256 ~ '^[0-9a-f]{64}$'),
  report_sha256 text not null check (report_sha256 ~ '^[0-9a-f]{64}$'),
  status text not null check (status in ('PASS', 'WARN', 'BLOCKED', 'NOT_TESTED')),
  report jsonb not null check (jsonb_typeof(report) = 'object'),
  acknowledged_at timestamptz,
  acknowledged_by uuid,
  acknowledgement_note text check (
    acknowledgement_note is null
    or char_length(btrim(acknowledgement_note)) between 8 and 1000
  ),
  created_at timestamptz not null default now(),
  unique (owner_id, job_id, artifact_sha256),
  unique (owner_id, report_sha256),
  foreign key (owner_id, job_id) references public.render_jobs (owner_id, id) on delete restrict,
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict,
  foreign key (owner_id, plan_id, plan_version)
    references public.video_edit_plan_versions (owner_id, plan_id, version) on delete restrict,
  check (
    (acknowledged_at is null and acknowledged_by is null and acknowledgement_note is null)
    or (
      acknowledged_at is not null
      and acknowledged_by = owner_id
      and acknowledgement_note is not null
    )
  )
);

create index render_quality_reports_by_owner
  on public.render_quality_reports (owner_id, created_at desc);
create index render_quality_reports_by_episode
  on public.render_quality_reports (owner_id, episode_id, created_at desc);

alter table public.render_quality_reports enable row level security;
alter table public.render_quality_reports force row level security;

revoke all on table public.render_quality_reports from public, anon, authenticated;
grant select on table public.render_quality_reports to authenticated;
grant select, insert, update, delete on table public.render_quality_reports to service_role;

create policy owner_select on public.render_quality_reports
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );

create or replace function public.guard_quality_report_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'quality_reports_are_immutable' using errcode = '55000';
  end if;
  if new.id <> old.id
    or new.owner_id <> old.owner_id
    or new.job_id <> old.job_id
    or new.episode_id <> old.episode_id
    or new.plan_id <> old.plan_id
    or new.plan_version <> old.plan_version
    or new.artifact_sha256 <> old.artifact_sha256
    or new.report_sha256 <> old.report_sha256
    or new.status <> old.status
    or new.report <> old.report
    or new.created_at <> old.created_at
  then
    raise exception 'quality_report_findings_are_immutable' using errcode = '55000';
  end if;
  if old.acknowledged_at is not null then
    raise exception 'quality_report_already_acknowledged' using errcode = '55000';
  end if;
  if old.status = 'BLOCKED' and new.acknowledged_at is not null then
    raise exception 'blocked_quality_report_cannot_be_acknowledged' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger guard_quality_report_mutation
  before update or delete on public.render_quality_reports
  for each row execute function public.guard_quality_report_mutation();

create or replace function public.acknowledge_render_quality_report(
  p_owner_id uuid,
  p_report_id uuid,
  p_note text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_report public.render_quality_reports;
begin
  if p_owner_id is null or p_report_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_note is null or char_length(btrim(p_note)) not between 8 and 1000 then
    raise exception 'quality_acknowledgement_invalid' using errcode = '23514';
  end if;
  select r.* into v_report from public.render_quality_reports r
  where r.id = p_report_id and r.owner_id = p_owner_id
  for update;
  if not found then raise exception 'quality_report_not_found' using errcode = 'P0002'; end if;
  if v_report.status <> 'WARN' then
    raise exception 'quality_report_not_acknowledgeable' using errcode = '23514';
  end if;
  if v_report.acknowledged_at is not null then
    raise exception 'quality_report_already_acknowledged' using errcode = '55000';
  end if;
  update public.render_quality_reports r
  set acknowledged_at = now(),
      acknowledged_by = p_owner_id,
      acknowledgement_note = btrim(p_note)
  where r.id = p_report_id;
end;
$$;

revoke all on function public.enqueue_render_job(uuid, uuid, text, smallint, uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.acknowledge_render_quality_report(uuid, uuid, text)
  from public, anon, authenticated;
revoke all on function public.guard_quality_report_mutation()
  from public, anon, authenticated;

grant execute on function public.enqueue_render_job(uuid, uuid, text, smallint, uuid, text, text)
  to service_role;
grant execute on function public.acknowledge_render_quality_report(uuid, uuid, text)
  to service_role;

comment on table public.render_quality_reports is
  'Owner-readable, immutable Quality Inspector report per render job and artifact hash.';
comment on column public.render_jobs.output_profile is
  'Requested output geometry: 1080p (1080x1920) or 720p fallback (720x1280).';
comment on column public.render_jobs.quality is
  'Encoder quality tier: standard (veryfast/CRF 23) or high (slow/CRF 18).';
comment on function public.acknowledge_render_quality_report(uuid, uuid, text) is
  'Owner acknowledges a WARN report with a justification; PASS needs none and BLOCKED cannot be acknowledged.';

-- The final geometry depends on the requested profile. When the manifest
-- carries a QA block, READY also requires a matching PASS/WARN report row.
create or replace function public.complete_render_job(
  p_job_id uuid,
  p_worker_id text,
  p_output_manifest jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.render_jobs;
  v_expected_width integer;
  v_expected_height integer;
  v_manifest_sha text;
begin
  if p_output_manifest is null or jsonb_typeof(p_output_manifest) <> 'object' then
    raise exception 'render_output_invalid' using errcode = '23514';
  end if;
  if p_output_manifest ? 'stub' then
    raise exception 'render_stub_not_allowed' using errcode = '23514';
  end if;
  select r.* into v_job from public.render_jobs r
  where r.id = p_job_id and r.lease_owner = p_worker_id and r.status = 'RUNNING'
  for update;
  if not found then raise exception 'render_job_not_running' using errcode = 'P0001'; end if;
  v_expected_width := case when v_job.output_profile = '720p' then 720 else 1080 end;
  v_expected_height := case when v_job.output_profile = '720p' then 1280 else 1920 end;
  v_manifest_sha := p_output_manifest ->> 'sha256';
  if coalesce(p_output_manifest ->> 'codec', '') <> 'h264'
    or coalesce((p_output_manifest ->> 'width')::integer, 0) <> v_expected_width
    or coalesce((p_output_manifest ->> 'height')::integer, 0) <> v_expected_height
    or coalesce((p_output_manifest ->> 'durationMs')::integer, 0) <= 0
    or coalesce(p_output_manifest ->> 'objectKey', '') = ''
    or coalesce(v_manifest_sha, '') !~ '^[0-9a-f]{64}$' then
    raise exception 'render_output_invalid' using errcode = '23514';
  end if;
  if p_output_manifest ? 'qa' then
    if coalesce(p_output_manifest -> 'qa' ->> 'status', '') not in ('PASS', 'WARN') then
      raise exception 'render_quality_invalid' using errcode = '23514';
    end if;
    if not exists (
      select 1 from public.render_quality_reports q
      where q.owner_id = v_job.owner_id
        and q.job_id = v_job.id
        and q.artifact_sha256 = v_manifest_sha
        and q.status in ('PASS', 'WARN')
    ) then
      raise exception 'render_quality_missing' using errcode = '23514';
    end if;
  end if;
  if v_job.narration_take_id is not null then
    if coalesce(p_output_manifest -> 'audio' ->> 'codec', '') <> 'aac'
      or coalesce((p_output_manifest -> 'audio' ->> 'channels')::integer, 0) <> 2
      or coalesce((p_output_manifest -> 'audio' ->> 'sampleRate')::integer, 0) <> 48000
      or coalesce((p_output_manifest -> 'audio' ->> 'durationMs')::integer, 0) <= 0
      or abs(
        coalesce((p_output_manifest -> 'audio' ->> 'durationMs')::integer, 0)
        - coalesce((p_output_manifest ->> 'durationMs')::integer, 0)
      ) > 1000
      or (p_output_manifest -> 'audio' ->> 'narrationTakeId') is distinct from v_job.narration_take_id::text then
      raise exception 'render_narration_missing' using errcode = '23514';
    end if;
  end if;
  update public.render_jobs r
  set status = 'READY',
      output_manifest = p_output_manifest,
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      finished_at = now()
  where r.id = p_job_id
    and r.lease_owner = p_worker_id
    and r.status = 'RUNNING'
    and r.lease_expires_at > now()
  returning * into v_job;
  if not found then raise exception 'render_job_not_running' using errcode = 'P0001'; end if;
  insert into public.render_job_events (owner_id, job_id, event_type, worker_id)
  values (v_job.owner_id, v_job.id, 'COMPLETED', p_worker_id);
end;
$$;

create or replace function public.fail_render_job(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.render_jobs;
  v_next_status text;
begin
  if p_error_code is null or p_error_code !~ '^[A-Z0-9_]{1,64}$' then
    raise exception 'render_error_code_invalid' using errcode = '23514';
  end if;
  select r.* into v_job from public.render_jobs r
  where r.id = p_job_id and r.lease_owner = p_worker_id
    and r.status in ('CLAIMED', 'RUNNING')
  for update;
  if not found then raise exception 'render_job_not_owned' using errcode = 'P0001'; end if;
  v_next_status := case
    when left(p_error_code, 3) = 'QA_' then 'FAILED'
    when v_job.attempts < v_job.max_attempts then 'QUEUED'
    else 'FAILED'
  end;
  update public.render_jobs r
  set status = v_next_status,
      error_code = p_error_code,
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      finished_at = case when v_next_status = 'FAILED' then now() else null end
  where r.id = v_job.id;
  insert into public.render_job_events (owner_id, job_id, event_type, worker_id, metadata)
  values (
    v_job.owner_id, v_job.id,
    case when v_next_status = 'QUEUED' then 'RETRY_QUEUED' else 'FAILED' end,
    p_worker_id, jsonb_build_object('errorCode', p_error_code, 'attempts', v_job.attempts)
  );
end;
$$;
