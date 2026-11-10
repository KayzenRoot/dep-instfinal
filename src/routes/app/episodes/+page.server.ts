import type { PageServerLoad } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';
import { firstRelation } from '#lib/server/relations.js';

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const { data, error } = await db
		.from('episodes')
		.select(
			'id,episode_number,title,status,duration_ms,is_season_finale,updated_at,seasons(id,title,planned_episode_count,series_id,series(title))',
		)
		.eq('owner_id', owner.id)
		.order('updated_at', { ascending: false });
	if (error) throw new Error('Não foi possível carregar os episódios.');
	return {
		episodes: (data ?? []).map((episode) => {
			const season = firstRelation(episode.seasons);
			return {
				...episode,
				is_season_finale: Number(episode.episode_number) === Number(season?.planned_episode_count),
				seasons: season ? { ...season, series: firstRelation(season.series) } : null,
			};
		}),
	};
};
