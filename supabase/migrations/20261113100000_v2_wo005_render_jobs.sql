-- V2 WO-005: persistent render-job queue with leases and recovery.
-- Jobs are metadata only. The worker is server-side and uses the service role;
-- owners can only read their jobs/events. No public worker endpoint exists.

create table public.render_jobs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  episode_id uuid not null,
  plan_id uuid not null,
  plan_version integer not null check (plan_version between 1 and 10000),
  idempotency_key text not null check (
    char_length(btrim(idempotency_key)) between 8 and 128
    and idempotency_key ~ '^[A-Za-z0-9._:-]+$'
  ),
  status text not null default 'QUEUED' check (
    status in ('QUEUED', 'CLAIMED', 'RUNNING', 'READY', 'FAILED', 'CANCELED')
  ),
  priority smallint not null default 50 check (priority between 0 and 100),
  attempts integer not null default 0 check (attempts between 0 and 10),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  lease_owner text check (lease_owner is null or char_length(lease_owner) between 1 and 80),
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  output_manifest jsonb check (output_manifest is null or jsonb_typeof(output_manifest) = 'object'),
  error_code text check (error_code is null or error_code ~ '^[A-Z0-9_]{1,64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (owner_id, id),
  unique (owner_id, idempotency_key),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict,
  foreign key (owner_id, plan_id, plan_version)
    references public.video_edit_plan_versions (owner_id, plan_id, version) on delete restrict,
  check (
    (status in ('CLAIMED', 'RUNNING') and lease_owner is not null and lease_expires_at is not null)
    or (status not in ('CLAIMED', 'RUNNING') and lease_owner is null and lease_expires_at is null)
  ),
  check (status not in ('READY', 'FAILED', 'CANCELED') or finished_at is not null)
);

create table public.render_job_events (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  job_id uuid not null,
  event_type text not null check (
    event_type in (
      'ENQUEUED', 'CLAIMED', 'STARTED', 'HEARTBEAT', 'COMPLETED',
      'FAILED', 'RETRY_QUEUED', 'CANCELED', 'LEASE_EXPIRED'
    )
  ),
  worker_id text check (worker_id is null or char_length(worker_id) between 1 and 80),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz not null default now(),
  unique (owner_id, id),
  foreign key (owner_id, job_id) references public.render_jobs (owner_id, id) on delete restrict
);

create index render_jobs_queue
  on public.render_jobs (status, priority desc, created_at)
  where status = 'QUEUED';
create index render_jobs_by_owner
  on public.render_jobs (owner_id, created_at desc);
create index render_jobs_by_episode
  on public.render_jobs (owner_id, episode_id, created_at desc);
create unique index render_jobs_single_active_worker
  on public.render_jobs ((1))
  where status in ('CLAIMED', 'RUNNING');
create index render_job_events_by_job
  on public.render_job_events (owner_id, job_id, created_at);

alter table public.render_jobs enable row level security;
alter table public.render_jobs force row level security;
alter table public.render_job_events enable row level security;
alter table public.render_job_events force row level security;

revoke all on table public.render_jobs from public, anon, authenticated;
revoke all on table public.render_job_events from public, anon, authenticated;
grant select on table public.render_jobs to authenticated;
grant select on table public.render_job_events to authenticated;
grant select, insert, update, delete on table public.render_jobs to service_role;
grant select, insert on table public.render_job_events to service_role;

create policy owner_select on public.render_jobs
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );
create policy owner_select on public.render_job_events
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );

create trigger set_render_jobs_updated_at
  before update on public.render_jobs
  for each row execute function public.set_updated_at();

create or replace function public.reject_render_job_event_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'render_job_events_are_immutable' using errcode = '55000';
end;
$$;

create trigger reject_render_job_event_mutation
  before update or delete on public.render_job_events
  for each row execute function public.reject_render_job_event_mutation();

create or replace function public.enqueue_render_job(
  p_owner_id uuid,
  p_episode_id uuid,
  p_idempotency_key text,
  p_priority smallint default 50
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_plan public.video_edit_plans;
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
    owner_id, episode_id, plan_id, plan_version, idempotency_key, priority
  ) values (
    p_owner_id, p_episode_id, v_plan.id, v_plan.current_version,
    p_idempotency_key, coalesce(p_priority, 50)
  ) returning id into v_job_id;
  insert into public.render_job_events (owner_id, job_id, event_type, metadata)
  values (p_owner_id, v_job_id, 'ENQUEUED', jsonb_build_object('planVersion', v_plan.current_version));
  return v_job_id;
end;
$$;

