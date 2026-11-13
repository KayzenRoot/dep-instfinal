-- Run only on the disposable local Supabase database with `supabase test db`.
-- The test uses synthetic JWT subjects and rolls back every inserted row.
create extension if not exists pgtap with schema extensions;
begin;
select plan(103);

do $$
declare
  v_table text;
  v_tables text[] := array[
    'series', 'seasons', 'characters', 'lore_facts', 'episodes', 'episode_revisions',
    'media_assets', 'scenes', 'choices', 'polls', 'poll_results', 'canonical_decisions',
    'image_references', 'generation_jobs', 'video_upload_sessions', 'video_assets',
    'video_edit_plans', 'video_edit_plan_versions',
    'render_jobs', 'render_job_events',
    'voice_direction_plans', 'narration_takes'
  ];
  v_rls boolean;
  v_policy_count integer;
  v_unguarded_policy_count integer;
begin
  foreach v_table in array v_tables loop
    select c.relrowsecurity into v_rls
    from pg_catalog.pg_class c
    join pg_catalog.pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = v_table;
    if coalesce(v_rls, false) is not true then
      raise exception 'RLS is disabled for public.%', v_table;
    end if;
    select count(*) into v_policy_count from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = v_table
      and p.policyname in ('owner_select', 'owner_insert', 'owner_update', 'owner_delete');
    select count(*) into v_unguarded_policy_count from pg_catalog.pg_policies p
    where p.schemaname = 'public' and p.tablename = v_table
      and p.policyname in ('owner_select', 'owner_insert', 'owner_update', 'owner_delete')
      and (coalesce(p.qual, '') || coalesce(p.with_check, '')) not ilike '%dif_studio_owner%';
    if v_unguarded_policy_count <> 0 then
      raise exception 'owner claim missing from RLS policy on public.%', v_table;
    end if;
    if v_table in ('episode_revisions', 'poll_results', 'canonical_decisions') then
      if v_policy_count <> 2 then raise exception 'append-only policies missing for public.%', v_table; end if;
      if has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
        or has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') then
        raise exception 'append-only table grants mutation privilege: public.%', v_table;
      end if;
    elsif v_table = 'video_upload_sessions' then
      if v_policy_count <> 1 then raise exception 'video_upload_sessions policies must be server-write-only'; end if;
      if has_table_privilege('authenticated', 'public.video_upload_sessions', 'INSERT')
        or has_table_privilege('authenticated', 'public.video_upload_sessions', 'UPDATE')
        or has_table_privilege('authenticated', 'public.video_upload_sessions', 'DELETE') then
        raise exception 'authenticated can mutate video_upload_sessions outside the server';
      end if;
    elsif v_table = 'video_assets' then
      if v_policy_count <> 2 then raise exception 'video_assets policies must be quarantine-only'; end if;
      if has_table_privilege('authenticated', 'public.video_assets', 'UPDATE')
        or has_table_privilege('authenticated', 'public.video_assets', 'DELETE') then
        raise exception 'authenticated can mutate video_assets outside the server';
      end if;
    elsif v_table in ('video_edit_plans', 'video_edit_plan_versions', 'render_jobs', 'render_job_events', 'voice_direction_plans', 'narration_takes') then
      if v_policy_count <> 1 then raise exception 'edit plan policies must be read-only'; end if;
      if has_table_privilege('authenticated', format('public.%I', v_table), 'INSERT')
        or has_table_privilege('authenticated', format('public.%I', v_table), 'UPDATE')
        or has_table_privilege('authenticated', format('public.%I', v_table), 'DELETE') then
        raise exception 'authenticated can mutate edit plan tables outside the RPCs: public.%', v_table;
      end if;
    elsif v_policy_count <> 4 then
      raise exception 'owner CRUD policies missing for public.%', v_table;
    end if;
    if has_table_privilege('anon', format('public.%I', v_table), 'SELECT')
      or has_table_privilege('anon', format('public.%I', v_table), 'INSERT')
      or has_table_privilege('anon', format('public.%I', v_table), 'UPDATE')
      or has_table_privilege('anon', format('public.%I', v_table), 'DELETE') then
      raise exception 'anonymous table privilege remains for public.%', v_table;
    end if;
  end loop;
end;
$$;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{"dif_studio_owner":true}}', true);

insert into public.series (id, title, premise)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'RLS test series', 'Synthetic owner-only fixture');
insert into public.seasons (id, series_id, season_number, title)
values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 1, 'Season one');
insert into public.episodes (id, season_id, episode_number, title, duration_ms)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 1, 'Pilot', 90000);
select throws_ok(
  $$update public.seasons set planned_episode_count = 13 where id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';$$,
  '23514', 'season_plan_locked_after_episode_creation',
  'the planned finale cannot change after an episode establishes the season structure'
);

insert into public.scenes (owner_id, episode_id, scene_index, start_ms, end_ms)
select '11111111-1111-4111-8111-111111111111',
       'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
       n, (n - 1) * 8000, case when n = 12 then 90000 else n * 8000 end
from generate_series(1, 12) as n;

