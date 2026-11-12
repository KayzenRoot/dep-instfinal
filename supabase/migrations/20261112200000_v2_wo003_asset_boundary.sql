-- V2 WO-003: asset writes are server-mediated.
-- The browser may create a quarantined draft row, but only the server-side
-- service role may mark an asset READY or tombstone it. This prevents an owner
-- token from bypassing R2 validation through the Supabase Data API.
--
-- Additive migration: existing rows and V1 contracts are untouched.

revoke update, delete on table public.video_assets from authenticated;
drop policy if exists owner_update on public.video_assets;
drop policy if exists owner_delete on public.video_assets;

grant select, insert, update, delete on table public.video_assets to service_role;

create or replace function public.guard_video_asset_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user = 'authenticated' and new.status <> 'QUARANTINED' then
    raise exception 'video_assets must be created in quarantine'
      using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_video_asset_insert on public.video_assets;
create trigger guard_video_asset_insert
  before insert on public.video_assets
  for each row execute function public.guard_video_asset_insert();

comment on function public.guard_video_asset_insert() is
  'Blocks direct owner inserts that would bypass quarantine; READY is written only by the server service role.';
comment on table public.video_assets is
  'Private R2 video metadata only. Owner inserts are quarantine-only; READY/tombstone writes use the server service role.';