create or replace function public.claim_render_job(
  p_worker_id text,
  p_lease_seconds integer default 60
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.render_jobs;
begin
  if p_worker_id is null or char_length(btrim(p_worker_id)) not between 1 and 80 then
    raise exception 'render_worker_invalid' using errcode = '23514';
  end if;
  if p_lease_seconds is null or p_lease_seconds not between 15 and 600 then
    raise exception 'render_lease_invalid' using errcode = '23514';
  end if;
  perform pg_advisory_xact_lock(hashtext('dif_render_queue'));
  if exists (select 1 from public.render_jobs r where r.status in ('CLAIMED', 'RUNNING')) then
    return null;
  end if;
  select r.* into v_job from public.render_jobs r
  where r.status = 'QUEUED'
  order by r.priority desc, r.created_at
  for update skip locked
  limit 1;
  if not found then return null; end if;
  update public.render_jobs r
  set status = 'CLAIMED',
      attempts = r.attempts + 1,
      lease_owner = p_worker_id,
      lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now(),
      started_at = coalesce(r.started_at, now()),
      error_code = null
  where r.id = v_job.id
  returning * into v_job;
  insert into public.render_job_events (owner_id, job_id, event_type, worker_id)
  values (v_job.owner_id, v_job.id, 'CLAIMED', p_worker_id);
  return to_jsonb(v_job);
end;
$$;

create or replace function public.start_render_job(p_job_id uuid, p_worker_id text)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.render_jobs;
begin
  update public.render_jobs r
  set status = 'RUNNING'
  where r.id = p_job_id and r.status = 'CLAIMED' and r.lease_owner = p_worker_id
  returning * into v_job;
  if not found then raise exception 'render_job_not_claimed' using errcode = 'P0001'; end if;
  insert into public.render_job_events (owner_id, job_id, event_type, worker_id)
  values (v_job.owner_id, v_job.id, 'STARTED', p_worker_id);
end;
$$;

create or replace function public.heartbeat_render_job(
  p_job_id uuid,
  p_worker_id text,
  p_lease_seconds integer default 60
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if p_lease_seconds is null or p_lease_seconds not between 15 and 600 then
    raise exception 'render_lease_invalid' using errcode = '23514';
  end if;
  update public.render_jobs r
  set lease_expires_at = now() + make_interval(secs => p_lease_seconds),
      heartbeat_at = now()
  where r.id = p_job_id
    and r.lease_owner = p_worker_id
    and r.status in ('CLAIMED', 'RUNNING')
    and r.lease_expires_at > now();
  if not found then raise exception 'render_lease_lost' using errcode = 'P0001'; end if;
end;
$$;

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
  v_next_status := case when v_job.attempts < v_job.max_attempts then 'QUEUED' else 'FAILED' end;
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

create or replace function public.cancel_render_job(p_owner_id uuid, p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.render_jobs;
begin
  update public.render_jobs r
  set status = 'CANCELED',
      lease_owner = null,
      lease_expires_at = null,
      heartbeat_at = null,
      finished_at = now()
  where r.id = p_job_id and r.owner_id = p_owner_id
    and r.status in ('QUEUED', 'CLAIMED', 'RUNNING')
  returning * into v_job;
  if not found then return false; end if;
  insert into public.render_job_events (owner_id, job_id, event_type)
  values (v_job.owner_id, v_job.id, 'CANCELED');
  return true;
end;
$$;

create or replace function public.reconcile_render_jobs()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_job public.render_jobs;
  v_count integer := 0;
  v_next_status text;
begin
  for v_job in
    select r.* from public.render_jobs r
    where r.status in ('CLAIMED', 'RUNNING')
      and r.lease_expires_at < now()
    for update skip locked
  loop
    v_next_status := case when v_job.attempts < v_job.max_attempts then 'QUEUED' else 'FAILED' end;
    update public.render_jobs r
    set status = v_next_status,
        lease_owner = null,
        lease_expires_at = null,
        heartbeat_at = null,
        error_code = 'WORKER_LEASE_EXPIRED',
        finished_at = case when v_next_status = 'FAILED' then now() else null end
    where r.id = v_job.id;
    insert into public.render_job_events (owner_id, job_id, event_type, worker_id, metadata)
    values (
      v_job.owner_id, v_job.id,
      case when v_next_status = 'QUEUED' then 'LEASE_EXPIRED' else 'FAILED' end,
      v_job.lease_owner,
      jsonb_build_object('previousStatus', v_job.status, 'attempts', v_job.attempts)
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

revoke all on function public.enqueue_render_job(uuid, uuid, text, smallint)
  from public, anon, authenticated;
revoke all on function public.claim_render_job(text, integer)
  from public, anon, authenticated;
revoke all on function public.start_render_job(uuid, text)
  from public, anon, authenticated;
revoke all on function public.heartbeat_render_job(uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_render_job(uuid, text, jsonb)
  from public, anon, authenticated;
revoke all on function public.fail_render_job(uuid, text, text)
  from public, anon, authenticated;
revoke all on function public.cancel_render_job(uuid, uuid)
  from public, anon, authenticated;
revoke all on function public.reconcile_render_jobs()
  from public, anon, authenticated;
grant execute on function public.enqueue_render_job(uuid, uuid, text, smallint) to service_role;
grant execute on function public.claim_render_job(text, integer) to service_role;
grant execute on function public.start_render_job(uuid, text) to service_role;
grant execute on function public.heartbeat_render_job(uuid, text, integer) to service_role;
grant execute on function public.complete_render_job(uuid, text, jsonb) to service_role;
grant execute on function public.fail_render_job(uuid, text, text) to service_role;
grant execute on function public.cancel_render_job(uuid, uuid) to service_role;
grant execute on function public.reconcile_render_jobs() to service_role;

revoke all on function public.reject_render_job_event_mutation()
  from public, anon, authenticated;

comment on table public.render_jobs is
  'Owner-readable, worker-owned render queue. No video bytes or secrets are stored here.';
comment on table public.render_job_events is
  'Immutable sanitized audit trail for render job transitions.';
comment on function public.claim_render_job(text, integer) is
  'Atomically claims one QUEUED job with a global single-worker lease.';
comment on function public.reconcile_render_jobs() is
  'Requeues or fails expired leases after worker restart; safe to call repeatedly.';