insert into public.choices (owner_id, episode_id, option_key, label, consequence)
values
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '1', 'Open the file', 'Lara learns who sent the signal.'),
  ('11111111-1111-4111-8111-111111111111', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', '2', 'Destroy the file', 'Lara loses the only copy and alerts the archive.');

select public.save_episode_scene(
  (select id from public.scenes where episode_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and scene_index = 1),
  'A fita começa com uma voz distante.', 'A gravação abre em uma sala vazia.', 'Plano fixo.', 'Luz fluorescente.',
  'Empty archive room, analog horror, vertical composition.', 'The light flickers above the recorder.',
  'Slow push toward the tape recorder.', 'Low room tone.'
);
select public.save_episode_choices(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'Abrir o arquivo', 'Lara descobre quem enviou o sinal.',
  'Destruir o arquivo', 'Lara perde a única cópia e alerta o arquivo.'
);
select public.save_episode_content(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'Pilot', 'Uma fita chega ao arquivo.', 'A voz sabe o nome de Lara.',
  'Lara encontra uma fita marcada com a data de amanhã.', 'A voz gravada responde a perguntas que Lara ainda não fez.',
  'A câmera da sala mostra alguém atrás dela.', 'A fita começa com uma voz distante.', 90000, false,
  '{"tiktok_caption":"A fita chegou ontem.","instagram_caption":"O arquivo não estava vazio."}'::jsonb
);
select public.set_episode_status('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'READY');
select public.import_narrative_response(
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'Imported Pilot', 'A narração chega ao arquivo.', 'A fita fala antes de ser ligada.',
  'Lara encontra uma fita marcada para amanhã.', 'A voz gravada conhece a sala.',
  'A câmera mostra uma figura atrás dela.', 'A fita começa com uma voz distante.',
  90000,
  '{"screen_suggestion":"Close no gravador.","sound_suggestion":"Ruído de fita.","tiktok_title":"A fita","instagram_title":"O arquivo"}'::jsonb,
  'Ouvir a fita', 'Lara descobre quem enviou o sinal.',
  'Destruir a fita', 'Lara perde a única cópia e alerta o arquivo.'
);
do $$
begin
  if not exists (
    select 1 from public.episodes
    where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
      and title = 'Imported Pilot'
      and status = 'DRAFT'
      and platform_metadata ->> 'screen_suggestion' = 'Close no gravador.'
  ) then
    raise exception 'manual response import did not persist the episode and platform copy';
  end if;
  begin
    perform public.import_narrative_response(
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'Must Roll Back', 'A narração chega ao arquivo.', 'A fita fala antes de ser ligada.',
      'Lara encontra uma fita marcada para amanhã.', 'A voz gravada conhece a sala.',
      'A câmera mostra uma figura atrás dela.', 'A fita começa com uma voz distante.',
      90000, '{}'::jsonb,
      'Ouvir a fita', 'Mesma consequência.', 'Ouvir a fita', 'Mesma consequência.'
    );
    raise exception 'manual import with duplicate choices unexpectedly succeeded';
  exception when check_violation then
    null;
  end;
  if exists (
    select 1 from public.episodes
    where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and title = 'Must Roll Back'
  ) then
    raise exception 'failed manual import partially changed episode content';
  end if;
  if has_function_privilege(
    'anon',
    'public.import_narrative_response(uuid,text,text,text,text,text,text,text,integer,jsonb,text,text,text,text)',
    'EXECUTE'
  ) then
    raise exception 'anonymous role can call manual narrative import';
  end if;
end;
$$;
select public.set_episode_status('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'READY');

-- CD06: scene production metadata, reorder, and configurable scene duration.
insert into public.seasons (id, series_id, season_number, title)
values ('f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 2, 'CD06 season');
insert into public.episodes (id, season_id, episode_number, title, duration_ms, scene_duration_ms)
values ('e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6', 'f6f6f6f6-f6f6-46f6-86f6-f6f6f6f6f6f6', 1, 'CD06 timeline', 96000, 6000);
insert into public.scenes (owner_id, episode_id, scene_index, start_ms, end_ms)
select '11111111-1111-4111-8111-111111111111',
       'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
       n, (n - 1) * 6000, least(n * 6000, 96000)
from generate_series(1, 16) as n;

do $$
declare
  v_first uuid;
  v_second uuid;
begin
  select id into v_first from public.scenes
  where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6' and scene_index = 1;
  select id into v_second from public.scenes
  where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6' and scene_index = 2;
  perform public.swap_scene_order(v_first, 'down');
  if (select id from public.scenes where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6' and scene_index = 1) <> v_second then
    raise exception 'scene reorder did not move the adjacent scene';
  end if;
  if (select start_ms from public.scenes where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6' and scene_index = 1) <> 0
    or (select end_ms from public.scenes where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6' and scene_index = 1) <> 6000 then
    raise exception 'scene reorder did not recalculate the timeline';
  end if;
end;
$$;
select pass('scene reorder swaps adjacent positions and recalculates the fixed-duration timeline');

select public.set_episode_scene_duration('e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6', 4000, 96000);
select ok(
  (select count(*) = 24 from public.scenes where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6')
  and (select max(end_ms) = 96000 from public.scenes where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6'),
  'an empty draft timeline rebuilds for 4-second scenes without gaps'
);

select public.import_narrative_response(
  'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
  'CD06 import', 'Logline importada.', 'Hook importado.',
  'Narrativa importada.', 'Revelação importada.', 'Cliffhanger importado.',
  'Narração importada.', 96000, '{}'::jsonb,
  'Opção A', 'Consequência A.', 'Opção B', 'Consequência B.'
);
select ok(
  (select count(*) = 24 from public.scenes where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6')
  and (select end_ms = 4000 from public.scenes where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6' and scene_index = 1)
  and (select max(end_ms) = 96000 from public.scenes where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6'),
  'narrative import preserves the configured 4-second scene timeline'
);

select public.save_scene_production(
  (select id from public.scenes where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6' and scene_index = 1),
  'Archive room', 'Lara at the door', 'VHS tracking lines', 'Cut to black', 'READY', 2
);
select ok(
  (select location = 'Archive room'
      and character_notes = 'Lara at the door'
      and vhs_effects = 'VHS tracking lines'
      and transition = 'Cut to black'
      and prompt_status = 'READY'
      and generation_attempts = 2
   from public.scenes
   where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6' and scene_index = 1),
  'scene production metadata persists for the owner'
);

select throws_ok(
  $$select public.set_episode_scene_duration('e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6', 6000, 96000);$$,
  '23514', 'episode_scenes_not_empty',
  'non-empty scene content blocks a silent timeline rebuild'
);
select throws_ok(
  $$select public.save_scene_production(
    (select id from public.scenes where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6' and scene_index = 1),
    '', '', '', '', 'INVALID', 0
  );$$,
  '22023', 'invalid_prompt_status',
  'an invalid prompt status is rejected'
);
select throws_ok(
  $$select public.save_scene_production(
    (select id from public.scenes where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6' and scene_index = 1),
    '', '', '', '', 'APPROVED', 0
  );$$,
  '23514', 'approved_scene_requires_prompts',
  'APPROVED requires the three scene prompts'
);
select public.save_scene_production(
  (select id from public.scenes where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6' and scene_index = 24),
  'Tail scene', '', '', '', 'TODO', 0
);
select throws_ok(
  $$select public.import_narrative_response(
    'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
    'Truncated import', 'Logline.', 'Hook.', 'Narrative.', 'Reveal.', 'Cliffhanger.',
    'Narração.', 90000, '{}'::jsonb, 'A', 'Consequence A.', 'B', 'Consequence B.'
  );$$,
  '23514', 'episode_scenes_would_be_truncated',
  'import cannot silently truncate a content-bearing scene'
);

select public.set_episode_status('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'PUBLISHED');

do $$
begin
  begin
    update public.episodes set title = 'Tampered' where id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    raise exception 'published episode was unexpectedly editable';
  exception when sqlstate '55000' then
    null;
  end;
end;
$$;

insert into public.polls (id, episode_id, opened_at, closes_at, tie_break_rule, tie_break_option)
values (
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  now(), now() + interval '1 day',
  'If totals tie, option 1 wins; published before voting opened.', '1'
);

insert into public.episodes (id, season_id, episode_number, title, duration_ms)
values ('12121212-1212-4121-8121-121212121212', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 2, 'Continuation', 90000);
insert into public.scenes (owner_id, episode_id, scene_index, start_ms, end_ms)
select '11111111-1111-4111-8111-111111111111',
       '12121212-1212-4121-8121-121212121212',
       n, (n - 1) * 8000, case when n = 12 then 90000 else n * 8000 end
from generate_series(1, 12) as n;
insert into public.choices (owner_id, episode_id, option_key, label, consequence)
values
  ('11111111-1111-4111-8111-111111111111', '12121212-1212-4121-8121-121212121212', '1', 'Follow the signal', 'Lara finds the second archive room.'),
  ('11111111-1111-4111-8111-111111111111', '12121212-1212-4121-8121-121212121212', '2', 'Destroy the tape', 'Lara erases the only recording.');
select public.set_episode_status('12121212-1212-4121-8121-121212121212', 'READY');

select throws_ok(
  $$select public.import_narrative_response(
    '12121212-1212-4121-8121-121212121212', 'Must keep choices', 'A logline.', 'A hook.',
    'A narrative.', 'A reveal.', 'A cliffhanger.', 'A complete narration.', 90000, '{}'::jsonb,
    null, null, null, null
  );$$,
  '23514', 'episode_requires_two_choices_unless_finale',
  'non-final narrative import still requires both voting options'
);

select throws_ok(
  $$select public.set_episode_status('12121212-1212-4121-8121-121212121212', 'PUBLISHED');$$,
  '23514', 'episode_previous_vote_open',
  'continuation cannot publish while the prior vote is open'
);
select throws_ok(
  $$update public.episodes set status = 'PUBLISHED', published_at = now()
    where id = '12121212-1212-4121-8121-121212121212';$$,
  '23514', 'episode_previous_vote_open',
  'direct PostgreSQL updates cannot bypass the publication gate'
);
select throws_ok(
  $$insert into public.episodes (id, season_id, episode_number, title, duration_ms, status, published_at)
    values ('23232323-2323-4323-8323-232323232323', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 4,
      'Cannot insert published', 90000, 'PUBLISHED', now());$$,
  '23514', 'invalid_episode_status_transition',
  'direct PostgreSQL inserts cannot create already-published episodes'
);
update public.polls set status = 'CLOSED', closed_at = now() where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

insert into public.poll_results (
  id, poll_id, revision_number, option_1_count, option_2_count, winner_option,
  verification_status, evidence_source, captured_at, verified_at
)
values (
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 1, 12, 7, '1',
  'VERIFIED', 'Synthetic fixture; no real audience data.', now(), now()
);

insert into public.canonical_decisions (
  id, poll_id, episode_id, poll_result_id, revision_number, canon_snapshot, rationale, continuity_review
)
values (
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 1,
  '{"winner":"1","approved":true}'::jsonb,
  'Synthetic fixture; explicit owner approval.',
  '{"warnings":[],"reviewedAt":"2026-11-11T00:00:00Z","reviewedBy":"11111111-1111-4111-8111-111111111111"}'::jsonb
);

do $$
begin
  if not exists (select 1 from public.canonical_decisions where id = 'ffffffff-ffff-4fff-8fff-ffffffffffff') then
    raise exception 'owner could not read its canonical decision';
  end if;
  if not exists (select 1 from public.polls where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' and status = 'VERIFIED') then
    raise exception 'verified result did not advance poll state';
  end if;
end;
$$;

select lives_ok(
  $$select public.set_episode_status('12121212-1212-4121-8121-121212121212', 'PUBLISHED');$$,
  'closed verified winner with its approved canonical decision permits publication'
);

insert into public.polls (id, episode_id, opened_at, closes_at, tie_break_rule, tie_break_option)
values (
  '14141414-1414-4141-8141-141414141414',
  '12121212-1212-4121-8121-121212121212',
  now(), now() + interval '1 day', 'If totals tie, option 2 wins.', '2'
);
update public.polls set status = 'CLOSED', closed_at = now()
where id = '14141414-1414-4141-8141-141414141414';
insert into public.poll_results (
  id, poll_id, revision_number, option_1_count, option_2_count, winner_option,
  verification_status, evidence_source, captured_at, verified_at
) values (
  '15151515-1515-4151-8151-151515151515', '14141414-1414-4141-8141-141414141414',
  1, 8, 12, '2', 'VERIFIED', 'Synthetic continuation vote.', now(), now()
);
insert into public.canonical_decisions (
  id, poll_id, episode_id, poll_result_id, revision_number, canon_snapshot, rationale, continuity_review
) values (
  '16161616-1616-4161-8161-161616161616', '14141414-1414-4141-8141-141414141414',
  '12121212-1212-4121-8121-121212121212', '15151515-1515-4151-8151-151515151515',
  1, '{"selectedOption":"2"}'::jsonb, 'Synthetic owner approval of the latest result.',
  '{"warnings":[],"reviewedAt":"2026-11-11T00:00:00Z","reviewedBy":"11111111-1111-4111-8111-111111111111"}'::jsonb
);

insert into public.episodes (id, season_id, episode_number, title, duration_ms)
values ('13131313-1313-4131-8131-131313131313', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 3, 'Next continuation', 90000);
insert into public.scenes (owner_id, episode_id, scene_index, start_ms, end_ms)
select '11111111-1111-4111-8111-111111111111',
       '13131313-1313-4131-8131-131313131313',
       n, (n - 1) * 8000, case when n = 12 then 90000 else n * 8000 end
from generate_series(1, 12) as n;
insert into public.choices (owner_id, episode_id, option_key, label, consequence)
values
  ('11111111-1111-4111-8111-111111111111', '13131313-1313-4131-8131-131313131313', '1', 'Keep the light on', 'The archive reveals a new corridor.'),
  ('11111111-1111-4111-8111-111111111111', '13131313-1313-4131-8131-131313131313', '2', 'Cut the power', 'The tape begins recording by itself.');
select public.set_episode_status('13131313-1313-4131-8131-131313131313', 'READY');

insert into public.poll_results (
  id, poll_id, revision_number, option_1_count, option_2_count, winner_option,
  verification_status, evidence_source, captured_at, supersedes_result_id
) values (
  '17171717-1717-4171-8171-171717171717', '14141414-1414-4141-8141-141414141414',
  2, 9, 12, null, 'PENDING', '', now(), '15151515-1515-4151-8151-151515151515'
);
select throws_ok(
  $$select public.set_episode_status('13131313-1313-4131-8131-131313131313', 'PUBLISHED');$$,
  '23514', 'episode_previous_result_unverified',
  'a newer pending result blocks publication even when the prior result was approved'
);

insert into public.poll_results (
  id, poll_id, revision_number, option_1_count, option_2_count, winner_option,
  verification_status, evidence_source, captured_at, verified_at, supersedes_result_id
) values (
  '18181818-1818-4181-8181-181818181818', '14141414-1414-4141-8141-141414141414',
  3, 15, 12, '1', 'VERIFIED', 'Synthetic corrected continuation vote.', now(), now(),
  '17171717-1717-4171-8171-171717171717'
);
select throws_ok(
  $$select public.set_episode_status('13131313-1313-4131-8131-131313131313', 'PUBLISHED');$$,
  '23514', 'episode_previous_canon_stale',
  'a verified correction still blocks publication until its result is approved'
);
insert into public.canonical_decisions (
  id, poll_id, episode_id, poll_result_id, revision_number, supersedes_decision_id, canon_snapshot, rationale, continuity_review
) values (
  '19191919-1919-4191-8191-191919191919', '14141414-1414-4141-8141-141414141414',
  '12121212-1212-4121-8121-121212121212', '18181818-1818-4181-8181-181818181818',
  2, '16161616-1616-4161-8161-161616161616', '{"selectedOption":"1"}'::jsonb,
  'Synthetic owner approval of the corrected latest result.',
  '{"warnings":[],"reviewedAt":"2026-11-11T00:00:00Z","reviewedBy":"11111111-1111-4111-8111-111111111111"}'::jsonb
);
select lives_ok(
  $$select public.set_episode_status('13131313-1313-4131-8131-131313131313', 'PUBLISHED');$$,
  'publication succeeds after the latest verified result is canonically approved'
);

-- CD04: an out-of-order draft can be created and edited, but publication waits for its immediate predecessor.
insert into public.episodes (id, season_id, episode_number, title, duration_ms)
values ('51515151-5151-4151-8151-515151515151', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 5, 'Out of order draft', 90000);
update public.episodes set title = 'Edited out of order draft'
where id = '51515151-5151-4151-8151-515151515151';
insert into public.scenes (owner_id, episode_id, scene_index, start_ms, end_ms)
select '11111111-1111-4111-8111-111111111111', '51515151-5151-4151-8151-515151515151', n,
       (n - 1) * 8000, case when n = 12 then 90000 else n * 8000 end
from generate_series(1, 12) as n;
insert into public.choices (owner_id, episode_id, option_key, label, consequence)
values
  ('11111111-1111-4111-8111-111111111111', '51515151-5151-4151-8151-515151515151', '1', 'Preserve the page', 'The archive keeps the note.'),
  ('11111111-1111-4111-8111-111111111111', '51515151-5151-4151-8151-515151515151', '2', 'Burn the page', 'The archive loses the note.');
select ok(
  (select status = 'DRAFT' and title = 'Edited out of order draft'
      and not exists (select 1 from public.polls where episode_id = '51515151-5151-4151-8151-515151515151')
      and not exists (select 1 from public.canonical_decisions where episode_id = '51515151-5151-4151-8151-515151515151')
   from public.episodes where id = '51515151-5151-4151-8151-515151515151'),
  'out-of-order drafts remain editable without creating polls or canonical decisions'
);
select public.set_episode_status('51515151-5151-4151-8151-515151515151', 'READY');
select throws_ok(
  $$select public.set_episode_status('51515151-5151-4151-8151-515151515151', 'PUBLISHED');$$,
  '23514', 'episode_previous_episode_missing',
  'RPC publication is blocked when the immediate previous episode is missing'
);
select throws_ok(
  $$update public.episodes set status = 'PUBLISHED', published_at = now()
    where id = '51515151-5151-4151-8151-515151515151';$$,
  '23514', 'episode_previous_episode_missing',
  'direct PostgreSQL updates are blocked when the immediate previous episode is missing'
);

insert into public.episodes (id, season_id, episode_number, title, duration_ms)
values
  ('41414141-4141-4141-8141-414141414141', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 4, 'Episode four', 90000),
  ('61616161-6161-4161-8161-616161616161', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 6, 'Episode six', 90000),
  ('71717171-7171-4171-8171-717171717171', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 7, 'Episode seven', 90000),
  ('81818181-8181-4181-8181-818181818181', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 8, 'Episode eight', 90000),
  ('91919191-9191-4191-8191-919191919191', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 9, 'Episode nine', 90000),
  ('a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 10, 'Episode ten', 90000);
insert into public.scenes (owner_id, episode_id, scene_index, start_ms, end_ms)
select '11111111-1111-4111-8111-111111111111', e.id, n,
       (n - 1) * 8000, case when n = 12 then 90000 else n * 8000 end
from public.episodes e cross join generate_series(1, 12) as n
where e.id in (
  '41414141-4141-4141-8141-414141414141', '61616161-6161-4161-8161-616161616161',
  '71717171-7171-4171-8171-717171717171', '81818181-8181-4181-8181-818181818181',
  '91919191-9191-4191-8191-919191919191', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1'
);
insert into public.choices (owner_id, episode_id, option_key, label, consequence)
select '11111111-1111-4111-8111-111111111111', e.id, branch.option_key, branch.label, branch.consequence
from public.episodes e
cross join (values ('1', 'Keep the record', 'The archive preserves the trace.'),
                   ('2', 'Erase the record', 'The archive removes the trace.')) as branch(option_key, label, consequence)
where e.id in (
  '41414141-4141-4141-8141-414141414141', '61616161-6161-4161-8161-616161616161',
  '71717171-7171-4171-8171-717171717171', '81818181-8181-4181-8181-818181818181',
  '91919191-9191-4191-8191-919191919191', 'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1'
);
select public.set_episode_status('41414141-4141-4141-8141-414141414141', 'READY');
select public.set_episode_status('61616161-6161-4161-8161-616161616161', 'READY');
select public.set_episode_status('71717171-7171-4171-8171-717171717171', 'READY');
select public.set_episode_status('81818181-8181-4181-8181-818181818181', 'READY');
select public.set_episode_status('91919191-9191-4191-8191-919191919191', 'READY');
select public.set_episode_status('a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1', 'READY');

-- Episode 3 has a verified, explicitly approved result, so episode 4 can publish.
insert into public.polls (id, episode_id, opened_at, closes_at, tie_break_rule, tie_break_option)
values ('33333333-3333-4333-8333-333333333333', '13131313-1313-4131-8131-131313131313',
  now(), now() + interval '1 day', 'If totals tie, option 1 wins.', '1');
update public.polls set status = 'CLOSED', closed_at = now()
where id = '33333333-3333-4333-8333-333333333333';
insert into public.poll_results (
  id, poll_id, revision_number, option_1_count, option_2_count, winner_option,
  verification_status, evidence_source, captured_at, verified_at
) values (
  '34343434-3434-4434-8434-343434343434', '33333333-3333-4333-8333-333333333333',
  1, 10, 5, '1', 'VERIFIED', 'Synthetic episode three vote.', now(), now()
);
insert into public.canonical_decisions (
  id, poll_id, episode_id, poll_result_id, revision_number, canon_snapshot, rationale, continuity_review
) values (
  '35353535-3535-4535-8535-353535353535', '33333333-3333-4333-8333-333333333333',
  '13131313-1313-4131-8131-131313131313', '34343434-3434-4434-8434-343434343434',
  1, '{"selectedOption":"1"}'::jsonb, 'Synthetic explicit owner approval before episode four.',
  '{"warnings":[],"reviewedAt":"2026-11-11T00:00:00Z","reviewedBy":"11111111-1111-4111-8111-111111111111"}'::jsonb
);
select lives_ok(
  $$select public.set_episode_status('41414141-4141-4141-8141-414141414141', 'PUBLISHED');$$,
  'publication is allowed once the missing predecessor exists with verified and approved continuity'
);

-- Approve episode 4 before publishing the previously blocked episode 5 draft.
insert into public.polls (id, episode_id, opened_at, closes_at, tie_break_rule, tie_break_option)
values ('44444444-4444-4444-8444-444444444444', '41414141-4141-4141-8141-414141414141',
  now(), now() + interval '1 day', 'If totals tie, option 1 wins.', '1');
update public.polls set status = 'CLOSED', closed_at = now()
where id = '44444444-4444-4444-8444-444444444444';
insert into public.poll_results (
  id, poll_id, revision_number, option_1_count, option_2_count, winner_option,
  verification_status, evidence_source, captured_at, verified_at
) values (
  '45454545-4545-4545-8545-454545454545', '44444444-4444-4444-8444-444444444444',
  1, 10, 5, '1', 'VERIFIED', 'Synthetic episode four vote.', now(), now()
);
insert into public.canonical_decisions (
  id, poll_id, episode_id, poll_result_id, revision_number, canon_snapshot, rationale, continuity_review
) values (
  '46464646-4646-4646-8646-464646464646', '44444444-4444-4444-8444-444444444444',
  '41414141-4141-4141-8141-414141414141', '45454545-4545-4545-8545-454545454545',
  1, '{"selectedOption":"1"}'::jsonb, 'Synthetic explicit owner approval before episode five.',
  '{"warnings":[],"reviewedAt":"2026-11-11T00:00:00Z","reviewedBy":"11111111-1111-4111-8111-111111111111"}'::jsonb
);
select lives_ok(
  $$select public.set_episode_status('51515151-5151-4151-8151-515151515151', 'PUBLISHED');$$,
  'the out-of-order episode publishes after its immediate predecessor has valid verified continuity'
);

do $$
declare
  v_episode_number smallint;
  v_episode_id uuid;
  v_poll_id uuid;
  v_result_id uuid;
  v_next_episode_id uuid;
begin
  for v_episode_number in 5..10 loop
    select id into v_episode_id from public.episodes
    where season_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and episode_number = v_episode_number;
    v_poll_id := gen_random_uuid();
    v_result_id := gen_random_uuid();
    insert into public.polls (id, episode_id, opened_at, closes_at, tie_break_rule, tie_break_option)
    values (v_poll_id, v_episode_id, now(), now() + interval '1 day', 'If totals tie, option 1 wins.', '1');
    update public.polls set status = 'CLOSED', closed_at = now() where id = v_poll_id;
    insert into public.poll_results (
      id, poll_id, revision_number, option_1_count, option_2_count, winner_option,
      verification_status, evidence_source, captured_at, verified_at
    ) values (
      v_result_id, v_poll_id, 1, 10, 5, '1', 'VERIFIED',
      format('Synthetic episode %s vote.', v_episode_number), now(), now()
    );
    insert into public.canonical_decisions (
      poll_id, episode_id, poll_result_id, revision_number, canon_snapshot, rationale, continuity_review
    ) values (
      v_poll_id, v_episode_id, v_result_id, 1, '{"selectedOption":"1"}'::jsonb,
      format('Synthetic explicit owner approval for episode %s.', v_episode_number),
      '{"warnings":[],"reviewedAt":"2026-11-11T00:00:00Z","reviewedBy":"11111111-1111-4111-8111-111111111111"}'::jsonb
    );
    if v_episode_number < 10 then
      select id into v_next_episode_id from public.episodes
      where season_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' and episode_number = v_episode_number + 1;
      perform public.set_episode_status(v_next_episode_id, 'PUBLISHED');
    end if;
  end loop;
end;
$$;
select ok(
  (select count(*) = 7 from public.episodes
   where season_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
     and episode_number between 4 and 10 and status = 'PUBLISHED'),
  'episodes four through ten publish only as each immediate predecessor gains verified approved continuity'
);

insert into public.episodes (id, season_id, episode_number, title, duration_ms)
values ('21212121-2121-4121-8121-212121212121', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 11, 'Pre-finale episode', 90000);
insert into public.scenes (owner_id, episode_id, scene_index, start_ms, end_ms)
select '11111111-1111-4111-8111-111111111111',
       '21212121-2121-4121-8121-212121212121',
       n, (n - 1) * 8000, case when n = 12 then 90000 else n * 8000 end
from generate_series(1, 12) as n;
insert into public.choices (owner_id, episode_id, option_key, label, consequence)
values
  ('11111111-1111-4111-8111-111111111111', '21212121-2121-4121-8121-212121212121', '1', 'Open the last room', 'Lara finds the source of the signal.'),
  ('11111111-1111-4111-8111-111111111111', '21212121-2121-4121-8121-212121212121', '2', 'Seal the last room', 'Lara preserves the archive but loses the signal.');
select public.set_episode_status('21212121-2121-4121-8121-212121212121', 'READY');
select public.set_episode_status('21212121-2121-4121-8121-212121212121', 'PUBLISHED');
insert into public.polls (id, episode_id, opened_at, closes_at, tie_break_rule, tie_break_option)
values ('22222222-2222-4222-8222-222222222222', '21212121-2121-4121-8121-212121212121',
  now(), now() + interval '1 day', 'If totals tie, option 1 wins.', '1');
update public.polls set status = 'CLOSED', closed_at = now()
where id = '22222222-2222-4222-8222-222222222222';
insert into public.poll_results (
  id, poll_id, revision_number, option_1_count, option_2_count, winner_option,
  verification_status, evidence_source, captured_at, verified_at
) values (
  '24242424-2424-4424-8424-242424242424', '22222222-2222-4222-8222-222222222222',
  1, 11, 4, '1', 'VERIFIED', 'Synthetic pre-finale vote.', now(), now()
);
insert into public.canonical_decisions (
  id, poll_id, episode_id, poll_result_id, revision_number, canon_snapshot, rationale, continuity_review
) values (
  '25252525-2525-4525-8525-252525252525', '22222222-2222-4222-8222-222222222222',
  '21212121-2121-4121-8121-212121212121', '24242424-2424-4424-8424-242424242424',
  1, '{"selectedOption":"1"}'::jsonb, 'Synthetic owner approval before the season finale.',
  '{"warnings":[],"reviewedAt":"2026-11-11T00:00:00Z","reviewedBy":"11111111-1111-4111-8111-111111111111"}'::jsonb
);

insert into public.episodes (id, season_id, episode_number, title, duration_ms)
values ('20202020-2020-4020-8020-202020202020', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 12, 'Season finale', 90000);
insert into public.scenes (owner_id, episode_id, scene_index, start_ms, end_ms)
select '11111111-1111-4111-8111-111111111111',
       '20202020-2020-4020-8020-202020202020',
       n, (n - 1) * 8000, case when n = 12 then 90000 else n * 8000 end
from generate_series(1, 12) as n;
select lives_ok(
  $$select public.import_narrative_response(
    '20202020-2020-4020-8020-202020202020', 'Season finale', 'The last logline.', 'The last hook.',
    'The final narrative.', 'The final reveal.', 'The story ends.', 'A complete final narration.',
    90000, '{}'::jsonb, null, null, null, null
  );$$,
  'final-season narrative imports without voting options'
);
select public.set_episode_status('20202020-2020-4020-8020-202020202020', 'READY');
select lives_ok(
  $$select public.set_episode_status('20202020-2020-4020-8020-202020202020', 'PUBLISHED');$$,
  'final-season episode publishes without its own poll or choices'
);
select ok(
  (select is_season_finale and not exists (select 1 from public.choices where episode_id = '20202020-2020-4020-8020-202020202020')
     and not exists (select 1 from public.polls where episode_id = '20202020-2020-4020-8020-202020202020')
   from public.episodes where id = '20202020-2020-4020-8020-202020202020'),
  'finale is derived from planned season length and has neither choices nor a poll'
);
select ok(
  (select count(*) = 2 and count(distinct consequence) = 2
   from public.choices where episode_id = '12121212-1212-4121-8121-121212121212'),
  'both published continuation branches retain different consequences'
);

-- A newer result that is not verified invalidates the earlier winner for canon purposes.
insert into public.poll_results (
  id, poll_id, revision_number, option_1_count, option_2_count, winner_option,
  verification_status, evidence_source, captured_at, verified_at, supersedes_result_id
)
values (
  'abababab-abab-4aba-8aba-abababababab',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd', 2, 13, 9, null,
  'PENDING', '', now(), null, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
);

do $$
begin
  if not exists (
    select 1 from public.polls
    where id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' and status = 'CLOSED'
  ) then
    raise exception 'pending correction did not remove verified poll status';
  end if;
  if not exists (
    select 1 from public.poll_results
    where id = 'abababab-abab-4aba-8aba-abababababab'
      and verification_status = 'PENDING' and winner_option is null
  ) then
    raise exception 'pending result was not preserved as unverified';
  end if;
  begin
    insert into public.canonical_decisions (
      poll_id, episode_id, poll_result_id, revision_number, supersedes_decision_id,
      canon_snapshot, rationale, continuity_review
    ) values (
      'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      'abababab-abab-4aba-8aba-abababababab', 2,
      'ffffffff-ffff-4fff-8fff-ffffffffffff',
      '{"winner":"1","approved":true}'::jsonb,
      'This invalid decision must be rejected.',
      '{"warnings":[],"reviewedAt":"2026-11-11T00:00:00Z","reviewedBy":"11111111-1111-4111-8111-111111111111"}'::jsonb
    );
    raise exception 'unverified result was unexpectedly canonized';
  exception when check_violation then
    null;
  end;
  if exists (
    select 1 from public.canonical_decisions
    where poll_result_id = 'abababab-abab-4aba-8aba-abababababab'
  ) then
    raise exception 'an unverified result has a canonical decision';
  end if;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","app_metadata":{}}', true);

do $$
begin
  if exists (select 1 from public.series where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa') then
    raise exception 'second owner read another owner series';
  end if;
  begin
    insert into public.series (owner_id, title)
    values ('22222222-2222-4222-8222-222222222222', 'Unmarked user must not write');
    raise exception 'authenticated user without owner claim unexpectedly inserted its own data';
  exception when insufficient_privilege then
    null;
  end;
  begin
    perform public.set_episode_status('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'READY');
    raise exception 'unmarked authenticated user unexpectedly called a privileged RPC';
  exception when insufficient_privilege then
    null;
  end;
  begin
    insert into public.series (id, owner_id, title)
    values ('99999999-9999-4999-8999-999999999999', '11111111-1111-4111-8111-111111111111', 'Spoofed owner');
    raise exception 'cross-owner insert unexpectedly succeeded';
  exception when insufficient_privilege then
    null;
  end;
  if has_table_privilege('authenticated', 'public.episode_revisions', 'UPDATE')
    or has_table_privilege('authenticated', 'public.poll_results', 'DELETE')
    or has_table_privilege('authenticated', 'public.canonical_decisions', 'UPDATE') then
    raise exception 'authenticated role can mutate append-only records';
  end if;
end;
$$;

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{"dif_studio_owner":true}}', true);

select throws_ok(
  $$insert into public.video_upload_sessions (
      id, episode_id, scene_id, idempotency_key, quarantine_key, part_size_bytes, total_bytes
    ) values (
      'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      (select id from public.scenes where episode_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and scene_index = 1),
      'idem-video-owner-001',
      'quarantine/11111111-1111-4111-8111-111111111111/e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0/source',
      8388608,
      1048576
    );$$,
  '42501',
  'permission denied for table video_upload_sessions',
  'owner cannot create a video upload session through the Data API'
);

select set_config(
  'test.video_scene_id',
  (select id::text from public.scenes
   where episode_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and scene_index = 1),
  true
);
set local role service_role;
insert into public.video_upload_sessions (
  id, episode_id, scene_id, idempotency_key, quarantine_key, part_size_bytes, total_bytes
) values (
  'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  current_setting('test.video_scene_id')::uuid,
  'idem-video-owner-001',
  'quarantine/11111111-1111-4111-8111-111111111111/e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0/source',
  8388608,
  1048576
);
set local role authenticated;

select ok(
  exists (
    select 1 from public.video_upload_sessions
    where id = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0'
  ),
  'owner can read the server-created video upload session'
);

insert into public.video_assets (
  id, owner_id, episode_id, scene_id, asset_version, bucket, object_key, status
) values (
  'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0',
  '11111111-1111-4111-8111-111111111111',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  (select id from public.scenes where episode_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and scene_index = 1),
  1,
  'dif-studio-video-private',
  'owners/11111111-1111-4111-8111-111111111111/episodes/cccccccc-cccc-4ccc-8ccc-cccccccccccc/scenes/f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0/v1/f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0.mp4',
  'QUARANTINED'
);

select throws_ok(
  $$insert into public.video_assets (
      id, owner_id, episode_id, scene_id, asset_version, bucket, object_key, status
    ) values (
      'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1',
      '11111111-1111-4111-8111-111111111111',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      (select id from public.scenes where episode_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and scene_index = 1),
      2,
      'dif-studio-video-private',
      'owners/11111111-1111-4111-8111-111111111111/episodes/cccccccc-cccc-4ccc-8ccc-cccccccccccc/scenes/spoofed/v2/spoofed.mp4',
      'READY'
    );$$,
  '42501',
  'video_assets must be created in quarantine',
  'owner cannot forge a READY video asset through the Data API'
);

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","app_metadata":{"dif_studio_owner":true}}', true);

select is(
  (select count(*) from public.video_upload_sessions),
  0::bigint,
  'second owner cannot read the first owner video upload session'
);

select throws_ok(
  $$insert into public.video_assets (
      owner_id, episode_id, scene_id, asset_version, bucket, object_key, status
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      (select id from public.scenes where episode_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' and scene_index = 1),
      2,
      'dif-studio-video-private',
      'owners/11111111-1111-4111-8111-111111111111/episodes/cccccccc-cccc-4ccc-8ccc-cccccccccccc/scenes/spoofed/v2/spoofed.mp4',
      'QUARANTINED'
    );$$,
  '42501',
  'new row violates row-level security policy for table "video_assets"',
  'second owner cannot create a video asset for the first owner'
);

select ok(
  not has_table_privilege('anon', 'public.video_assets', 'SELECT'),
  'anonymous role has no video asset table privilege'
);

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{"dif_studio_owner":true}}', true);
select throws_ok(
  $$update public.video_upload_sessions set status = 'COMPLETED'
    where id = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0';$$,
  '42501',
  'permission denied for table video_upload_sessions',
  'owner cannot update the video upload session through the Data API'
);

set local role service_role;
select throws_ok(
  $$update public.video_upload_sessions
    set quarantine_key = 'owners/11111111-1111-4111-8111-111111111111/episodes/cccccccc-cccc-4ccc-8ccc-cccccccccccc/final.mp4'
    where id = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0';$$,
  '42501',
  'video_upload_sessions identity fields are immutable',
  'server role cannot rewrite the session quarantine key'
);
update public.video_upload_sessions set status = 'COMPLETED'
where id = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0';
set local role authenticated;

select is(
  (select status from public.video_upload_sessions
   where id = 'e0e0e0e0-e0e0-4e0e-8e0e-e0e0e0e0e0e0'),
  'COMPLETED',
  'server can update the video upload session status'
);

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","app_metadata":{"dif_studio_owner":true}}', true);
do $$
begin
  begin
    update public.video_assets set safe_error_code = 'SPOOFED'
    where id = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0';
    if found then raise exception 'second owner updated the first owner video asset'; end if;
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
select pass('second owner cannot update the first owner video asset');

do $$
begin
  begin
    delete from public.video_assets
    where id = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0';
    if found then raise exception 'second owner deleted the first owner video asset'; end if;
  exception when insufficient_privilege then
    null;
  end;
end;
$$;
select pass('second owner cannot delete the first owner video asset');

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{"dif_studio_owner":true}}', true);
select throws_ok(
  $$delete from public.video_assets
    where id = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0';$$,
  '42501',
  'permission denied for table video_assets',
  'owner cannot hard-delete the video asset tombstone'
);
reset role;
delete from public.video_assets
where id = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0';
select is(
  (select count(*) from public.video_assets
   where id = 'f0f0f0f0-f0f0-4f0f-8f0f-f0f0f0f0f0f0'),
  0::bigint,
  'test cleanup removes the synthetic video asset'
);

select pass('video upload and asset RLS isolate owners and hide anonymous access');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{"dif_studio_owner":true}}', true);
select throws_ok(
  $$select public.save_video_edit_plan(
      '11111111-1111-4111-8111-111111111111',
      'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6', 0,
      '{"schemaVersion":1,"episodeId":"e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6","durationMs":120000,"tracks":[],"clips":[{}]}'::jsonb,
      repeat('a', 64), 'owner'
    );$$,
  '42501',
  'permission denied for function save_video_edit_plan',
  'authenticated owner cannot call the plan writer RPC'
);

set local role service_role;
select lives_ok(
  $$select public.save_video_edit_plan(
      '11111111-1111-4111-8111-111111111111',
      'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
      0,
      '{"schemaVersion":1,"episodeId":"e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6","durationMs":120000,"tracks":[{"id":"video-main","kind":"video","label":"Vídeo principal"}],"clips":[{}]}'::jsonb,
      repeat('a', 64),
      'fixture'
    );$$,
  'service role can create an edit plan through the RPC'
);
select is(
  (select current_version from public.video_edit_plans
   where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6'),
  1,
  'edit plan starts at version 1'
);
select is(
  (select count(*) from public.video_edit_plan_versions
   where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6'),
  1::bigint,
  'edit plan creation appends one immutable version'
);

select throws_ok(
  $$select public.restore_video_edit_plan(
      '11111111-1111-4111-8111-111111111111',
      'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6', 1, null, 'null expected'
    );$$,
  '23514',
  'edit_plan_version_invalid',
  'restore rejects a null expected version'
);
select throws_ok(
  $$select public.set_video_edit_plan_status(
      '11111111-1111-4111-8111-111111111111',
      'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6', null, 'APPROVED'
    );$$,
  '23514',
  'edit_plan_expected_version_invalid',
  'status update rejects a null expected version'
);
select throws_ok(
  $$select public.save_video_edit_plan(
      '11111111-1111-4111-8111-111111111111',
      'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6', 0,
      '{"schemaVersion":1,"episodeId":"e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6","durationMs":120000,"tracks":[],"clips":[{}]}'::jsonb,
      repeat('a', 64), 'stale'
    );$$,
  'P0001',
  'edit_plan_version_conflict',
  'stale edit plan save is rejected without lost update'
);
select is(
  public.restore_video_edit_plan(
    '11111111-1111-4111-8111-111111111111',
    'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6', 1, 1, 'restore fixture'
  ),
  2,
  'restoring a version appends a new snapshot'
);
select is(
  (select count(*) from public.video_edit_plan_versions
   where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6'),
  2::bigint,
  'restore preserves the original version history'
);

reset role;
select throws_ok(
  $$update public.video_edit_plan_versions set change_note = 'mutated'
    where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6';$$,
  '55000',
  'video_edit_plan_versions_are_immutable',
  'edit plan versions reject mutation'
);
set local role service_role;

select lives_ok(
  $$select public.set_video_edit_plan_status(
      '11111111-1111-4111-8111-111111111111',
      'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6', 2, 'APPROVED'
    );$$,
  'service role can approve the current edit plan'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{"dif_studio_owner":true}}', true);
select is(
  (select current_status from public.video_edit_plans
   where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6'),
  'APPROVED',
  'approved status is persisted'
);
select is(
  (select count(*) from public.video_edit_plans
   where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6'),
  1::bigint,
  'owner can read the server-created edit plan'
);

select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","app_metadata":{"dif_studio_owner":true}}', true);
select is(
  (select count(*) from public.video_edit_plans
   where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6'),
  0::bigint,
  'second owner cannot read the first owner edit plan'
);
select is(
  (select count(*) from public.video_edit_plan_versions
   where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6'),
  0::bigint,
  'second owner cannot read the first owner edit plan versions'
);

select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{"dif_studio_owner":true}}', true);
select throws_ok(
  $$insert into public.video_edit_plans (
      owner_id, episode_id, current_version, plan, manifest_hash
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
      3,
      '{}'::jsonb,
      repeat('b', 64)
    );$$,
  '42501',
  'permission denied for table video_edit_plans',
  'owner cannot insert edit plans outside the RPC'
);
reset role;

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{"dif_studio_owner":true}}', true);
select throws_ok(
  $$select public.enqueue_render_job(
      '11111111-1111-4111-8111-111111111111',
      'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
      'render-auth-denied', 50::smallint
    );$$,
  '42501',
  'permission denied for function enqueue_render_job',
  'authenticated owner cannot enqueue render jobs directly'
);

set local role service_role;
create temp table test_render_jobs (name text primary key, id uuid);
insert into test_render_jobs
select 'job1', public.enqueue_render_job(
  '11111111-1111-4111-8111-111111111111',
  'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
  'render-job-001', 50::smallint
);
select is(
  (select count(*) from public.render_jobs
   where id = (select id from test_render_jobs where name = 'job1')),
  1::bigint,
  'service role enqueues a render job'
);
select is(
  public.enqueue_render_job(
    '11111111-1111-4111-8111-111111111111',
    'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
    'render-job-001', 50::smallint
  ),
  (select id from test_render_jobs where name = 'job1'),
  'render enqueue is idempotent by key'
);
select is(
  public.claim_render_job('worker-a', 60) ->> 'status',
  'CLAIMED',
  'worker-a claims the queued job'
);
select ok(
  public.claim_render_job('worker-b', 60) is null,
  'a second worker cannot claim while the first lease is active'
);
select lives_ok(
  $$select public.start_render_job(
      (select id from test_render_jobs where name = 'job1'), 'worker-a'
    );$$,
  'claimed job can start'
);
select is(
  (select status from public.render_jobs
   where id = (select id from test_render_jobs where name = 'job1')),
  'RUNNING',
  'job reaches RUNNING'
);
select lives_ok(
  $$select public.heartbeat_render_job(
      (select id from test_render_jobs where name = 'job1'), 'worker-a', 60
    );$$,
  'worker heartbeat extends the lease'
);
select throws_ok(
  $$select public.complete_render_job(
      (select id from test_render_jobs where name = 'job1'), 'worker-a',
      '{"stub":true}'::jsonb
    );$$,
  '23514',
  'render_stub_not_allowed',
  'stub manifest cannot mark a render READY'
);
select lives_ok(
  $$select public.complete_render_job(
      (select id from test_render_jobs where name = 'job1'), 'worker-a',
      '{"schemaVersion":1,"codec":"h264","width":1080,"height":1920,"durationMs":120000,"objectKey":"renders/test.mp4","sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}'::jsonb
    );$$,
  'worker completes the render job with a real artifact manifest'
);
select is(
  (select status from public.render_jobs
   where id = (select id from test_render_jobs where name = 'job1')),
  'READY',
  'job reaches READY with output manifest'
);

insert into test_render_jobs
select 'job2', public.enqueue_render_job(
  '11111111-1111-4111-8111-111111111111',
  'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
  'render-job-002', 50::smallint
);
select is(
  public.claim_render_job('worker-a', 60) ->> 'id',
  (select id::text from test_render_jobs where name = 'job2'),
  'worker claims the next queued job'
);
select lives_ok(
  $$select public.fail_render_job(
      (select id from test_render_jobs where name = 'job2'), 'worker-a', 'RENDER_TIMEOUT'
    );$$,
  'worker failure is recorded'
);
select is(
  (select status from public.render_jobs
   where id = (select id from test_render_jobs where name = 'job2')),
  'QUEUED',
  'failed job is requeued while attempts remain'
);
select is(
  public.claim_render_job('worker-a', 60) ->> 'status',
  'CLAIMED',
  'requeued job can be claimed again'
);
select is(
  public.cancel_render_job(
    '11111111-1111-4111-8111-111111111111',
    (select id from test_render_jobs where name = 'job2')
  ),
  true,
  'owner can cancel a running job through the server RPC'
);
select is(
  (select status from public.render_jobs
   where id = (select id from test_render_jobs where name = 'job2')),
  'CANCELED',
  'canceled job reaches CANCELED'
);

insert into test_render_jobs
select 'job3', public.enqueue_render_job(
  '11111111-1111-4111-8111-111111111111',
  'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
  'render-job-003', 50::smallint
);
select is(
  public.claim_render_job('worker-c', 60) ->> 'status',
  'CLAIMED',
  'worker-c claims the lease-expiry fixture'
);
reset role;
update public.render_jobs
set lease_expires_at = now() - interval '1 minute'
where id = (select id from test_render_jobs where name = 'job3');
set local role service_role;
select is(
  public.reconcile_render_jobs(),
  1,
  'reconcile detects one expired lease'
);
select is(
  (select status from public.render_jobs
   where id = (select id from test_render_jobs where name = 'job3')),
  'QUEUED',
  'expired job is requeued with attempts remaining'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{"dif_studio_owner":true}}', true);
select ok(
  (select count(*) from public.render_job_events) > 0,
  'owner can read sanitized render events'
);
select is(
  (select count(*) from public.render_jobs),
  3::bigint,
  'owner can read all own render jobs'
);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","app_metadata":{"dif_studio_owner":true}}', true);
select is(
  (select count(*) from public.render_jobs),
  0::bigint,
  'second owner cannot read render jobs'
);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{"dif_studio_owner":true}}', true);
select throws_ok(
  $$insert into public.render_jobs (
      owner_id, episode_id, plan_id, plan_version, idempotency_key
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
      (select id from public.video_edit_plans where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6'),
      2,
      'render-direct-insert'
    );$$,
  '42501',
  'permission denied for table render_jobs',
  'owner cannot insert render jobs outside the RPC'
);
reset role;

select ok(
  has_table_privilege('service_role', 'public.episodes', 'SELECT')
    and has_table_privilege('service_role', 'public.scenes', 'SELECT')
    and has_table_privilege('service_role', 'public.video_assets', 'SELECT'),
  'render worker has read-only context grants'
);

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{"dif_studio_owner":true}}', true);
select throws_ok(
  $$insert into public.voice_direction_plans (
      owner_id, episode_id, current_version, plan
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6', 1, '{}'::jsonb
    );$$,
  '42501',
  'permission denied for table voice_direction_plans',
  'owner cannot write voice direction outside the server'
);
set local role service_role;
select lives_ok(
  $$insert into public.voice_direction_plans (
      owner_id, episode_id, current_version, plan
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6', 1, '{"schemaVersion":1}'::jsonb
    );$$,
  'service role can store a voice direction plan'
);
select lives_ok(
  $$insert into public.narration_takes (
      owner_id, episode_id, plan_version, source, bucket, object_key, sha256,
      byte_size, duration_ms, format, sample_rate, channels, peak_db, rms_db
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6', 1, 'UPLOAD',
      'dif-studio-video-private',
      'narration/11111111-1111-4111-8111-111111111111/e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6/voice.wav',
      repeat('a', 64), 1024, 3000, 'wav', 22050, 1, -1.5, -17.0
    );$$,
  'service role can store a narration take'
);
select lives_ok(
  $$insert into public.narration_takes (
      id, owner_id, episode_id, plan_version, source, bucket, object_key, sha256,
      byte_size, duration_ms, format, sample_rate, channels, peak_db, rms_db, true_peak_db, lufs
    ) values (
      'a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7',
      '11111111-1111-4111-8111-111111111111',
      'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6', 1, 'TTS',
      'dif-studio-video-private',
      'narration/11111111-1111-4111-8111-111111111111/e6e6e6e-e6e6-46e6-86e6-e6e6e6e6e6e6/tts.wav',
      repeat('c', 64), 2048, 3000, 'wav', 48000, 1, -1.5, -17.0, -1.0, -18.0
    );$$,
  'service role can store a TTS narration take with true peak'
);
select throws_ok(
  $$update public.voice_direction_plans
    set current_status = 'APPROVED'
    where owner_id = '11111111-1111-4111-8111-111111111111'
      and episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6';$$,
  '23514',
  'narration_take_required',
  'voice direction cannot be approved without a take'
);
select lives_ok(
  $$update public.voice_direction_plans
    set plan = '{"schemaVersion":1,"takeId":"a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7"}'::jsonb,
        current_status = 'APPROVED'
    where owner_id = '11111111-1111-4111-8111-111111111111'
      and episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6';$$,
  'voice direction is approved only with a READY take'
);
select is(
  public.claim_render_job('worker-d', 60) ->> 'id',
  (select id::text from test_render_jobs where name = 'job3'),
  'worker-d claims the remaining queued job before the narrated job'
);
select lives_ok(
  $$select public.start_render_job(
      (select id from test_render_jobs where name = 'job3'), 'worker-d'
    );$$,
  'worker-d starts the video-only job'
);
select lives_ok(
  $$select public.complete_render_job(
      (select id from test_render_jobs where name = 'job3'), 'worker-d',
      '{"schemaVersion":1,"codec":"h264","width":1080,"height":1920,"durationMs":120000,"objectKey":"renders/test3.mp4","sha256":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}'::jsonb
    );$$,
  'video-only job completes without an audio manifest'
);
insert into test_render_jobs
select 'job4', public.enqueue_render_job(
  '11111111-1111-4111-8111-111111111111',
  'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6',
  'render-job-004', 50::smallint,
  'a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7'::uuid
);
select is(
  (select narration_take_id from public.render_jobs
   where id = (select id from test_render_jobs where name = 'job4')),
  'a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7'::uuid,
  'render job pins the approved narration take'
);
select throws_ok(
  $$update public.render_jobs
    set narration_take_id = null
    where id = (select id from test_render_jobs where name = 'job4');$$,
  '55000',
  'render_narration_immutable',
  'narration take cannot be changed after enqueue'
);
select is(
  public.claim_render_job('worker-e', 60) ->> 'status',
  'CLAIMED',
  'worker-e claims the narrated job'
);
select lives_ok(
  $$select public.start_render_job(
      (select id from test_render_jobs where name = 'job4'), 'worker-e'
    );$$,
  'narrated job starts'
);
select throws_ok(
  $$select public.complete_render_job(
      (select id from test_render_jobs where name = 'job4'), 'worker-e',
      '{"schemaVersion":1,"codec":"h264","width":1080,"height":1920,"durationMs":120000,"objectKey":"renders/test4.mp4","sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"}'::jsonb
    );$$,
  '23514',
  'render_narration_missing',
  'narrated job cannot complete without AAC audio'
);
select lives_ok(
  $$select public.complete_render_job(
      (select id from test_render_jobs where name = 'job4'), 'worker-e',
      '{"schemaVersion":1,"codec":"h264","width":1080,"height":1920,"durationMs":120000,"objectKey":"renders/test4.mp4","sha256":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc","audio":{"codec":"aac","channels":2,"sampleRate":48000,"durationMs":120000,"narrationTakeId":"a7a7a7a7-a7a7-47a7-87a7-a7a7a7a7a7a7"}}'::jsonb
    );$$,
  'narrated job completes with the pinned AAC audio'
);
set local role authenticated;
select is(
  (select count(*) from public.voice_direction_plans
   where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6'),
  1::bigint,
  'owner can read the voice direction plan'
);
select is(
  (select count(*) from public.narration_takes
   where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6'),
  2::bigint,
  'owner can read the narration takes'
);
select set_config('request.jwt.claims', '{"sub":"22222222-2222-4222-8222-222222222222","app_metadata":{"dif_studio_owner":true}}', true);
select is(
  (select count(*) from public.voice_direction_plans
   where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6'),
  0::bigint,
  'second owner cannot read the first owner voice direction'
);
select is(
  (select count(*) from public.narration_takes
   where episode_id = 'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6'),
  0::bigint,
  'second owner cannot read the first owner narration take'
);
select set_config('request.jwt.claims', '{"sub":"11111111-1111-4111-8111-111111111111","app_metadata":{"dif_studio_owner":true}}', true);
select throws_ok(
  $$insert into public.narration_takes (
      owner_id, episode_id, plan_version, source, bucket, object_key, sha256,
      byte_size, duration_ms, format, sample_rate, channels
    ) values (
      '11111111-1111-4111-8111-111111111111',
      'e6e6e6e6-e6e6-46e6-86e6-e6e6e6e6e6e6', 1, 'UPLOAD',
      'dif-studio-video-private', 'narration/spoof.wav', repeat('b', 64),
      1024, 3000, 'wav', 22050, 1
    );$$,
  '42501',
  'permission denied for table narration_takes',
  'owner cannot insert narration takes directly'
);
reset role;

select pass('single-owner RLS, append-only history, revisions, voting, and immutable publication invariants hold');
select * from finish();
rollback;
