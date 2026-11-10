import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { buildSceneTimeline } from '#lib/domain/timeline.js';
import {
	characterSchema,
	episodeCreateSchema,
	loreSchema,
	seasonSchema,
	seriesSchema,
} from '#lib/schemas/story.js';
import { ownerDatabase, readFormText } from '#lib/server/authorized.js';

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const seriesId = event.params.seriesId;
	const [seriesResult, seasonsResult, charactersResult, loreResult] = await Promise.all([
		db.from('series').select('*').eq('id', seriesId).eq('owner_id', owner.id).maybeSingle(),
		db
			.from('seasons')
			.select('*')
			.eq('series_id', seriesId)
			.eq('owner_id', owner.id)
			.order('season_number'),
		db
			.from('characters')
			.select('*')
			.eq('series_id', seriesId)
			.eq('owner_id', owner.id)
			.order('name'),
		db
			.from('lore_facts')
			.select('*')
			.eq('series_id', seriesId)
			.eq('owner_id', owner.id)
			.order('importance', { ascending: false }),
	]);
	if (seriesResult.error || !seriesResult.data) error(404, 'Série não encontrada.');
	if (seasonsResult.error || charactersResult.error || loreResult.error)
		error(503, 'Não foi possível carregar este arquivo.');
	const seasonIds = (seasonsResult.data ?? []).map((season) => season.id);
	const episodesResult = seasonIds.length
		? await db
				.from('episodes')
				.select('id,season_id,episode_number,title,status,duration_ms,is_season_finale')
				.eq('owner_id', owner.id)
				.in('season_id', seasonIds)
				.order('episode_number')
		: { data: [], error: null };
	if (episodesResult.error) error(503, 'Não foi possível carregar os episódios.');
	return {
		ownerLabel: owner.email ?? 'Proprietária',
		series: seriesResult.data,
		seasons: seasonsResult.data ?? [],
		characters: charactersResult.data ?? [],
		lore: loreResult.data ?? [],
		episodes: episodesResult.data ?? [],
	};
};

