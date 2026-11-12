import type { PageServerLoad } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { firstRelation } from '#lib/server/relations.js';

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const { data, error } = await db
		.from('polls')
		.select(
			'id,episode_id,status,opened_at,closes_at,tie_break_rule,tie_break_option,external_post_id,episodes(id,title,episode_number,seasons(title,series(title))),poll_results(id,revision_number,option_1_count,option_2_count,winner_option,verification_status,evidence_source,captured_at),canonical_decisions(id,revision_number,rationale,created_at)',
		)
		.eq('owner_id', owner.id)
		.order('opened_at', { ascending: false });
	if (error) throw new Error('Não foi possível carregar os registros de continuidade.');
	return {
		polls: (data ?? []).map((poll) => {
			const episode = firstRelation(poll.episodes);
			const season = firstRelation(episode?.seasons);
			return {
				...poll,
				episodes: episode
					? {
							...episode,
							seasons: season ? { ...season, series: firstRelation(season.series) } : null,
						}
					: null,
			};
		}),
	};
};
