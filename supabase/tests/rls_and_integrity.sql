-- Run only on the disposable local Supabase database with `supabase test db`.
-- The test uses synthetic JWT subjects and rolls back every inserted row.
create extension if not exists pgtap with schema extensions;
begin;
select plan(1);

do $$
declare
  v_table text;
  v_tables text[] := array[
    'series', 'seasons', 'characters', 'lore_facts', 'episodes', 'episode_revisions',
    'media_assets', 'scenes', 'choices', 'polls', 'poll_results', 'canonical_decisions',
    'image_references', 'generation_jobs'
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
  id, poll_id, episode_id, poll_result_id, revision_number, canon_snapshot, rationale
)
values (
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 1,
  '{"winner":"1","approved":true}'::jsonb,
  'Synthetic fixture; explicit owner approval.'
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

select pass('single-owner RLS, append-only history, revisions, voting, and immutable publication invariants hold');
select * from finish();
rollback;
