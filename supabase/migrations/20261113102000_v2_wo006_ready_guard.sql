-- V2 WO-006: READY requires a real validated MP4 manifest, never a stub.
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
