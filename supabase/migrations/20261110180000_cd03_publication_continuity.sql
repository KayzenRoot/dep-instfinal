-- CD03: enforce publication continuity in PostgreSQL and allow vote-free finales.

create or replace function public.sync_episode_finale_from_season()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_planned_episode_count smallint;
begin
  select s.planned_episode_count into v_planned_episode_count
  from public.seasons s
  where s.owner_id = new.owner_id and s.id = new.season_id;
  if not found then raise exception 'episode_season_not_found' using errcode = '23503'; end if;
  if new.episode_number > v_planned_episode_count then
    raise exception 'episode_number_exceeds_season_plan' using errcode = '23514';
  end if;
  new.is_season_finale := new.episode_number = v_planned_episode_count;
  return new;
end;
$$;

revoke all on function public.sync_episode_finale_from_season() from public, anon, authenticated;
create trigger sync_episode_finale_before_write
before insert or update of season_id, episode_number, is_season_finale on public.episodes
for each row execute function public.sync_episode_finale_from_season();

create or replace function public.assert_episode_publication_allowed(p_episode_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
set row_security = off
as $$
declare
  v_owner_id uuid := auth.uid();
  v_episode_number smallint;
  v_season_id uuid;
  v_previous_episode_id uuid;
  v_previous_requires_vote boolean;
  v_poll_id uuid;
  v_poll_status text;
  v_poll_closed_at timestamptz;
  v_latest_result_id uuid;
  v_result_status text;
  v_verified_at timestamptz;
  v_winner_option char(1);
  v_latest_decision_result_id uuid;
  v_latest_decision_episode_id uuid;
  v_latest_decision_accepted_by uuid;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;

  select e.season_id, e.episode_number into v_season_id, v_episode_number
  from public.episodes e
  where e.owner_id = v_owner_id and e.id = p_episode_id;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;
  if v_episode_number = 1 then return; end if;

  select e.id, e.episode_number < s.planned_episode_count
    into v_previous_episode_id, v_previous_requires_vote
  from public.episodes e
  join public.seasons s on s.owner_id = e.owner_id and s.id = e.season_id
  where e.owner_id = v_owner_id
    and e.season_id = v_season_id
    and e.episode_number = v_episode_number - 1;
  -- An incomplete season plan may have gaps. The gate applies when the prior
  -- episode exists and is therefore capable of requiring a vote.
  if not found then return; end if;
  if not v_previous_requires_vote then return; end if;

  select p.id, p.status, p.closed_at into v_poll_id, v_poll_status, v_poll_closed_at
  from public.polls p
  where p.owner_id = v_owner_id and p.episode_id = v_previous_episode_id
  for update;
  if not found then raise exception 'episode_previous_poll_missing' using errcode = '23514'; end if;
  if v_poll_status = 'OPEN' or v_poll_closed_at is null then
    raise exception 'episode_previous_vote_open' using errcode = '23514';
  end if;
  if v_poll_status = 'CANCELLED' then
    raise exception 'episode_previous_vote_not_verified' using errcode = '23514';
  end if;

  select r.id, r.verification_status, r.verified_at, r.winner_option
    into v_latest_result_id, v_result_status, v_verified_at, v_winner_option
  from public.poll_results r
  where r.owner_id = v_owner_id and r.poll_id = v_poll_id
  order by r.revision_number desc, r.created_at desc, r.id desc
  limit 1;
  if not found then raise exception 'episode_previous_result_missing' using errcode = '23514'; end if;
  if v_result_status <> 'VERIFIED' or v_verified_at is null or v_poll_status <> 'VERIFIED' then
    raise exception 'episode_previous_result_unverified' using errcode = '23514';
  end if;
  if v_winner_option not in ('1', '2') or v_winner_option is null then
    raise exception 'episode_previous_winner_invalid' using errcode = '23514';
  end if;

  select d.poll_result_id, d.episode_id, d.accepted_by
    into v_latest_decision_result_id, v_latest_decision_episode_id, v_latest_decision_accepted_by
  from public.canonical_decisions d
  where d.owner_id = v_owner_id and d.poll_id = v_poll_id
  order by d.revision_number desc, d.created_at desc, d.id desc
  limit 1;
  if not found then raise exception 'episode_previous_canon_pending' using errcode = '23514'; end if;
  if v_latest_decision_result_id is distinct from v_latest_result_id
    or v_latest_decision_episode_id is distinct from v_previous_episode_id
    or v_latest_decision_accepted_by is distinct from v_owner_id then
    raise exception 'episode_previous_canon_stale' using errcode = '23514';
  end if;
end;
$$;

revoke all on function public.assert_episode_publication_allowed(uuid) from public, anon;
grant execute on function public.assert_episode_publication_allowed(uuid) to authenticated;

create or replace function public.guard_episode_publication_transition()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.status = 'PUBLISHED' and tg_op = 'INSERT' then
    raise exception 'invalid_episode_status_transition' using errcode = '23514';
  end if;
  if new.status = 'PUBLISHED' and old.status is distinct from 'PUBLISHED' then
    if old.status <> 'READY' then
      raise exception 'invalid_episode_status_transition' using errcode = '23514';
    end if;
    perform public.assert_episode_publication_allowed(new.id);
  end if;
  return new;
end;
$$;

revoke all on function public.guard_episode_publication_transition() from public, anon, authenticated;
create trigger guard_episode_publication_before_insert
before insert on public.episodes
for each row execute function public.guard_episode_publication_transition();
create trigger guard_episode_publication_before_update
before update of status on public.episodes
for each row execute function public.guard_episode_publication_transition();

create or replace function public.assert_episode_ready()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid;
  v_episode_id uuid;
  v_status text;
  v_is_finale boolean;
  v_duration_ms integer;
  v_choice_count integer;
  v_scene record;
  v_scene_count integer := 0;
  v_expected_index integer := 1;
  v_cursor_ms integer := 0;
begin
  if tg_table_name = 'episodes' then
    if tg_op = 'DELETE' then v_owner_id := old.owner_id; v_episode_id := old.id;
    else v_owner_id := new.owner_id; v_episode_id := new.id; end if;
  else
    if tg_op = 'DELETE' then v_owner_id := old.owner_id; v_episode_id := old.episode_id;
    else v_owner_id := new.owner_id; v_episode_id := new.episode_id; end if;
  end if;

  select e.status, e.episode_number = s.planned_episode_count, e.duration_ms
    into v_status, v_is_finale, v_duration_ms
  from public.episodes e
  join public.seasons s on s.owner_id = e.owner_id and s.id = e.season_id
  where e.owner_id = v_owner_id and e.id = v_episode_id;
  if not found or v_status not in ('READY', 'PUBLISHED') then return null; end if;

  select count(*) into v_choice_count from public.choices c
  where c.owner_id = v_owner_id and c.episode_id = v_episode_id;
  if (not v_is_finale and v_choice_count <> 2) or (v_is_finale and v_choice_count not in (0, 2)) then
    raise exception 'episode_requires_two_distinct_choices_unless_finale' using errcode = '23514';
  end if;
  if v_choice_count = 2 and exists (
    select 1 from public.choices c1
    join public.choices c2 on c2.owner_id = c1.owner_id and c2.episode_id = c1.episode_id
      and c1.option_key = '1' and c2.option_key = '2'
    where c1.owner_id = v_owner_id and c1.episode_id = v_episode_id
      and (lower(btrim(c1.label)) = lower(btrim(c2.label))
        or lower(btrim(c1.consequence)) = lower(btrim(c2.consequence)))
  ) then
    raise exception 'episode_choices_must_differ' using errcode = '23514';
  end if;

  for v_scene in
    select s.scene_index, s.start_ms, s.end_ms from public.scenes s
    where s.owner_id = v_owner_id and s.episode_id = v_episode_id order by s.scene_index
  loop
    v_scene_count := v_scene_count + 1;
    if v_scene.scene_index <> v_expected_index or v_scene.start_ms <> v_cursor_ms then
      raise exception 'episode_scene_timeline_has_gap_overlap_or_order_error' using errcode = '23514';
    end if;
    v_expected_index := v_expected_index + 1;
    v_cursor_ms := v_scene.end_ms;
  end loop;
  if v_scene_count = 0 or v_cursor_ms <> v_duration_ms then
    raise exception 'episode_scene_timeline_must_cover_duration' using errcode = '23514';
  end if;
  return null;
end;
$$;

create or replace function public.validate_poll()
returns trigger language plpgsql set search_path = pg_catalog, public
as $$
declare
  v_episode_status text;
  v_is_finale boolean;
  v_choice_count integer;
begin
  if tg_op = 'UPDATE' and (
    new.tie_break_rule is distinct from old.tie_break_rule
    or new.tie_break_option is distinct from old.tie_break_option
    or new.opened_at is distinct from old.opened_at
    or new.closes_at is distinct from old.closes_at
  ) then raise exception 'poll_rules_are_immutable_after_creation' using errcode = '55000'; end if;

  select e.status, e.episode_number = s.planned_episode_count into v_episode_status, v_is_finale
  from public.episodes e
  join public.seasons s on s.owner_id = e.owner_id and s.id = e.season_id
  where e.owner_id = new.owner_id and e.id = new.episode_id;
  if v_is_finale then raise exception 'season_finale_does_not_require_a_poll' using errcode = '23514'; end if;
  if new.status = 'OPEN' and v_episode_status <> 'PUBLISHED' then
    raise exception 'poll_requires_published_episode' using errcode = '23514';
  end if;
  select count(*) into v_choice_count from public.choices c
  where c.owner_id = new.owner_id and c.episode_id = new.episode_id;
  if v_choice_count <> 2 then raise exception 'poll_requires_two_choices' using errcode = '23514'; end if;
  if new.status in ('CLOSED', 'VERIFIED') and new.closed_at is null then
    raise exception 'closed_poll_requires_closed_at' using errcode = '23514';
  end if;
  if new.status = 'OPEN' and new.closed_at is not null then
    raise exception 'open_poll_cannot_have_closed_at' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.set_episode_status(p_episode_id uuid, p_status text)
returns integer language plpgsql set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_old_status text;
  v_revision_number integer;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_status not in ('READY', 'PUBLISHED') then raise exception 'invalid_episode_status_transition' using errcode = '23514'; end if;
  select e.status into v_old_status from public.episodes e
  where e.owner_id = v_owner_id and e.id = p_episode_id for update;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;
  if (p_status = 'READY' and v_old_status <> 'DRAFT') or (p_status = 'PUBLISHED' and v_old_status <> 'READY') then
    raise exception 'invalid_episode_status_transition' using errcode = '23514';
  end if;
  if p_status = 'PUBLISHED' then perform public.assert_episode_publication_allowed(p_episode_id); end if;
  v_revision_number := public.append_episode_revision(p_episode_id, case when p_status = 'READY' then 'Revisão marcada como pronta' else 'Publicação manual autorizada pela autora' end);
  update public.episodes set status = p_status, published_at = case when p_status = 'PUBLISHED' then now() else null end
  where owner_id = v_owner_id and id = p_episode_id;
  return v_revision_number;
end;
$$;

create or replace function public.import_narrative_response(
  p_episode_id uuid,
  p_title text,
  p_logline text,
  p_hook text,
  p_narrative text,
  p_reveal text,
  p_cliffhanger text,
  p_narration_pt_br text,
  p_duration_ms integer,
  p_platform_metadata jsonb,
  p_option_1_label text,
  p_option_1_consequence text,
  p_option_2_label text,
  p_option_2_consequence text
)
returns integer
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_owner_id uuid := auth.uid();
  v_episode public.episodes;
  v_is_finale boolean;
  v_has_option_1 boolean;
  v_has_option_2 boolean;
  v_scene_count integer;
  v_scene integer;
begin
  if v_owner_id is null or (select auth.jwt() -> 'app_metadata' ->> 'dif_studio_owner') is distinct from 'true' then
    raise exception 'owner_auth_required' using errcode = '42501';
  end if;
  if p_duration_ms not between 90000 and 150000 then
    raise exception 'episode_duration_out_of_range' using errcode = '23514';
  end if;
  if jsonb_typeof(p_platform_metadata) <> 'object' then
    raise exception 'platform_metadata_must_be_object' using errcode = '23514';
  end if;

  select e.* into v_episode
  from public.episodes e
  where e.owner_id = v_owner_id and e.id = p_episode_id
  for update;
  if not found then raise exception 'episode_not_found' using errcode = 'P0002'; end if;
  if v_episode.status = 'PUBLISHED' then
    raise exception 'published_episode_is_immutable' using errcode = '55000';
  end if;
  select e.episode_number = s.planned_episode_count into v_is_finale
  from public.episodes e
  join public.seasons s on s.owner_id = e.owner_id and s.id = e.season_id
  where e.owner_id = v_owner_id and e.id = p_episode_id;

  if char_length(btrim(coalesce(p_title, ''))) not between 1 and 180
    or char_length(btrim(coalesce(p_logline, ''))) not between 1 and 1000
    or char_length(btrim(coalesce(p_hook, ''))) not between 1 and 2000
    or char_length(btrim(coalesce(p_narrative, ''))) not between 1 and 30000
    or char_length(btrim(coalesce(p_reveal, ''))) not between 1 and 2000
    or char_length(btrim(coalesce(p_cliffhanger, ''))) not between 1 and 2000
    or char_length(btrim(coalesce(p_narration_pt_br, ''))) not between 1 and 30000 then
    raise exception 'narrative_response_required_fields_invalid' using errcode = '23514';
  end if;

  v_has_option_1 := char_length(btrim(coalesce(p_option_1_label, ''))) > 0
    or char_length(btrim(coalesce(p_option_1_consequence, ''))) > 0;
  v_has_option_2 := char_length(btrim(coalesce(p_option_2_label, ''))) > 0
    or char_length(btrim(coalesce(p_option_2_consequence, ''))) > 0;
  if (not v_is_finale and (not v_has_option_1 or not v_has_option_2))
    or (v_has_option_1 <> v_has_option_2) then
    raise exception 'episode_requires_two_choices_unless_finale' using errcode = '23514';
  end if;
  if v_has_option_1 and (
    char_length(btrim(coalesce(p_option_1_label, ''))) not between 1 and 180
    or char_length(btrim(coalesce(p_option_2_label, ''))) not between 1 and 180
    or char_length(btrim(coalesce(p_option_1_consequence, ''))) not between 1 and 4000
    or char_length(btrim(coalesce(p_option_2_consequence, ''))) not between 1 and 4000
    or lower(btrim(p_option_1_label)) = lower(btrim(p_option_2_label))
    or lower(btrim(p_option_1_consequence)) = lower(btrim(p_option_2_consequence))
  ) then
    raise exception 'episode_choices_must_differ' using errcode = '23514';
  end if;

  update public.episodes set
    title = p_title,
    logline = p_logline,
    hook = p_hook,
    narrative = p_narrative,
    reveal = p_reveal,
    cliffhanger = p_cliffhanger,
    narration_pt_br = p_narration_pt_br,
    duration_ms = p_duration_ms,
    status = 'DRAFT',
    platform_metadata = p_platform_metadata
  where owner_id = v_owner_id and id = p_episode_id;

  v_scene_count := ceil(p_duration_ms::numeric / 8000)::integer;
  delete from public.scenes s
  where s.owner_id = v_owner_id and s.episode_id = p_episode_id and s.scene_index > v_scene_count;
  for v_scene in 1..v_scene_count loop
    update public.scenes set
      start_ms = (v_scene - 1) * 8000,
      end_ms = least(v_scene * 8000, p_duration_ms)
    where owner_id = v_owner_id and episode_id = p_episode_id and scene_index = v_scene;
    if not found then
      insert into public.scenes (owner_id, episode_id, scene_index, start_ms, end_ms)
      values (v_owner_id, p_episode_id, v_scene, (v_scene - 1) * 8000, least(v_scene * 8000, p_duration_ms));
    end if;
  end loop;

  if v_has_option_1 then
    insert into public.choices (owner_id, episode_id, option_key, label, consequence)
    values
      (v_owner_id, p_episode_id, '1', p_option_1_label, p_option_1_consequence),
      (v_owner_id, p_episode_id, '2', p_option_2_label, p_option_2_consequence)
    on conflict (owner_id, episode_id, option_key) do update
    set label = excluded.label, consequence = excluded.consequence;
  else
    delete from public.choices c
    where c.owner_id = v_owner_id and c.episode_id = p_episode_id;
  end if;

  return public.append_episode_revision(p_episode_id, 'Importação validada de roteiro e opções');
end;
$$;

revoke all on function public.import_narrative_response(uuid, text, text, text, text, text, text, text, integer, jsonb, text, text, text, text) from public, anon;
grant execute on function public.import_narrative_response(uuid, text, text, text, text, text, text, text, integer, jsonb, text, text, text, text) to authenticated;

comment on function public.assert_episode_publication_allowed(uuid)
is 'CD03 guard: a continuation requires a closed verified latest poll result and an author-approved canonical decision for that exact result.';
