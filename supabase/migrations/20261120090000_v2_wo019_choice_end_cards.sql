-- V2 WO-019: versioned two-choice end cards (CTA A/B) tied to the current
-- episode choices. Only the configuration and the approved choice snapshot are
-- stored; the ASS overlay and SFX are rendered on demand by the worker.

create table public.choice_end_cards (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  episode_id uuid not null,
  revision_number integer not null check (revision_number between 1 and 10000),
  choice_revision_number integer not null check (choice_revision_number >= 1),
  choices_snapshot jsonb not null check (
    jsonb_typeof(choices_snapshot) = 'array' and jsonb_array_length(choices_snapshot) = 2
  ),
  config jsonb not null check (jsonb_typeof(config) = 'object'),
  config_hash text not null check (config_hash ~ '^[0-9a-f]{64}$'),
  hash_version integer not null default 1 check (hash_version = 1),
  status text not null default 'DRAFT' check (status in ('DRAFT', 'APPROVED')),
  created_at timestamptz not null default now(),
  unique (owner_id, episode_id, revision_number),
  unique (owner_id, id),
  foreign key (owner_id, episode_id) references public.episodes (owner_id, id) on delete restrict
);

create index choice_end_cards_by_episode
  on public.choice_end_cards (owner_id, episode_id, revision_number desc);

alter table public.choice_end_cards enable row level security;
alter table public.choice_end_cards force row level security;

revoke all on table public.choice_end_cards from public, anon, authenticated;
grant select on table public.choice_end_cards to authenticated;
grant select, insert, update, delete on table public.choice_end_cards to service_role;

