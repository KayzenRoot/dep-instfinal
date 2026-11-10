import type { SupabaseClient } from '@supabase/supabase-js';
import {
	buildNarrativeContext,
	type NarrativeEpisodeInput,
} from '#lib/domain/narrative-context.js';
import { firstRelation } from './relations.js';

type DbRow = Record<string, unknown>;

function ensureNoQueryError(error: { message: string } | null, label: string): void {
	if (error) throw new Error(`narrative_context_${label}`);
}

export async function loadNarrativeContext(
	db: SupabaseClient,
	ownerId: string,
	episodeId: string,
	branchOption?: '1' | '2',
) {
	const targetQuery = await db
		.from('episodes')
		.select(
			'id,season_id,episode_number,title,status,duration_ms,seasons(id,title,season_number,planned_episode_count,summary,bible,chronology,series_id,series(id,title,premise,subgenre,tone,audience))',
		)
		.eq('id', episodeId)
		.eq('owner_id', ownerId)
		.maybeSingle();
	ensureNoQueryError(targetQuery.error, 'target');
	if (!targetQuery.data) throw new Error('narrative_context_episode_not_found');
	const target = targetQuery.data as unknown as DbRow;
	const targetSeason = firstRelation(target.seasons as DbRow | DbRow[] | null);
	const targetSeries = firstRelation(targetSeason?.series as DbRow | DbRow[] | null);
	if (!targetSeason || !targetSeries) throw new Error('narrative_context_series_not_found');
	const seriesId = targetSeason.series_id as string;

	const [seasonsQuery, charactersQuery, loreQuery] = await Promise.all([
		db
			.from('seasons')
			.select('id,season_number,title,planned_episode_count,summary,bible,chronology,status')
			.eq('series_id', seriesId)
			.eq('owner_id', ownerId)
			.order('season_number'),
		db
			.from('characters')
			.select('id,season_id,name,role,description,visual_description,voice_notes,arc_notes,status')
			.eq('series_id', seriesId)
			.eq('owner_id', ownerId)
			.order('name'),
		db
			.from('lore_facts')
			.select('id,season_id,category,title,fact,importance,status,applies_from_episode')
			.eq('series_id', seriesId)
			.eq('owner_id', ownerId)
			.order('importance', { ascending: false }),
	]);
	ensureNoQueryError(seasonsQuery.error, 'seasons');
	ensureNoQueryError(charactersQuery.error, 'characters');
	ensureNoQueryError(loreQuery.error, 'lore');
	const seasons = (seasonsQuery.data ?? []) as unknown as DbRow[];
	const seasonIds = seasons.map((season) => String(season.id));
	const episodesQuery = seasonIds.length
		? await db
				.from('episodes')
				.select(
					'id,season_id,episode_number,title,status,duration_ms,logline,hook,narrative,reveal,cliffhanger,narration_pt_br',
				)
				.eq('owner_id', ownerId)
				.in('season_id', seasonIds)
				.order('episode_number')
		: { data: [], error: null };
	ensureNoQueryError(episodesQuery.error, 'episodes');
	const episodeRows = (episodesQuery.data ?? []) as unknown as DbRow[];
	const seasonNumberById = new Map(
		seasons.map((season) => [String(season.id), Number(season.season_number)]),
	);
	const comparePosition = (left: DbRow, right: DbRow) => {
		const seasonDifference =
			(seasonNumberById.get(String(left.season_id)) ?? 0) -
			(seasonNumberById.get(String(right.season_id)) ?? 0);
		return seasonDifference || Number(left.episode_number) - Number(right.episode_number);
	};
	const orderedEpisodes = episodeRows.sort(comparePosition);
	const targetPosition = orderedEpisodes.findIndex((episode) => episode.id === target.id);
	if (targetPosition < 0) throw new Error('narrative_context_episode_not_found');
	const priorRows = orderedEpisodes
		.slice(0, targetPosition)
		.filter((episode) => episode.status === 'PUBLISHED');
	const priorIds = priorRows.map((episode) => String(episode.id));
	const [scenesQuery, choicesQuery, pollsQuery] = priorIds.length
		? await Promise.all([
				db
					.from('scenes')
					.select(
						'episode_id,scene_index,narration_pt_br,visual_description,camera_notes,lighting_notes,audio_notes',
					)
					.eq('owner_id', ownerId)
					.in('episode_id', priorIds)
					.order('scene_index'),
				db
					.from('choices')
					.select('episode_id,option_key,label,consequence')
					.eq('owner_id', ownerId)
					.in('episode_id', priorIds)
					.order('option_key'),
				db
					.from('polls')
					.select('id,episode_id,status')
					.eq('owner_id', ownerId)
					.in('episode_id', priorIds),
			])
		: [
				{ data: [], error: null },
				{ data: [], error: null },
				{ data: [], error: null },
			];
	ensureNoQueryError(scenesQuery.error, 'scenes');
	ensureNoQueryError(choicesQuery.error, 'choices');
	ensureNoQueryError(pollsQuery.error, 'polls');
	const polls = (pollsQuery.data ?? []) as unknown as DbRow[];
	const pollIds = polls.map((poll) => String(poll.id));
	const [resultsQuery, decisionsQuery] = pollIds.length
		? await Promise.all([
				db
					.from('poll_results')
					.select(
						'id,poll_id,revision_number,option_1_count,option_2_count,winner_option,verification_status,evidence_source',
					)
					.eq('owner_id', ownerId)
					.in('poll_id', pollIds)
					.order('revision_number', { ascending: false }),
				db
					.from('canonical_decisions')
					.select('id,poll_id,poll_result_id,revision_number,canon_snapshot,rationale')
					.eq('owner_id', ownerId)
					.in('poll_id', pollIds)
					.order('revision_number', { ascending: false }),
			])
		: [
				{ data: [], error: null },
				{ data: [], error: null },
			];
	ensureNoQueryError(resultsQuery.error, 'results');
	ensureNoQueryError(decisionsQuery.error, 'decisions');
	const scenes = (scenesQuery.data ?? []) as unknown as DbRow[];
	const choices = (choicesQuery.data ?? []) as unknown as DbRow[];
	const results = (resultsQuery.data ?? []) as unknown as DbRow[];
	const decisions = (decisionsQuery.data ?? []) as unknown as DbRow[];
	const sceneGroups = new Map<string, DbRow[]>();
	const choiceGroups = new Map<string, DbRow[]>();
	for (const scene of scenes) {
		const group = sceneGroups.get(String(scene.episode_id)) ?? [];
		group.push(scene);
		sceneGroups.set(String(scene.episode_id), group);
	}
	for (const choice of choices) {
		const group = choiceGroups.get(String(choice.episode_id)) ?? [];
		group.push(choice);
		choiceGroups.set(String(choice.episode_id), group);
	}
	const episodeContexts: NarrativeEpisodeInput[] = priorRows.map((episode) => {
		const season = seasons.find((row) => row.id === episode.season_id);
		const poll = polls.find((row) => row.episode_id === episode.id);
		const episodeChoices = (choiceGroups.get(String(episode.id)) ?? []).map((choice) => ({
			optionKey: String(choice.option_key) as '1' | '2',
			label: String(choice.label),
			consequence: String(choice.consequence),
		}));
		const latestResult = results.find((row) => row.poll_id === poll?.id);
		const latestDecision = decisions.find((row) => row.poll_id === poll?.id);
		return {
			id: String(episode.id),
			seasonNumber: Number(season?.season_number ?? 0),
			seasonTitle: String(season?.title ?? ''),
			episodeNumber: Number(episode.episode_number),
			title: String(episode.title),
			status: String(episode.status),
			durationMs: Number(episode.duration_ms),
			logline: String(episode.logline ?? ''),
			hook: String(episode.hook ?? ''),
			narrative: String(episode.narrative ?? ''),
			reveal: String(episode.reveal ?? ''),
			cliffhanger: String(episode.cliffhanger ?? ''),
			narrationPtBr: String(episode.narration_pt_br ?? ''),
			scenes: sceneGroups.get(String(episode.id)) ?? [],
			choices: episodeChoices,
			poll: poll
				? {
						status: String(poll.status),
						latestResult: latestResult
							? {
									id: String(latestResult.id),
									option1Count: Number(latestResult.option_1_count),
									option2Count: Number(latestResult.option_2_count),
									winnerOption:
										latestResult.verification_status === 'VERIFIED'
											? (latestResult.winner_option as '1' | '2' | null)
											: null,
									verificationStatus: String(latestResult.verification_status),
									evidenceSource: String(latestResult.evidence_source ?? ''),
								}
							: null,
						latestDecision: latestDecision
							? {
									id: String(latestDecision.id),
									pollResultId: String(latestDecision.poll_result_id),
									canonSnapshot: latestDecision.canon_snapshot as Record<string, unknown>,
									rationale: String(latestDecision.rationale ?? ''),
								}
							: null,
					}
				: null,
		};
	});
	const currentSeason = seasons.find((season) => season.id === target.season_id);
	return buildNarrativeContext(
		{
			series: targetSeries,
			seasons,
			currentEpisode: {
				id: String(target.id),
				episodeNumber: Number(target.episode_number),
				seasonNumber: Number(currentSeason?.season_number ?? 0),
				seasonTitle: String(currentSeason?.title ?? ''),
				title: String(target.title),
				durationSeconds: Math.floor(Number(target.duration_ms) / 1000),
				isSeasonFinale:
					Number(target.episode_number) === Number(currentSeason?.planned_episode_count),
			},
			characters: (charactersQuery.data ?? []) as unknown as DbRow[],
			loreFacts: (loreQuery.data ?? []) as unknown as DbRow[],
			priorEpisodes: episodeContexts,
		},
		branchOption,
	);
}
