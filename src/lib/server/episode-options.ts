import type { SupabaseClient, User } from '@supabase/supabase-js';
import { firstRelation } from './relations.js';

export async function loadOwnerEpisodeOptions(db: SupabaseClient, owner: User) {
	const { data, error } = await db
		.from('episodes')
		.select('id,episode_number,title,status,seasons(title,series(title))')
		.eq('owner_id', owner.id)
		.order('updated_at', { ascending: false });
	if (error) throw new Error('Não foi possível carregar os episódios.');
	return (data ?? []).map((episode) => {
		const season = firstRelation(episode.seasons);
		return {
			...episode,
			seasons: season ? { ...season, series: firstRelation(season.series) } : null,
		};
	});
}