create policy owner_select on public.choice_end_cards
  for select to authenticated
  using (
    owner_id = (select auth.uid())
    and (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') = 'true'
  );

create or replace function public.reject_choice_end_card_mutation()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if current_setting('dif.end_card_prune', true) = 'on' and tg_op = 'DELETE' then
    return old;
  end if;
  raise exception 'choice_end_card_is_immutable' using errcode = '55000';
end;
$$;

create trigger choice_end_card_immutable
  before update or delete on public.choice_end_cards
  for each row execute function public.reject_choice_end_card_mutation();

create or replace function public.enforce_choice_end_card_quota()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'DRAFT' and (select count(*) from public.choice_end_cards
      where owner_id = new.owner_id and episode_id = new.episode_id
        and status = 'DRAFT') >= 200 then
    raise exception 'choice_end_card_quota' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger choice_end_card_quota
  before insert on public.choice_end_cards
  for each row execute function public.enforce_choice_end_card_quota();

create or replace function public.save_choice_end_card(
  p_owner_id uuid,
  p_episode_id uuid,
  p_expected_revision integer,
  p_choices_snapshot jsonb,
  p_config jsonb,
  p_config_hash text,
  p_status text default 'DRAFT'
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_episode public.episodes;
  v_latest integer;
  v_revision integer;
  v_choice_revision integer;
  v_choices jsonb;
begin
  if p_owner_id is null or p_episode_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_expected_revision is null or p_expected_revision < 0 then
    raise exception 'end_card_expected_revision_invalid' using errcode = '23514';
  end if;
  if p_config_hash is null or p_config_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'end_card_config_hash_invalid' using errcode = '23514';
  end if;
  if p_status not in ('DRAFT', 'APPROVED') then
    raise exception 'end_card_status_invalid' using errcode = '23514';
  end if;
  if jsonb_typeof(p_config) is distinct from 'object'
    or p_config ->> 'schemaVersion' is distinct from '1'
    or p_config ->> 'templateId' not in ('doors', 'stamped', 'signal', 'cctv', 'split', 'analog')
    or p_config ->> 'layout' not in ('split', 'stacked')
    or p_config ->> 'reveal' not in ('instant', 'progressive')
    or p_config ->> 'sfx' not in ('none', 'beep', 'rumble', 'pulse')
    or p_config ->> 'narration' not in ('mute', 'keep')
    or (p_config ->> 'durationMs')::integer not between 3000 and 12000
    or char_length(btrim(coalesce(p_config ->> 'prompt', ''))) not between 1 and 80
    or char_length(btrim(coalesce(p_config ->> 'footer', ''))) not between 1 and 80 then
    raise exception 'end_card_config_invalid' using errcode = '23514';
  end if;

  select e.* into v_episode
  from public.episodes e
  where e.owner_id = p_owner_id and e.id = p_episode_id;
  if not found then
    raise exception 'episode_not_found' using errcode = 'P0002';
  end if;
  if v_episode.status = 'PUBLISHED' then
    raise exception 'end_card_episode_published' using errcode = '55000';
  end if;

  select jsonb_agg(
      jsonb_build_object(
        'id', c.id, 'optionKey', c.option_key,
        'label', c.label, 'consequence', c.consequence
      )
      order by c.option_key
    )
    into v_choices
  from public.choices c
  where c.owner_id = p_owner_id and c.episode_id = p_episode_id;
  if v_choices is null or jsonb_array_length(v_choices) <> 2 then
    raise exception 'end_card_requires_two_choices' using errcode = '23514';
  end if;
  if jsonb_typeof(p_choices_snapshot) is distinct from 'array'
    or jsonb_array_length(p_choices_snapshot) <> 2 then
    raise exception 'end_card_choices_snapshot_invalid' using errcode = '23514';
  end if;
  if v_choices is distinct from p_choices_snapshot then
    raise exception 'end_card_choice_snapshot_conflict' using errcode = '40001';
  end if;

  select coalesce(max(r.revision_number), 1)
    into v_choice_revision
  from public.episode_revisions r
  where r.owner_id = p_owner_id and r.episode_id = p_episode_id;

  select coalesce(max(r.revision_number), 0)
    into v_latest
  from public.choice_end_cards r
  where r.owner_id = p_owner_id and r.episode_id = p_episode_id;
  if v_latest <> p_expected_revision then
    raise exception 'end_card_revision_conflict' using errcode = '40001';
  end if;

  v_revision := v_latest + 1;
  insert into public.choice_end_cards (
    owner_id, episode_id, revision_number, choice_revision_number,
    choices_snapshot, config, config_hash, hash_version, status
  ) values (
    p_owner_id, p_episode_id, v_revision, v_choice_revision,
    p_choices_snapshot, p_config, p_config_hash, 1, p_status
  );
  return v_revision;
end;
$$;

revoke all on function public.save_choice_end_card(uuid, uuid, integer, jsonb, jsonb, text, text)
  from public, anon, authenticated;
grant execute on function public.save_choice_end_card(uuid, uuid, integer, jsonb, jsonb, text, text)
  to service_role;

create or replace function public.prune_choice_end_cards(
  p_owner_id uuid,
  p_episode_id uuid,
  p_keep integer default 50
)
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_deleted integer;
begin
  if p_owner_id is null or p_episode_id is null then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_keep is null or p_keep < 1 or p_keep > 200 then
    raise exception 'end_card_retention_invalid' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.episodes e
    where e.owner_id = p_owner_id and e.id = p_episode_id
  ) then
    raise exception 'episode_not_found' using errcode = 'P0002';
  end if;
  perform set_config('dif.end_card_prune', 'on', true);
  with ranked as (
    select r.id,
      row_number() over (order by r.revision_number desc) as position
    from public.choice_end_cards r
    where r.owner_id = p_owner_id and r.episode_id = p_episode_id
  )
  delete from public.choice_end_cards r
  using ranked d
  where r.id = d.id
    and r.status <> 'APPROVED'
    and d.position > p_keep;
  get diagnostics v_deleted = row_count;
  perform set_config('dif.end_card_prune', 'off', true);
  return v_deleted;
end;
$$;

revoke all on function public.prune_choice_end_cards(uuid, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.prune_choice_end_cards(uuid, uuid, integer)
  to service_role;

revoke all on function public.reject_choice_end_card_mutation() from public, anon, authenticated;
revoke all on function public.enforce_choice_end_card_quota() from public, anon, authenticated;

comment on table public.choice_end_cards is
  'Owner-readable, immutable two-choice end-card configurations tied to the current choice snapshot.';
comment on function public.save_choice_end_card(uuid, uuid, integer, jsonb, text, text) is
  'Server-only append of an end-card revision with optimistic concurrency and a two-choice gate.';
