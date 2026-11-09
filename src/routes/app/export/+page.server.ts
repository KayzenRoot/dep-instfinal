import type { PageServerLoad } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { firstRelation } from '#lib/server/relations.js';

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const { data, error } = await db
		.from('episodes')
		.select(
			'id,title,episode_number,status,duration_ms,is_season_finale,seasons(title,series(title))',
		)
		.eq('owner_id', owner.id)
		.order('updated_at', { ascending: false });
	if (error) throw new Error('Não foi possível listar os episódios exportáveis.');
	return {
		episodes: (data ?? []).map((episode) => {
			const season = firstRelation(episode.seasons);
			return {
				...episode,
				seasons: season ? { ...season, series: firstRelation(season.series) } : null,
			};
		}),
	};
};
