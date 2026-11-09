import type { PageServerLoad } from './$types';
import { ownerDatabase } from '#lib/server/authorized.js';

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const { data, error } = await db
		.from('series')
		.select('id,title,subgenre,status,updated_at,seasons(id,planned_episode_count)')
		.eq('owner_id', owner.id)
		.order('updated_at', { ascending: false });
	if (error) throw new Error('Não foi possível carregar as séries.');
	return { series: data ?? [] };
};
