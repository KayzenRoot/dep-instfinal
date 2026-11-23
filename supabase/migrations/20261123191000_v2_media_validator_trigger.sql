-- The media validator must promote PENDING/VALIDATING narration takes. Keep the
-- table immutable for identity/content fields and for READY/REJECTED rows, while
-- allowing the service-role worker to write validation results.
create or replace function public.reject_narration_take_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'narration_takes_are_immutable' using errcode = '55000';
  end if;
  if old.status in ('PENDING', 'VALIDATING')
    and new.status in ('PENDING', 'VALIDATING', 'READY', 'REJECTED')
    and new.id = old.id
    and new.owner_id = old.owner_id
    and new.episode_id = old.episode_id
    and new.plan_version = old.plan_version
    and new.source = old.source
    and new.bucket = old.bucket
    and new.object_key = old.object_key
    and new.sha256 = old.sha256
    and new.byte_size = old.byte_size
    and new.created_at = old.created_at
  then
    return new;
  end if;
  raise exception 'narration_takes_are_immutable' using errcode = '55000';
end;
$$;

grant update on table public.narration_takes to service_role;

revoke all on function public.reject_narration_take_mutation()
  from public, anon, authenticated;

comment on function public.reject_narration_take_mutation() is
  'Allows service-role validation transitions for PENDING/VALIDATING takes; all identity fields and published rows stay immutable.';
