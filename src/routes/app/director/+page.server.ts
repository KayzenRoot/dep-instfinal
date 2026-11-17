import { fail } from '@sveltejs/kit';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import type { Actions, PageServerLoad } from './$types';
import { ownerDatabase, readFormText } from '#lib/server/authorized.js';
import { createSupabaseAdminClient } from '#lib/server/supabase.js';
import { loadOwnerEpisodeOptions } from '#lib/server/episode-options.js';
import {
	loadEditPlan,
	saveVideoEditPlan,
	VideoEditPlanError,
} from '#lib/server/video-edit-plans.js';
import { listAudioAssets } from '#lib/server/audio-library.js';
import {
	applyDirectorToPlan,
	buildDirectorPlan,
	directorPlanHash,
	EditDirectorError,
	resetDirector,
	type DirectorInput,
} from '#lib/domain/edit-director.js';
import {
	directorPresetSchema,
	editDirectorPlanSchema,
	type EditDirectorPlan,
} from '#lib/schemas/edit-director.js';
import { directorAiConfigured, suggestDirectorWithGemini } from '#lib/server/director-ai.js';
import { firstRelation } from '#lib/server/relations.js';

async function loadDirectorInput(
	db: SupabaseClient,
	owner: User,
	episodeId: string,
	seed: number,
	preset: EditDirectorPlan['preset'],
	suspense: boolean,
): Promise<DirectorInput> {
	const { data: episode, error: episodeError } = await db
		.from('episodes')
		.select('id,duration_ms,season_id,seasons(series_id,series(title))')
		.eq('owner_id', owner.id)
		.eq('id', episodeId)
		.maybeSingle();
	if (episodeError || !episode)
		throw new EditDirectorError('DIRECTOR_EPISODE', 'Episódio não encontrado.');
	const [scenes, characters, choices, assets] = await Promise.all([
		db
			.from('scenes')
			.select('id,scene_index,start_ms,end_ms,narration_pt_br,visual_description,audio_notes')
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.order('scene_index'),
		db
			.from('characters')
			.select('name')
			.eq('owner_id', owner.id)
			.eq(
				'series_id',
				(firstRelation(episode.seasons) as { series_id?: string } | null)?.series_id ?? '',
			)
			.order('name')
			.limit(30),
		db
			.from('choices')
			.select('option_key,label')
			.eq('owner_id', owner.id)
			.eq('episode_id', episodeId)
			.order('option_key'),
		listAudioAssets(db, owner),
	]);
	return {
		episodeId,
		durationMs: Number(episode.duration_ms),
		seed,
		preset,
		suspense,
		scenes: (scenes.data ?? []).map((scene) => ({
			id: scene.id as string,
			sceneIndex: scene.scene_index as number,
			startMs: scene.start_ms as number,
			endMs: scene.end_ms as number,
			narration: String(scene.narration_pt_br ?? ''),
			visualDescription: String(scene.visual_description ?? ''),
			audioNotes: String(scene.audio_notes ?? ''),
		})),
		characters: (characters.data ?? []).map((character) => String(character.name)),
		location: null,
		audioAssets: assets,
		choices: (choices.data ?? []).map((choice) => ({
			optionKey: String(choice.option_key),
			label: String(choice.label),
		})),
	};
}

export const load: PageServerLoad = async (event) => {
	const { db, owner } = ownerDatabase(event);
	const episodes = await loadOwnerEpisodeOptions(db, owner);
	const requested = event.url.searchParams.get('episodeId');
	const selected = episodes.find((episode) => episode.id === requested) ?? episodes[0] ?? null;
	if (!selected)
		return {
			episodes,
			selectedEpisode: null,
			plan: null,
			director: null,
			versions: [],
			aiConfigured: directorAiConfigured(),
			loadError: 'Crie/selecione um episódio.',
		};
	try {
		const stored = await loadEditPlan(db, owner, selected.id);
		if (!stored.plan)
			return {
				episodes,
				selectedEpisode: selected,
				plan: null,
				director: null,
				versions: [],
				aiConfigured: directorAiConfigured(),
				loadError: 'Salve a timeline antes de dirigir o episódio.',
			};
		return {
			episodes,
			selectedEpisode: selected,
			plan: {
				version: stored.plan.current_version,
				status: stored.plan.current_status,
				durationMs: stored.plan.plan.durationMs,
			},
			director: stored.plan.plan.director ?? null,
			versions: stored.versions,
			aiConfigured: directorAiConfigured(),
			loadError: null,
		};
	} catch (cause) {
		return {
			episodes,
			selectedEpisode: selected,
			plan: null,
			director: null,
			versions: [],
			aiConfigured: directorAiConfigured(),
			loadError: cause instanceof Error ? cause.message : 'Não foi possível carregar o diretor.',
		};
	}
};

