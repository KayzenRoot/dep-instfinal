import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase, readFormText } from '#lib/server/authorized.js';
import { seriesSchema } from '#lib/schemas/story.js';

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const [seriesResult, episodeCount, openPollCount, mediaCount] = await Promise.all([
		db
			.from('series')
			.select('id,title,subgenre,status,updated_at,seasons(id,title,planned_episode_count,status)')
			.order('updated_at', { ascending: false }),
		db.from('episodes').select('id', { count: 'exact', head: true }),
		db.from('polls').select('id', { count: 'exact', head: true }).eq('status', 'OPEN'),
		db
			.from('media_assets')
			.select('id', { count: 'exact', head: true })
			.eq('upload_status', 'READY'),
	]);
	if (seriesResult.error || episodeCount.error || openPollCount.error || mediaCount.error)
		throw new Error('Não foi possível carregar o arquivo.');
	return {
		ownerLabel: owner.email ?? 'Proprietária',
		series: seriesResult.data ?? [],
		metrics: {
			episodes: episodeCount.count ?? 0,
			openPolls: openPollCount.count ?? 0,
			media: mediaCount.count ?? 0,
		},
	};
};

export const actions: Actions = {
	createSeries: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		const parsed = seriesSchema.safeParse({
			title: readFormText(form, 'title'),
			premise: readFormText(form, 'premise'),
			subgenre: readFormText(form, 'subgenre'),
			tone: readFormText(form, 'tone'),
			audience: readFormText(form, 'audience'),
		});
		if (!parsed.success) return fail(400, { message: 'Revise o título e os campos da série.' });
		const { data, error: insertError } = await db
			.from('series')
			.insert({ ...parsed.data, owner_id: owner.id })
			.select('id')
			.single();
		if (insertError || !data) return fail(500, { message: 'Não foi possível salvar a série.' });
		redirect(303, `/app/series/${data.id}`);
	},
};
