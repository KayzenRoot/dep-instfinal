-- V2 WO-003: bind an upload session to the exact client file hash.
-- The server still computes the authoritative SHA-256 from R2 before READY.
alter table public.video_upload_sessions
  add column if not exists file_sha256 text;

alter table public.video_upload_sessions
  drop constraint if exists video_upload_sessions_file_sha256_check;

alter table public.video_upload_sessions
  add constraint video_upload_sessions_file_sha256_check
  check (file_sha256 is null or file_sha256 ~ '^[0-9a-f]{64}$');

comment on column public.video_upload_sessions.file_sha256 is
  'Client-computed SHA-256 of the exact file; catches same-size different-file resume.';
