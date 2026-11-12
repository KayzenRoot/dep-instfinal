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
  if not found then
    raise exception 'episode_previous_episode_missing' using errcode = '23514';
  end if;
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

comment on function public.assert_episode_publication_allowed(uuid)
is 'CD04 guard: a continuation requires its immediate predecessor and, when required, a closed verified latest poll result and an author-approved canonical decision for that exact result.';