function parseSeed(value: string): number {
	const parsed = Number.parseInt(value || '7', 10);
	return Number.isInteger(parsed) && parsed >= 0 && parsed <= 2_147_483_647 ? parsed : 7;
}

function directorForSave(raw: string): EditDirectorPlan | null {
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	const parsed = editDirectorPlanSchema.safeParse(value);
	if (!parsed.success) return null;
	return { ...parsed.data, planHash: directorPlanHash(parsed.data) };
}

export const actions: Actions = {
	generate: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		const preset = directorPresetSchema.safeParse(readFormText(form, 'preset') || 'reveal');
		const seed = parseSeed(readFormText(form, 'seed'));
		const suspense = form.get('suspense') === 'on';
		const mode = readFormText(form, 'mode') === 'gemini' ? 'gemini' : 'offline';
		if (!episodeId || !preset.success)
			return fail(400, { message: 'Episódio ou preset inválido.' });
		try {
			const input = await loadDirectorInput(db, owner, episodeId, seed, preset.data, suspense);
			if (mode === 'gemini') {
				try {
					const result = await suggestDirectorWithGemini(input);
					return {
						success: true,
						director: result.director,
						estimatedTokens: result.estimatedTokens,
						warning: null,
					};
				} catch (cause) {
					const fallback = buildDirectorPlan(input);
					return {
						success: true,
						director: fallback,
						estimatedTokens: 0,
						warning:
							cause instanceof Error
								? `${cause.message} Plano offline gerado como fallback.`
								: 'IA indisponível; plano offline gerado.',
					};
				}
			}
			return {
				success: true,
				director: buildDirectorPlan(input),
				estimatedTokens: 0,
				warning: null,
			};
		} catch (cause) {
			if (cause instanceof EditDirectorError) return fail(400, { message: cause.message });
			return fail(503, { message: 'Não foi possível gerar a direção.' });
		}
	},
	apply: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		const director = directorForSave(readFormText(form, 'director'));
		const expectedVersion = Number.parseInt(readFormText(form, 'expectedVersion'), 10);
		if (!episodeId || !director) return fail(400, { message: 'Direção inválida.' });
		if (!Number.isInteger(expectedVersion) || expectedVersion < 0)
			return fail(400, { message: 'Versão esperada inválida.' });
		try {
			const stored = await loadEditPlan(db, owner, episodeId);
			if (!stored.plan) return fail(404, { message: 'Plano não encontrado.' });
			const assets = await listAudioAssets(db, owner);
			const applied = applyDirectorToPlan({
				plan: stored.plan.plan,
				director,
				assets,
				acceptedEventIds: director.acceptedEventIds,
			});
			const version = await saveVideoEditPlan({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId,
				expectedVersion,
				plan: applied,
				changeNote: readFormText(form, 'changeNote') || 'Direção editorial aplicada',
			});
			return { success: true, version };
		} catch (cause) {
			if (cause instanceof VideoEditPlanError)
				return fail(cause.status, { message: cause.message });
			if (cause instanceof EditDirectorError) return fail(400, { message: cause.message });
			return fail(503, { message: 'Não foi possível aplicar a direção.' });
		}
	},
	revert: async (event) => {
		const { db, owner } = ownerDatabase(event);
		const form = await event.request.formData();
		const episodeId = readFormText(form, 'episodeId');
		const expectedVersion = Number.parseInt(readFormText(form, 'expectedVersion'), 10);
		if (!episodeId || !Number.isInteger(expectedVersion) || expectedVersion < 0)
			return fail(400, { message: 'Episódio ou versão inválidos.' });
		try {
			const stored = await loadEditPlan(db, owner, episodeId);
			if (!stored.plan) return fail(404, { message: 'Plano não encontrado.' });
			const version = await saveVideoEditPlan({
				db,
				adminDb: createSupabaseAdminClient(),
				owner,
				episodeId,
				expectedVersion,
				plan: resetDirector(stored.plan.plan),
				changeNote: 'Subplano de direção revertido',
			});
			return { success: true, version };
		} catch (cause) {
			if (cause instanceof VideoEditPlanError)
				return fail(cause.status, { message: cause.message });
			return fail(503, { message: 'Não foi possível reverter a direção.' });
		}
	},
};
