import type { SupabaseClient } from '@supabase/supabase-js';
import { findContinuityWarnings, type ContinuityWarning } from '#lib/domain/continuity-review.js';
import { firstRelation } from './relations.js';

type DbRow = Record<string, unknown>;

/**
 * Loads the owner-scoped text and canonical state used by the pre-canon
 * continuity review. Warnings are advisory hints; the author still records
 * the explicit review before approving canon.
 */
export async function loadContinuityWarnings(
	db: SupabaseClient,
	ownerId: string,
	episodeId: string,
	options: { strict?: boolean } = {},
): Promise<ContinuityWarning[]> {
	const fail = (): ContinuityWarning[] => {
		if (options.strict) throw new Error('continuity_review_unavailable');
		return [];
	};
	const episodeQuery = await db
		.from('episodes')
		.select('id,title,logline,hook,narrative,reveal,cliffhanger,narration_pt_br,seasons(series_id)')
		.eq('id', episodeId)
		.eq('owner_id', ownerId)
		.maybeSingle();
	if (episodeQuery.error || !episodeQuery.data) return fail();
	const episode = episodeQuery.data as unknown as DbRow;
	const season = firstRelation(episode.seasons as DbRow | DbRow[] | null);
	const seriesId = typeof season?.series_id === 'string' ? season.series_id : null;
	if (!seriesId) return fail();

	const [scenesQuery, charactersQuery, loreQuery, choicesQuery] = await Promise.all([
		db
			.from('scenes')
			.select(
				'narration_pt_br,visual_description,camera_notes,location,character_notes,vhs_effects,transition',
			)
			.eq('owner_id', ownerId)
			.eq('episode_id', episodeId)
			.order('scene_index'),
		db.from('characters').select('name,status').eq('owner_id', ownerId).eq('series_id', seriesId),
		db.from('lore_facts').select('title,status').eq('owner_id', ownerId).eq('series_id', seriesId),
		db
			.from('choices')
			.select('label,consequence')
			.eq('owner_id', ownerId)
			.eq('episode_id', episodeId),
	]);
	if (scenesQuery.error || charactersQuery.error || loreQuery.error || choicesQuery.error)
		return fail();

	const scenes = (scenesQuery.data ?? []) as DbRow[];
	const choices = (choicesQuery.data ?? []) as DbRow[];
	const text = [
		String(episode.title ?? ''),
		String(episode.logline ?? ''),
		String(episode.hook ?? ''),
		String(episode.narrative ?? ''),
		String(episode.reveal ?? ''),
		String(episode.cliffhanger ?? ''),
		String(episode.narration_pt_br ?? ''),
		...choices.flatMap((choice) => [choice.label, choice.consequence]),
		...scenes.map((scene) =>
			[
				scene.narration_pt_br,
				scene.visual_description,
				scene.camera_notes,
				scene.location,
				scene.character_notes,
				scene.vhs_effects,
				scene.transition,
			]
				.filter(Boolean)
				.join(' '),
		),
	].join('\n');

	return findContinuityWarnings({
		text,
		characters: (charactersQuery.data ?? []) as Array<{ name: string; status: string }>,
		loreFacts: (loreQuery.data ?? []) as Array<{ title: string; status: string }>,
	});
}
