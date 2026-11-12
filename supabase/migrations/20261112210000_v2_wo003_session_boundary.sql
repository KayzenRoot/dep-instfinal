-- V2 WO-003: the upload session is server-owned state.
-- Before this migration an owner could PATCH quarantine_key and make the server
-- read/delete an arbitrary known R2 object. Sessions are now created and mutated
-- only by the server service role; owners keep SELECT for resume/list.
--
-- Additive migration: existing valid sessions with canonical keys are retained.

revoke insert, update, delete on table public.video_upload_sessions from authenticated;
drop policy if exists owner_insert on public.video_upload_sessions;
drop policy if exists owner_update on public.video_upload_sessions;
drop policy if exists owner_delete on public.video_upload_sessions;
grant select on table public.video_upload_sessions to authenticated;
grant select, insert, update, delete on table public.video_upload_sessions to service_role;

alter table public.video_upload_sessions
  add constraint video_upload_sessions_server_key_check
  check (quarantine_key = 'quarantine/' || owner_id::text || '/' || id::text || '/source');

create or replace function public.guard_video_upload_session_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.id <> old.id
    or new.owner_id <> old.owner_id
    or new.episode_id <> old.episode_id
    or new.scene_id <> old.scene_id
    or new.asset_id <> old.asset_id
    or new.idempotency_key <> old.idempotency_key
    or new.quarantine_key <> old.quarantine_key
    or new.part_size_bytes <> old.part_size_bytes
    or new.total_bytes <> old.total_bytes
    or new.file_sha256 is distinct from old.file_sha256
    or new.expires_at <> old.expires_at then
    raise exception 'video_upload_sessions identity fields are immutable'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_video_upload_session_update on public.video_upload_sessions;
create trigger guard_video_upload_session_update
  before update on public.video_upload_sessions
  for each row execute function public.guard_video_upload_session_update();

comment on function public.guard_video_upload_session_update() is
  'Prevents identity, key, size and hash fields from changing after session creation.';
comment on table public.video_upload_sessions is
  'Server-owned R2 multipart sessions. Owners can SELECT; only the service role writes. Video bytes never enter PostgreSQL.';