export const actions: Actions = {
	saveSeries: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		const parsed = seriesSchema.safeParse(
			Object.fromEntries(
				['title', 'premise', 'subgenre', 'tone', 'audience'].map((key) => [
					key,
					readFormText(form, key),
				]),
			),
		);
		if (!parsed.success) return fail(400, { message: 'Revise os campos da série.' });
		const { error: updateError } = await db
			.from('series')
			.update(parsed.data)
			.eq('id', event.params.seriesId)
			.eq('owner_id', owner.id);
		if (updateError) return fail(500, { message: 'Não foi possível salvar a série.' });
		return { saved: true };
	},
	createSeason: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		const parsed = seasonSchema.safeParse({
			seriesId: event.params.seriesId,
			seasonNumber: readFormText(form, 'seasonNumber'),
			title: readFormText(form, 'title'),
			plannedEpisodeCount: readFormText(form, 'plannedEpisodeCount'),
			summary: readFormText(form, 'summary'),
		});
		if (!parsed.success)
			return fail(400, {
				message: 'Informe temporada, título e um plano entre 10 e 15 episódios.',
			});
		const { error: insertError } = await db.from('seasons').insert({
			owner_id: owner.id,
			series_id: parsed.data.seriesId,
			season_number: parsed.data.seasonNumber,
			title: parsed.data.title,
			planned_episode_count: parsed.data.plannedEpisodeCount,
			summary: parsed.data.summary,
		});
		if (insertError)
			return fail(409, {
				message: 'Não foi possível criar a temporada. Verifique se o número já existe.',
			});
		return { seasonCreated: true };
	},
	createEpisode: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		const parsed = episodeCreateSchema.safeParse({
			seasonId: readFormText(form, 'seasonId'),
			episodeNumber: readFormText(form, 'episodeNumber'),
			title: readFormText(form, 'title'),
			durationSeconds: readFormText(form, 'durationSeconds'),
			isSeasonFinale: form.get('isSeasonFinale') === 'on',
		});
		if (!parsed.success)
			return fail(400, { message: 'Revise o número, o título e a duração (90–150 segundos).' });
		const { data: season, error: seasonError } = await db
			.from('seasons')
			.select('id,series_id')
			.eq('id', parsed.data.seasonId)
			.eq('series_id', event.params.seriesId)
			.eq('owner_id', owner.id)
			.maybeSingle();
		if (seasonError || !season)
			return fail(404, { message: 'Temporada não encontrada neste arquivo.' });
		const { data: episode, error: episodeError } = await db
			.from('episodes')
			.insert({
				owner_id: owner.id,
				season_id: season.id,
				episode_number: parsed.data.episodeNumber,
				title: parsed.data.title,
				duration_ms: parsed.data.durationSeconds * 1000,
				is_season_finale: parsed.data.isSeasonFinale,
			})
			.select('id')
			.single();
		if (episodeError || !episode)
			return fail(409, {
				message: 'Não foi possível criar o episódio. Verifique se o número já foi usado.',
			});
		const sceneRows = buildSceneTimeline(parsed.data.durationSeconds * 1000).map((scene) => ({
			owner_id: owner.id,
			episode_id: episode.id,
			scene_index: scene.index,
			start_ms: scene.startMs,
			end_ms: scene.endMs,
		}));
		const { error: sceneError } = await db.from('scenes').insert(sceneRows);
		if (sceneError) {
			await db.from('episodes').delete().eq('id', episode.id).eq('owner_id', owner.id);
			return fail(500, {
				message: 'O episódio foi iniciado, mas a linha do tempo não foi criada.',
			});
		}
		redirect(303, `/app/episodes/${episode.id}`);
	},
	createCharacter: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		const parsed = characterSchema.safeParse({
			seriesId: event.params.seriesId,
			seasonId: readFormText(form, 'seasonId'),
			name: readFormText(form, 'name'),
			role: readFormText(form, 'role'),
			description: readFormText(form, 'description'),
			visualDescription: readFormText(form, 'visualDescription'),
			voiceNotes: readFormText(form, 'voiceNotes'),
			arcNotes: readFormText(form, 'arcNotes'),
		});
		if (!parsed.success) return fail(400, { message: 'Informe ao menos o nome do personagem.' });
		const { error: insertError } = await db.from('characters').insert({
			owner_id: owner.id,
			series_id: parsed.data.seriesId,
			season_id: parsed.data.seasonId || null,
			name: parsed.data.name,
			role: parsed.data.role,
			description: parsed.data.description,
			visual_description: parsed.data.visualDescription,
			voice_notes: parsed.data.voiceNotes,
			arc_notes: parsed.data.arcNotes,
		});
		if (insertError) return fail(500, { message: 'Não foi possível salvar o personagem.' });
		return { characterCreated: true };
	},
	createLore: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		const parsed = loreSchema.safeParse({
			seriesId: event.params.seriesId,
			seasonId: readFormText(form, 'seasonId'),
			category: readFormText(form, 'category'),
			title: readFormText(form, 'title'),
			fact: readFormText(form, 'fact'),
			importance: readFormText(form, 'importance'),
			status: 'ACTIVE',
		});
		if (!parsed.success)
			return fail(400, { message: 'Revise a categoria, o título e o fato de continuidade.' });
		const { error: insertError } = await db.from('lore_facts').insert({
			owner_id: owner.id,
			series_id: parsed.data.seriesId,
			season_id: parsed.data.seasonId || null,
			category: parsed.data.category,
			title: parsed.data.title,
			fact: parsed.data.fact,
			importance: parsed.data.importance,
			status: parsed.data.status,
		});
		if (insertError) return fail(500, { message: 'Não foi possível salvar o fato.' });
		return { loreCreated: true };
	},
	setLoreStatus: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData().catch(() => null);
		if (!form) return fail(400, { message: 'Não foi possível ler o formulário.' });
		const id = readFormText(form, 'id');
		const status = readFormText(form, 'status');
		if (!/^[0-9a-f-]{36}$/i.test(id) || !['ACTIVE', 'SUPERSEDED', 'ARCHIVED'].includes(status))
			return fail(400, { message: 'Alteração inválida.' });
		const { error: updateError } = await db
			.from('lore_facts')
			.update({ status })
			.eq('id', id)
			.eq('series_id', event.params.seriesId)
			.eq('owner_id', owner.id);
		if (updateError) return fail(500, { message: 'Não foi possível atualizar o fato.' });
		return { loreUpdated: true };
	},
};
