-- V2 WO-003: track confirmed multipart parts for resumable uploads.
alter table public.video_upload_sessions
  add column if not exists uploaded_parts jsonb not null default '[]'::jsonb;

alter table public.video_upload_sessions
  drop constraint if exists video_upload_sessions_uploaded_parts_check;

alter table public.video_upload_sessions
  add constraint video_upload_sessions_uploaded_parts_check
  check (jsonb_typeof(uploaded_parts) = 'array');

comment on column public.video_upload_sessions.uploaded_parts is
  'Confirmed R2 multipart parts: [{partNumber, etag}]. No binary data or signed URLs.';
