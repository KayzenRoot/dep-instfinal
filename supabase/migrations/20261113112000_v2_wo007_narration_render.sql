-- V2 WO-007: pin the selected narration take to a render job and require a
-- READY voice file before a narration direction plan can be approved.

-- A take may be uploaded before the first direction version is saved (version 0).
alter table public.narration_takes
  drop constraint narration_takes_plan_version_check;
alter table public.narration_takes
  add constraint narration_takes_plan_version_check
  check (plan_version between 0 and 10000);
alter table public.narration_takes
  add column true_peak_db numeric(6,2) check (true_peak_db between -120 and 0),
  add column lufs numeric(6,2) check (lufs between -70 and 0),
  add column model_sha256 text check (model_sha256 is null or model_sha256 ~ '^[0-9a-f]{64}$');

alter table public.render_jobs
  add column narration_take_id uuid;

alter table public.render_jobs
  add constraint render_jobs_narration_take_fk
  foreign key (owner_id, narration_take_id)
  references public.narration_takes (owner_id, id)
  on delete restrict;

create index render_jobs_by_narration_take
  on public.render_jobs (owner_id, narration_take_id)
  where narration_take_id is not null;

create or replace function public.validate_render_job_narration()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_take public.narration_takes;
begin
  if TG_OP = 'UPDATE' and old.narration_take_id is distinct from new.narration_take_id then
    raise exception 'render_narration_immutable' using errcode = '55000';
  end if;
  if new.narration_take_id is null then return new; end if;
  select t.* into v_take from public.narration_takes t
  where t.owner_id = new.owner_id and t.id = new.narration_take_id;
  if not found then
    raise exception 'narration_take_not_found' using errcode = '23503';
  end if;
  if v_take.episode_id <> new.episode_id then
    raise exception 'narration_take_episode_mismatch' using errcode = '23514';
  end if;
  if v_take.status <> 'READY' then
    raise exception 'narration_take_not_ready' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_render_job_narration
  before insert or update of narration_take_id, episode_id, owner_id on public.render_jobs
  for each row execute function public.validate_render_job_narration();

create or replace function public.validate_voice_plan_approval()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_take_id text := new.plan ->> 'takeId';
begin
  if new.current_status <> 'APPROVED' then return new; end if;
  if v_take_id is null or v_take_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'narration_take_required' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.narration_takes t
    where t.owner_id = new.owner_id
      and t.id = v_take_id::uuid
      and t.episode_id = new.episode_id
      and t.status = 'READY'
  ) then
    raise exception 'narration_take_not_ready' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger validate_voice_plan_approval
  before insert or update of current_status, plan, episode_id, owner_id
  on public.voice_direction_plans
  for each row execute function public.validate_voice_plan_approval();

create or replace function public.reject_narration_take_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'narration_takes_are_immutable' using errcode = '55000';
end;
$$;

create trigger reject_narration_take_mutation
  before update or delete on public.narration_takes
  for each row execute function public.reject_narration_take_mutation();

revoke update, delete on table public.narration_takes from service_role;
grant select, insert on table public.narration_takes to service_role;

revoke all on function public.reject_narration_take_mutation()
  from public, anon, authenticated;

drop function if exists public.enqueue_render_job(uuid, uuid, text, smallint);

create function public.enqueue_render_job(
  p_owner_id uuid,
  p_episode_id uuid,
  p_idempotency_key text,
  p_priority smallint default 50,
  p_narration_take_id uuid default null
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
    owner_id, episode_id, plan_id, plan_version, narration_take_id, idempotency_key, priority
  ) values (
    p_owner_id, p_episode_id, v_plan.id, v_plan.current_version,
    p_narration_take_id, p_idempotency_key, coalesce(p_priority, 50)
  ) returning id into v_job_id;
  insert into public.render_job_events (owner_id, job_id, event_type, metadata)
  values (
    p_owner_id,
    v_job_id,
    'ENQUEUED',
    jsonb_build_object(
      'planVersion', v_plan.current_version,
      'narrationTakeId', p_narration_take_id
    )
  );
  return v_job_id;
end;
$$;

revoke all on function public.enqueue_render_job(uuid, uuid, text, smallint, uuid)
  from public, anon, authenticated;
grant execute on function public.enqueue_render_job(uuid, uuid, text, smallint, uuid)
  to service_role;

revoke all on function public.validate_render_job_narration()
  from public, anon, authenticated;
revoke all on function public.validate_voice_plan_approval()
  from public, anon, authenticated;

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
begin
  if p_output_manifest is null or jsonb_typeof(p_output_manifest) <> 'object' then
    raise exception 'render_output_invalid' using errcode = '23514';
  end if;
  if p_output_manifest ? 'stub' then
    raise exception 'render_stub_not_allowed' using errcode = '23514';
  end if;
  if coalesce(p_output_manifest ->> 'codec', '') <> 'h264'
    or coalesce((p_output_manifest ->> 'width')::integer, 0) <> 1080
    or coalesce((p_output_manifest ->> 'height')::integer, 0) <> 1920
    or coalesce((p_output_manifest ->> 'durationMs')::integer, 0) <= 0
    or coalesce(p_output_manifest ->> 'objectKey', '') = ''
    or coalesce(p_output_manifest ->> 'sha256', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'render_output_invalid' using errcode = '23514';
  end if;
  select r.* into v_job from public.render_jobs r
  where r.id = p_job_id and r.lease_owner = p_worker_id and r.status = 'RUNNING'
  for update;
  if not found then raise exception 'render_job_not_running' using errcode = 'P0001'; end if;
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

revoke all on function public.complete_render_job(uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.complete_render_job(uuid, text, jsonb) to service_role;

comment on column public.render_jobs.narration_take_id is
  'Immutable narration take pinned at enqueue; READY requires an AAC audio manifest for it.';
comment on function public.validate_voice_plan_approval() is
  'APPROVED direction always references a READY take from the same episode.';
